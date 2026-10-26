import mongoose, { Schema, model } from 'mongoose';
const CounterSchema = new Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
}, {
    timestamps: false,
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
export const Counter = mongoose.models.Counter || model('Counter', CounterSchema);
