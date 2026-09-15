import mongoose, { Schema, model } from 'mongoose';
const SessionSchema = new Schema({
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    orgId: { type: String },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
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
export const Session = mongoose.models.Session || model('Session', SessionSchema);
