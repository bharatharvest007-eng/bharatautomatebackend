import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IIgMedia {
  _id: string;
  orgId: string;
  accountId: string;
  mediaId: string;
  mediaType?: string;
  mediaProductType?: string;
  caption?: string;
  permalink?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  timestamp?: Date;
  likeCount: number;
  commentCount: number;
  reach: number;
  impressions: number;
  saved: number;
  shares: number;
  views: number;
  isTrialReel: boolean;
  discoveredVia: string;
  setupState: string;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IgMediaSchema = new Schema<IIgMedia>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    mediaId: { type: String, required: true, index: true },
    mediaType: { type: String },
    mediaProductType: { type: String },
    caption: { type: String },
    permalink: { type: String },
    mediaUrl: { type: String },
    thumbnailUrl: { type: String },
    timestamp: { type: Date, index: true },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    saved: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    isTrialReel: { type: Boolean, default: false, index: true },
    discoveredVia: { type: String, default: 'sync' },
    setupState: { type: String, default: 'ready', index: true },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
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

IgMediaSchema.index({ accountId: 1, mediaId: 1 }, { unique: true });

export const IgMedia: Model<IIgMedia> = (mongoose.models.IgMedia as any) || model<IIgMedia>('IgMedia', IgMediaSchema);
