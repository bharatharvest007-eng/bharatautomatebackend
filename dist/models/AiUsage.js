import mongoose, { Schema, model } from 'mongoose';
const AiUsageSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, index: true },
    feature: { type: String, required: true, index: true },
    model: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    credits: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    success: { type: Boolean, default: true },
    error: { type: String },
}, {
    timestamps: { createdAt: true, updatedAt: false },
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
AiUsageSchema.index({ orgId: 1, createdAt: -1 });
export const AiUsage = mongoose.models.AiUsage || model('AiUsage', AiUsageSchema);
