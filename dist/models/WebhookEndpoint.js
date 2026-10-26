import mongoose, { Schema, model } from 'mongoose';
const WebhookEndpointSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    url: { type: String, required: true },
    description: { type: String },
    secret: { type: String, required: true },
    events: { type: [String], default: ['*'] },
    enabled: { type: Boolean, default: true },
    failureCount: { type: Number, default: 0 },
    lastDeliveryAt: { type: Date },
    lastStatus: { type: Number },
    lastError: { type: String },
    disabledAt: { type: Date },
    disabledReason: { type: String },
    createdBy: { type: String },
}, {
    timestamps: true,
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.secret;
            delete ret.__v;
            return ret;
        },
    },
});
WebhookEndpointSchema.index({ orgId: 1, enabled: 1 });
export const WebhookEndpoint = mongoose.models.WebhookEndpoint || model('WebhookEndpoint', WebhookEndpointSchema);
