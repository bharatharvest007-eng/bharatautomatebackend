import mongoose, { Schema, model } from 'mongoose';
const AutomationSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    type: { type: String, required: true, index: true },
    status: { type: String, default: 'draft', enum: ['draft', 'live', 'paused', 'disabled', 'archived'], index: true },
    priority: { type: Number, default: 0 },
    trigger: { type: Schema.Types.Mixed, default: {} },
    flow: { type: Schema.Types.Mixed, default: { version: 1, entry: 'start', nodes: [] } },
    keywords: [{ type: String, index: true }],
    mediaIds: [{ type: String, index: true }],
    cooldownHours: { type: Number },
    oncePerContact: { type: Boolean, default: false },
    maxRunsPerDay: { type: Number },
    respectQuietHours: { type: Boolean, default: true },
    triggeredCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    leadCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    lastTriggeredAt: { type: Date },
    createdBy: { type: String },
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
AutomationSchema.index({ accountId: 1, status: 1, priority: -1 });
export const Automation = mongoose.models.Automation || model('Automation', AutomationSchema);
