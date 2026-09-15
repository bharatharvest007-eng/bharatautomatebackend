import mongoose, { Schema, model } from 'mongoose';
const AutomationRunSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    automationId: { type: String, index: true },
    contactId: { type: String, index: true },
    conversationId: { type: String, index: true },
    trigger: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, default: 'pending', enum: ['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'skipped'], index: true },
    currentNode: { type: String },
    context: { type: Schema.Types.Mixed, default: { vars: {}, visited: [] } },
    trace: { type: [Schema.Types.Mixed], default: [] },
    waitingUntil: { type: Date, index: true },
    waitingForKind: { type: String },
    error: { type: String },
    skipReason: { type: String },
    startedAt: { type: Date, default: Date.now, index: true },
    finishedAt: { type: Date },
    durationMs: { type: Number },
    dedupeKey: { type: String, unique: true, sparse: true, index: true },
}, {
    timestamps: { createdAt: false, updatedAt: false },
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
export const AutomationRun = mongoose.models.AutomationRun || model('AutomationRun', AutomationRunSchema);
