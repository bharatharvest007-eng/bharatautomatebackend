import mongoose, { Schema, model } from 'mongoose';
const ShortLinkSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    targetUrl: { type: String, required: true },
    title: { type: String },
    accountId: { type: String, index: true },
    automationId: { type: String, index: true },
    broadcastId: { type: String, index: true },
    contactId: { type: String },
    meta: { type: Schema.Types.Mixed, default: {} },
    clickCount: { type: Number, default: 0 },
    uniqueCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
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
export const ShortLink = mongoose.models.ShortLink || model('ShortLink', ShortLinkSchema);
