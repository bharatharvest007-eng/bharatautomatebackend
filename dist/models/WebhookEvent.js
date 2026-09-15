import mongoose, { Schema, model } from 'mongoose';
const WebhookEventSchema = new Schema({
    _id: { type: String, required: true },
    platform: { type: String, default: 'instagram' },
    objectId: { type: String },
    field: { type: String },
    signature: { type: String, required: true, unique: true, index: true },
    payload: { type: String, required: true },
    status: { type: String, default: 'pending', enum: ['pending', 'processing', 'done', 'failed', 'ignored'], index: true },
    attempts: { type: Number, default: 0 },
    error: { type: String },
    receivedAt: { type: Date, default: Date.now, index: true },
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
export const WebhookEvent = mongoose.models.WebhookEvent || model('WebhookEvent', WebhookEventSchema);
