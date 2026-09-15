import mongoose, { Schema, model, type Model } from 'mongoose';
import type { BioBlock } from '../types/index.js';

export interface IBioPage {
  _id: string;
  orgId: string;
  accountId?: string;
  slug: string;
  title: string;
  bio?: string;
  avatarUrl?: string;
  theme: Record<string, unknown>;
  seo: Record<string, unknown>;
  published: boolean;
  publishedAt?: Date;
  viewCount: number;
  blocks: BioBlock[];
  createdAt: Date;
  updatedAt: Date;
}

const BioBlockSchema = new Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    position: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    data: { type: Schema.Types.Mixed, default: {} },
    clickCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const BioPageSchema = new Schema<IBioPage>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String },
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    bio: { type: String },
    avatarUrl: { type: String },
    theme: { type: Schema.Types.Mixed, default: {} },
    seo: { type: Schema.Types.Mixed, default: {} },
    published: { type: Boolean, default: false },
    publishedAt: { type: Date },
    viewCount: { type: Number, default: 0 },
    blocks: [BioBlockSchema],
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

export const BioPage: Model<IBioPage> = (mongoose.models.BioPage as any) || model<IBioPage>('BioPage', BioPageSchema);
