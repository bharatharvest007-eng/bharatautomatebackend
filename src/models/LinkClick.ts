import mongoose, { Schema, model, type Model } from 'mongoose';

export interface ILinkClick {
  _id: string;
  linkId: string;
  contactId?: string;
  messageId?: string;
  ip?: string;
  userAgent?: string;
  referrer?: string;
  country?: string;
  device?: string;
  createdAt: Date;
}

const LinkClickSchema = new Schema<ILinkClick>(
  {
    _id: { type: String, required: true },
    linkId: { type: String, required: true, index: true },
    contactId: { type: String, index: true },
    messageId: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    referrer: { type: String },
    country: { type: String },
    device: { type: String },
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

LinkClickSchema.index({ linkId: 1, createdAt: -1 });

export const LinkClick: Model<ILinkClick> = (mongoose.models.LinkClick as any) || model<ILinkClick>('LinkClick', LinkClickSchema);
