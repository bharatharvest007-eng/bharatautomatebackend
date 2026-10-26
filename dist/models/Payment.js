import mongoose, { Schema, model } from 'mongoose';
const PaymentSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    provider: { type: String, required: true, enum: ['razorpay', 'dev'] },
    kind: { type: String, required: true, enum: ['subscription', 'credits'] },
    status: { type: String, default: 'created', enum: ['created', 'authorized', 'captured', 'failed', 'refunded'] },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR', enum: ['INR', 'USD'] },
    providerPaymentId: { type: String, index: true },
    providerOrderId: { type: String, index: true },
    providerSubscriptionId: { type: String, index: true },
    planId: { type: String },
    interval: { type: String, enum: ['month', 'year'] },
    credits: { type: Number },
    invoiceId: { type: String },
    raw: { type: Schema.Types.Mixed, default: {} },
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
PaymentSchema.index({ orgId: 1, createdAt: -1 });
export const Payment = mongoose.models.Payment || model('Payment', PaymentSchema);
