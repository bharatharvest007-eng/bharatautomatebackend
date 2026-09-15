import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IShortLink {
  _id: string;
  orgId: string;
  slug: string;
  targetUrl: string;
  meta: Record<string, unknown>;
  clickCount: number;
  uniqueCount: number;
  expiresAt?: Date;
  createdAt: Date;
}

const ShortLinkSchema = new Schema<IShortLink>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    targetUrl: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: {} },
    clickCount: { type: Number, default: 0 },
    uniqueCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
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

export const ShortLink: Model<IShortLink> = (mongoose.models.ShortLink as any) || model<IShortLink>('ShortLink', ShortLinkSchema);
