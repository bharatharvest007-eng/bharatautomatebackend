import mongoose, { Schema, model } from 'mongoose';
export const WEBHOOK_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const WebhookEventSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, index: true },
    platform: { type: String, default: 'instagram' },
    objectId: { type: String },
    field: { type: String },
    signature: { type: String, required: true, unique: true, index: true },
    payload: { type: String, required: true },
    status: { type: String, default: 'pending', enum: ['pending', 'processing', 'done', 'failed', 'ignored'], index: true },
    attempts: { type: Number, default: 0 },
    error: { type: String },
    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
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
// Raw payloads contain PII; keep them 30 days. On existing databases the old plain
// receivedAt_1 index is converted to TTL by `reconcileLegacyIndexes()` (config/db.ts).
WebhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: WEBHOOK_EVENT_TTL_SECONDS });
WebhookEventSchema.index({ orgId: 1, receivedAt: -1 });
export const WebhookEvent = mongoose.models.WebhookEvent || model('WebhookEvent', WebhookEventSchema);
