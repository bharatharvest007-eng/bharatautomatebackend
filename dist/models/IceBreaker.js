import mongoose, { Schema, model } from 'mongoose';
const IceBreakerSchema = new Schema({
    _id: { type: String, required: true },
    accountId: { type: String, required: true, index: true },
    question: { type: String, required: true },
    response: { type: Schema.Types.Mixed, default: {} },
    locale: { type: String, default: 'default' },
    position: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    tapCount: { type: Number, default: 0 },
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
export const IceBreaker = mongoose.models.IceBreaker || model('IceBreaker', IceBreakerSchema);
