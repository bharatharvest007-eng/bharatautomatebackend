import mongoose, { Schema, model } from 'mongoose';
const BillingEventSchema = new Schema({
    _id: { type: String, required: true },
    provider: { type: String, required: true },
    eventId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true },
    orgId: { type: String, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    processedAt: { type: Date },
    error: { type: String },
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
export const BillingEvent = mongoose.models.BillingEvent || model('BillingEvent', BillingEventSchema);
