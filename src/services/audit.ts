/**
 * Append-only audit trail for security- and billing-relevant actions.
 *
 * `audit` is fire-and-forget: it returns immediately and logs (never throws)
 * if the write fails, so it can sit on any request path. Pass the Express
 * request to capture the actor, workspace, IP and API key automatically.
 */
import type { Request } from 'express';
import * as models from '../models/index.js';
import { newId } from '../lib/ids.js';

export interface AuditActor {
  orgId: string;
  userId?: string;
  ip?: string;
}

export interface AuditTarget {
  type: string;
  id?: string;
}

const MAX_META_BYTES = 8_192;

function isRequest(actor: AuditActor | Request): actor is Request {
  return typeof (actor as Request).get === 'function' && typeof (actor as Request).method === 'string';
}

/** Keeps meta small and JSON-safe; oversized meta is replaced by a marker. */
function safeMeta(meta?: Record<string, unknown>): Record<string, unknown> {
  if (!meta) return {};
  try {
    const json = JSON.stringify(meta);
    if (json.length > MAX_META_BYTES) return { truncated: true, bytes: json.length };
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { unserializable: true };
  }
}

/** Records `action` (dotted verb, e.g. 'member.invited') for the actor's workspace. */
export function audit(actor: AuditActor | Request, action: string, target?: AuditTarget, meta?: Record<string, unknown>): void {
  let orgId: string | undefined;
  let userId: string | undefined;
  let ip: string | undefined;
  const extra: Record<string, unknown> = {};

  if (isRequest(actor)) {
    orgId = actor.auth?.orgId;
    userId = actor.auth?.userId;
    ip = actor.ip;
    if (actor.auth?.via === 'api_key') {
      extra.via = 'api_key';
      extra.apiKeyId = actor.auth.apiKeyId;
    }
  } else {
    orgId = actor.orgId;
    userId = actor.userId;
    ip = actor.ip;
  }
  if (!orgId) return;

  models.AuditLog.create({
    _id: newId('aud'),
    orgId,
    userId,
    action,
    targetType: target?.type,
    targetId: target?.id,
    meta: safeMeta({ ...extra, ...(meta ?? {}) }),
    ip,
  }).catch((error: unknown) => {
    console.error(`[Audit] Failed to record "${action}":`, error instanceof Error ? error.message : error);
  });
}
