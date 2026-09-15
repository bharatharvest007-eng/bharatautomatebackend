import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IIgStory {
  _id: string;
  orgId: string;
  accountId: string;
  storyId: string;
  mediaType?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp?: Date;
  expiresAt?: Date;
  replies: number;
  reach: number;
  impressions: number;
  views: number;
  exits: number;
  tapsForward: number;
  tapsBack: number;
  automationId?: string;
  setupState: string;
  lastSyncedAt: Date;
  createdAt: Date;
}

const IgStorySchema = new Schema<IIgStory>(
  {
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

IgStorySchema.index({ accountId: 1, storyId: 1 }, { unique: true });

export const IgStory: Model<IIgStory> = (mongoose.models.IgStory as any) || model<IIgStory>('IgStory', IgStorySchema);
