import mongoose, { Schema, model } from 'mongoose';
const LinkClickSchema = new Schema({
    _id: { type: String, required: true },
    linkId: { type: String, required: true, index: true },
    contactId: { type: String, index: true },
    messageId: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    referrer: { type: String },
    country: { type: String },
    device: { type: String },
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
LinkClickSchema.index({ linkId: 1, createdAt: -1 });
export const LinkClick = mongoose.models.LinkClick || model('LinkClick', LinkClickSchema);
