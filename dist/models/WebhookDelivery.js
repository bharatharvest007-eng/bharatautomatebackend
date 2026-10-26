import mongoose, { Schema, model } from 'mongoose';
const WebhookDeliverySchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    endpointId: { type: String, required: true, index: true },
    event: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, default: 'pending', enum: ['pending', 'success', 'failed'] },
    attempts: { type: Number, default: 0 },
    responseStatus: { type: Number },
    durationMs: { type: Number },
    error: { type: String },
    deliveredAt: { type: Date },
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
WebhookDeliverySchema.index({ orgId: 1, endpointId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
export const WebhookDelivery = mongoose.models.WebhookDelivery || model('WebhookDelivery', WebhookDeliverySchema);
