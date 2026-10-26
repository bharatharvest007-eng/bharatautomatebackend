import mongoose, { Schema, model } from 'mongoose';
const InvoiceLineSchema = new Schema({
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitAmount: { type: Number, required: true },
    amount: { type: Number, required: true },
}, { _id: false });
const InvoiceTaxSchema = new Schema({
    name: { type: String, required: true },
    rate: { type: Number, required: true },
    amount: { type: Number, required: true },
}, { _id: false });
const InvoiceSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    number: { type: String, required: true, unique: true, index: true },
    kind: { type: String, required: true, enum: ['subscription', 'credits'] },
    status: { type: String, default: 'paid', enum: ['paid', 'void', 'refunded'] },
    currency: { type: String, default: 'INR', enum: ['INR', 'USD'] },
    lines: { type: [InvoiceLineSchema], default: [] },
    subtotal: { type: Number, required: true },
    taxes: { type: [InvoiceTaxSchema], default: [] },
    total: { type: Number, required: true },
    billingProfile: { type: Schema.Types.Mixed, default: {} },
    supplier: { type: Schema.Types.Mixed, default: {} },
    paymentId: { type: String, index: true },
    providerRef: { type: String },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    issuedAt: { type: Date, default: Date.now },
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
InvoiceSchema.index({ orgId: 1, issuedAt: -1 });
export const Invoice = mongoose.models.Invoice || model('Invoice', InvoiceSchema);
