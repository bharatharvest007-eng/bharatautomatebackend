import mongoose, { Schema, model, type Model } from 'mongoose';

export type ContentDraftKind = 'post' | 'reel' | 'carousel' | 'story' | 'idea';
export type ContentDraftStatus = 'idea' | 'draft' | 'scheduled' | 'published' | 'archived';
export type ContentDraftSource = 'studio' | 'repurpose' | 'calendar' | 'copilot';

/**
 * A piece of content in progress (AI Content Studio, repurposed plans,
 * co-pilot proposals). Scheduling links it to a ScheduledPost via
 * `scheduledPostId`. `ctaKeyword` + `dmText` drive the comment-to-DM
 * automation that is created when the post publishes.
 */
export interface IContentDraft {
  _id: string;
  orgId: string;
  accountId?: string;
  kind: ContentDraftKind;
  title?: string;
  caption?: string;
  hashtags: string[];
  altText?: string;
  script?: string;
  slides: Record<string, unknown>[];
  mediaUrls: string[];
  ctaKeyword?: string;
  dmText?: string;
  language?: string;
  status: ContentDraftStatus;
  source: ContentDraftSource;
  scheduledPostId?: string;
  meta: Record<string, unknown>;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContentDraftSchema = new Schema<IContentDraft>(
  {
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

ContentDraftSchema.index({ orgId: 1, status: 1, updatedAt: -1 });

export const ContentDraft: Model<IContentDraft> = (mongoose.models.ContentDraft as any) || model<IContentDraft>('ContentDraft', ContentDraftSchema);
