import mongoose, { Schema, model } from 'mongoose';
const BrandVoiceSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, unique: true, index: true },
    tone: { type: String, default: 'friendly' },
    description: { type: String },
    examples: [{ type: String }],
    rules: [{ type: String }],
    emojiUsage: { type: String, default: 'light', enum: ['none', 'light', 'heavy'] },
    language: { type: String, default: 'auto' },
    signature: { type: String },
    autoReplyEnabled: { type: Boolean, default: false },
    autoReplyThreshold: { type: Number, default: 0.7 },
    spamGuardEnabled: { type: Boolean, default: false },
    spamAutoHide: { type: Boolean, default: true },
    spamAutoDelete: { type: Boolean, default: false },
    spamThreshold: { type: Number, default: 0.85 },
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
export const BrandVoice = mongoose.models.BrandVoice || model('BrandVoice', BrandVoiceSchema);
