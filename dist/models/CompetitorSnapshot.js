import mongoose, { Schema, model } from 'mongoose';
const CompetitorSnapshotSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    competitorId: { type: String, required: true },
    followers: { type: Number, default: 0 },
    mediaCount: { type: Number, default: 0 },
    avgLikes: { type: Number, default: 0 },
    avgComments: { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 },
    postsLast7d: { type: Number, default: 0 },
    topPosts: { type: Schema.Types.Mixed, default: () => [] },
    capturedAt: { type: Date, default: Date.now },
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
CompetitorSnapshotSchema.index({ competitorId: 1, capturedAt: -1 });
export const CompetitorSnapshot = mongoose.models.CompetitorSnapshot || model('CompetitorSnapshot', CompetitorSnapshotSchema);
