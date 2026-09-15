import mongoose, { Schema, model, type Model } from 'mongoose';
import type { MediaItem } from '../types/index.js';

export interface IScheduledPost {
  _id: string;
  orgId: string;
  accountId: string;
  kind: 'image' | 'video' | 'reel' | 'carousel' | 'story';
  caption?: string;
  media: MediaItem[];
  coverUrl?: string;
  thumbOffset?: number;
  locationId?: string;
  collaborators: string[];
  userTags: unknown[];
  shareToFeed: boolean;
  altText?: string;
  scheduledFor?: Date;
  timezone: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  containers: string[];
  publishedMediaId?: string;
  permalink?: string;
  error?: string;
  attempts: number;
  publishedAt?: Date;
  attachAutomationId?: string;
  firstComment?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledPostSchema = new Schema<IScheduledPost>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    kind: { type: String, required: true },
    caption: { type: String },
    media: { type: [Schema.Types.Mixed] as any, default: [] },
    coverUrl: { type: String },
    thumbOffset: { type: Number },
    locationId: { type: String },
    collaborators: [{ type: String }],
    userTags: { type: Array, default: [] },
    shareToFeed: { type: Boolean, default: true },
    altText: { type: String },
    scheduledFor: { type: Date, index: true },
    timezone: { type: String, default: 'UTC' },
    status: { type: String, default: 'draft', enum: ['draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'], index: true },
    containers: [{ type: String }],
    publishedMediaId: { type: String },
    permalink: { type: String },
    error: { type: String },
    attempts: { type: Number, default: 0 },
    publishedAt: { type: Date },
    attachAutomationId: { type: String },
    firstComment: { type: String },
    createdBy: { type: String },
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

ScheduledPostSchema.index({ orgId: 1, status: 1, scheduledFor: 1 });

export const ScheduledPost: Model<IScheduledPost> = (mongoose.models.ScheduledPost as any) || model<IScheduledPost>('ScheduledPost', ScheduledPostSchema);
