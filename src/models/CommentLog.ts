import mongoose, { Schema, model, type Model } from 'mongoose';

export interface ICommentLog {
  _id: string;
  orgId: string;
  accountId: string;
  mediaId?: string;
  commentId: string;
  parentId?: string;
  fromIgsid?: string;
  username?: string;
  text: string;
  verdict?: string;
  action: 'none' | 'hide' | 'delete' | 'flag' | 'reply';
  confidence?: number;
  reason?: string;
  needsReview: boolean;
  reviewedAt?: Date;
  reviewedBy?: string;
  repliedPublicly: boolean;
  repliedPrivately: boolean;
  hidden: boolean;
  deleted: boolean;
  automationId?: string;
  runId?: string;
  isLive: boolean;
  createdAt: Date;
}

const CommentLogSchema = new Schema<ICommentLog>(
  {
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
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

CommentLogSchema.index({ accountId: 1, commentId: 1 }, { unique: true });
CommentLogSchema.index({ orgId: 1, createdAt: -1 });

export const CommentLog: Model<ICommentLog> = (mongoose.models.CommentLog as any) || model<ICommentLog>('CommentLog', CommentLogSchema);
