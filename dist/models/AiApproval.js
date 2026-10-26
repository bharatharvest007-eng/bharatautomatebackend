import mongoose, { Schema, model } from 'mongoose';
export const AI_APPROVAL_KINDS = ['agent_reply', 'comment_reply', 'copilot_action', 'broadcast_send'];
export const AI_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'applied', 'failed', 'expired'];
const AiApprovalSchema = new Schema({
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
}, {
    timestamps: true,
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
});
AiApprovalSchema.index({ orgId: 1, status: 1, createdAt: -1 });
AiApprovalSchema.index({ status: 1, expiresAt: 1 });
export const AiApproval = mongoose.models.AiApproval || model('AiApproval', AiApprovalSchema);
