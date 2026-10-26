import mongoose, { Schema, model, type Model } from 'mongoose';

export type AiApprovalKind = 'agent_reply' | 'comment_reply' | 'copilot_action' | 'broadcast_send';
export type AiApprovalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'expired';

export const AI_APPROVAL_KINDS: readonly AiApprovalKind[] = ['agent_reply', 'comment_reply', 'copilot_action', 'broadcast_send'];
export const AI_APPROVAL_STATUSES: readonly AiApprovalStatus[] = ['pending', 'approved', 'rejected', 'applied', 'failed', 'expired'];

/**
 * Human-in-the-loop queue for AI-proposed actions (draft replies, co-pilot
 * actions, broadcast sends). `payload` holds what the handler needs to execute;
 * `proposed` holds what the reviewer sees and may edit. Approving runs the
 * kind's registered handler and records `applied` / `failed`.
 */
export interface IAiApproval {
  _id: string;
  orgId: string;
  accountId?: string;
  kind: AiApprovalKind;
  status: AiApprovalStatus;
  title: string;
  summary?: string;
  payload: Record<string, unknown>;
  proposed: Record<string, unknown>;
  conversationId?: string;
  contactId?: string;
  confidence?: number;
  source?: string;
  decidedBy?: string;
  decidedAt?: Date;
  appliedAt?: Date;
  result?: Record<string, unknown>;
  error?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiApprovalSchema = new Schema<IAiApproval>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, index: true },
    kind: { type: String, required: true, enum: AI_APPROVAL_KINDS },
    status: { type: String, default: 'pending', enum: AI_APPROVAL_STATUSES },
    title: { type: String, required: true },
    summary: { type: String },
    payload: { type: Schema.Types.Mixed, default: {} },
    proposed: { type: Schema.Types.Mixed, default: {} },
    conversationId: { type: String, index: true },
    contactId: { type: String },
    confidence: { type: Number, min: 0, max: 1 },
    source: { type: String },
    decidedBy: { type: String },
    decidedAt: { type: Date },
    appliedAt: { type: Date },
    result: { type: Schema.Types.Mixed },
    error: { type: String },
    expiresAt: { type: Date },
  },
  {
    timestamps: true,
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

AiApprovalSchema.index({ orgId: 1, status: 1, createdAt: -1 });
AiApprovalSchema.index({ status: 1, expiresAt: 1 });

export const AiApproval: Model<IAiApproval> = (mongoose.models.AiApproval as any) || model<IAiApproval>('AiApproval', AiApprovalSchema);
