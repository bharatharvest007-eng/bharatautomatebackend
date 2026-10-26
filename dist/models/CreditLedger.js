import mongoose, { Schema, model } from 'mongoose';
const CreditLedgerSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    kind: { type: String, required: true, enum: ['grant', 'purchase', 'consume', 'expire', 'adjust', 'refund'] },
    credits: { type: Number, required: true },
    balanceAfter: { type: Number },
    feature: { type: String },
    refType: { type: String },
    refId: { type: String },
    userId: { type: String },
    note: { type: String },
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
CreditLedgerSchema.index({ orgId: 1, createdAt: -1 });
CreditLedgerSchema.index({ orgId: 1, kind: 1, refId: 1 }, { unique: true, partialFilterExpression: { refId: { $type: 'string' } } });
export const CreditLedger = mongoose.models.CreditLedger || model('CreditLedger', CreditLedgerSchema);
