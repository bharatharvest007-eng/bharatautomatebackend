import mongoose, { Schema, model } from 'mongoose';
const IgStorySchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    storyId: { type: String, required: true, index: true },
    mediaType: { type: String },
    mediaUrl: { type: String },
    thumbnailUrl: { type: String },
    permalink: { type: String },
    timestamp: { type: Date },
    expiresAt: { type: Date, index: true },
    replies: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    exits: { type: Number, default: 0 },
    tapsForward: { type: Number, default: 0 },
    tapsBack: { type: Number, default: 0 },
    automationId: { type: String },
    setupState: { type: String, default: 'ready' },
    lastSyncedAt: { type: Date, default: Date.now },
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
IgStorySchema.index({ accountId: 1, storyId: 1 }, { unique: true });
export const IgStory = mongoose.models.IgStory || model('IgStory', IgStorySchema);
