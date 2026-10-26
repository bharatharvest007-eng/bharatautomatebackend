/**
 * Human-in-the-loop approvals for AI-proposed actions.
 *
 * Domains create approvals (draft agent replies, comment replies, co-pilot
 * actions, broadcast sends) and register one handler per kind that executes
 * the action when a member approves. Deciding is a single atomic transition
 * out of 'pending', so a double click or two members approving at once can
 * never run the handler twice. Pending approvals past `expiresAt` are expired
 * by a recurring job (jobs/core.ts).
 */
import type { HydratedDocument } from 'mongoose';
import * as models from '../models/index.js';
import type { AiApprovalKind, IAiApproval } from '../models/index.js';
import { conflict, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { audit } from './audit.js';
import { emitEvent } from './events.js';
import { notify } from './notify.js';

export type ApprovalKind = AiApprovalKind;

export type ApprovalHandler = (
  approval: HydratedDocument<IAiApproval>,
  edits?: Record<string, unknown>,
) => Promise<{ ok: boolean; message?: string; result?: Record<string, unknown> }>;

/** Default lifetime of a pending approval when the creator does not set one. */
export const DEFAULT_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const handlers = new Map<ApprovalKind, ApprovalHandler>();

/** Registers the executor for one approval kind (call from a domain's jobs `register()` or module load). */
export function registerApprovalHandler(kind: ApprovalKind, handler: ApprovalHandler): void {
  if (handlers.has(kind)) console.warn(`[Approvals] Handler for "${kind}" registered twice; the last registration wins`);
  handlers.set(kind, handler);
}

export function hasApprovalHandler(kind: ApprovalKind): boolean {
  return handlers.has(kind);
}

const KIND_LINKS: Record<ApprovalKind, string> = {
  agent_reply: '/ai-agent?tab=approvals',
  comment_reply: '/ai-agent?tab=approvals',
  copilot_action: '/insights?tab=copilot',
  broadcast_send: '/campaigns',
};

export interface CreateApprovalInput {
  orgId: string;
  kind: ApprovalKind;
  title: string;
  summary?: string;
  /** What the handler needs to execute (ids, channel details). */
  payload: Record<string, unknown>;
  /** What the reviewer sees and may edit (e.g. { text }). */
  proposed?: Record<string, unknown>;
  accountId?: string;
  conversationId?: string;
  contactId?: string;
  /** 0..1 */
  confidence?: number;
  expiresAt?: Date;
  source?: string;
}

/** Creates a pending approval, notifies the workspace and emits 'approval.created'. */
export async function createApproval(input: CreateApprovalInput): Promise<HydratedDocument<IAiApproval>> {
  const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? Math.min(1, Math.max(0, input.confidence)) : undefined;
  const approval = await models.AiApproval.create({
    _id: newId('apr'),
    orgId: input.orgId,
    kind: input.kind,
    status: 'pending',
    title: input.title.slice(0, 200),
    summary: input.summary?.slice(0, 2_000),
    payload: input.payload ?? {},
    proposed: input.proposed ?? {},
    accountId: input.accountId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    confidence,
    source: input.source,
    expiresAt: input.expiresAt ?? new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS),
  });

  await notify(input.orgId, {
    type: 'approval',
    title: `Approval needed: ${approval.title}`,
    body: approval.summary,
    link: `${KIND_LINKS[input.kind]}${KIND_LINKS[input.kind].includes('?') ? '&' : '?'}approval=${approval._id}`,
    dedupeKey: `approval:${approval._id}`,
  });
  await emitEvent(input.orgId, 'approval.created', {
    id: approval._id,
    kind: approval.kind,
    title: approval.title,
    summary: approval.summary,
    accountId: approval.accountId,
    conversationId: approval.conversationId,
    contactId: approval.contactId,
    confidence: approval.confidence,
    expiresAt: approval.expiresAt?.toISOString(),
    createdAt: approval.createdAt.toISOString(),
  });
  return approval;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

/**
 * Approves or rejects a pending approval. Approving runs the kind's handler
 * (with the reviewer's `edits` merged into `proposed`) and ends in 'applied'
 * or 'failed'. Throws 404 when missing, 409 when already decided or expired.
 */
export async function decideApproval(
  orgId: string,
  id: string,
  decision: 'approve' | 'reject',
  userId: string,
  edits?: Record<string, unknown>,
): Promise<HydratedDocument<IAiApproval>> {
  const now = new Date();
  const hasEdits = decision === 'approve' && edits && Object.keys(edits).length > 0;

  const claimed = await models.AiApproval.findOneAndUpdate(
    {
      _id: id,
      orgId,
      status: 'pending',
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
    },
    { $set: { status: decision === 'approve' ? 'approved' : 'rejected', decidedBy: userId, decidedAt: now } },
    { returnDocument: 'after' },
  );

  if (!claimed) {
    const existing = await models.AiApproval.findOne({ _id: id, orgId });
    if (!existing) throw notFound('Approval not found');
    if (existing.status === 'pending') {
      existing.status = 'expired';
      await existing.save();
      throw conflict('This approval has expired', 'APPROVAL_EXPIRED');
    }
    throw conflict(`This approval was already ${existing.status}`, 'APPROVAL_DECIDED');
  }

  audit({ orgId, userId }, decision === 'approve' ? 'approval.approved' : 'approval.rejected', { type: 'approval', id }, { kind: claimed.kind, edited: Boolean(hasEdits) });
  if (decision === 'reject') return claimed;

  if (hasEdits) {
    claimed.proposed = { ...(claimed.proposed ?? {}), ...edits };
    claimed.markModified('proposed');
    await claimed.save();
  }

  const handler = handlers.get(claimed.kind);
  if (!handler) {
    claimed.status = 'failed';
    claimed.error = `No handler is registered for "${claimed.kind}" approvals`;
    await claimed.save();
    return claimed;
  }

  try {
    const outcome = await handler(claimed, hasEdits ? edits : undefined);
    if (outcome.ok) {
      claimed.status = 'applied';
      claimed.appliedAt = new Date();
      claimed.set('error', undefined);
    } else {
      claimed.status = 'failed';
      claimed.error = outcome.message ?? 'The action could not be completed';
    }
    if (outcome.result) {
      claimed.result = outcome.result;
      claimed.markModified('result');
    }
  } catch (error) {
    console.error(`[Approvals] Handler for "${claimed.kind}" (${claimed._id}) threw:`, errorText(error));
    claimed.status = 'failed';
    claimed.error = errorText(error);
  }
  await claimed.save();
  return claimed;
}

/** Marks pending approvals past their expiry as 'expired'. Returns how many. */
export async function expireApprovals(now: Date = new Date()): Promise<number> {
  const result = await models.AiApproval.updateMany({ status: 'pending', expiresAt: { $lte: now } }, { $set: { status: 'expired' } });
  return result.modifiedCount;
}
