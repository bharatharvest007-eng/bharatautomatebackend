import mongoose, { Schema, model } from 'mongoose';
const ContentDraftSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, index: true },
    kind: { type: String, default: 'post', enum: ['post', 'reel', 'carousel', 'story', 'idea'] },
    title: { type: String },
    caption: { type: String },
    hashtags: { type: [String], default: [] },
    altText: { type: String },
    script: { type: String },
    slides: { type: Schema.Types.Mixed, default: () => [] },
    mediaUrls: { type: [String], default: [] },
    ctaKeyword: { type: String },
    dmText: { type: String },
    language: { type: String },
    status: { type: String, default: 'draft', enum: ['idea', 'draft', 'scheduled', 'published', 'archived'] },
    source: { type: String, default: 'studio', enum: ['studio', 'repurpose', 'calendar', 'copilot'] },
    scheduledPostId: { type: String, index: true },
    meta: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: String },
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
ContentDraftSchema.index({ orgId: 1, status: 1, updatedAt: -1 });
export const ContentDraft = mongoose.models.ContentDraft || model('ContentDraft', ContentDraftSchema);
