import mongoose, { Schema, model } from 'mongoose';
const CommentLogSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    mediaId: { type: String, index: true },
    commentId: { type: String, required: true, index: true },
    parentId: { type: String },
    fromIgsid: { type: String },
    username: { type: String },
    text: { type: String, required: true },
    verdict: { type: String },
    action: { type: String, default: 'none', enum: ['none', 'hide', 'delete', 'flag', 'reply'] },
    confidence: { type: Number },
    reason: { type: String },
    needsReview: { type: Boolean, default: false, index: true },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
    repliedPublicly: { type: Boolean, default: false },
    repliedPrivately: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    automationId: { type: String },
    runId: { type: String },
    isLive: { type: Boolean, default: false },
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
CommentLogSchema.index({ accountId: 1, commentId: 1 }, { unique: true });
CommentLogSchema.index({ orgId: 1, createdAt: -1 });
export const CommentLog = mongoose.models.CommentLog || model('CommentLog', CommentLogSchema);
