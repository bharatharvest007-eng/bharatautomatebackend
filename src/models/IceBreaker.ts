import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IIceBreaker {
  _id: string;
  accountId: string;
  question: string;
  response: Record<string, unknown>;
  locale: string;
  position: number;
  enabled: boolean;
  tapCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const IceBreakerSchema = new Schema<IIceBreaker>(
  {
    _id: { type: String, required: true },
    accountId: { type: String, required: true, index: true },
    question: { type: String, required: true },
    response: { type: Schema.Types.Mixed, default: {} },
    locale: { type: String, default: 'default' },
    position: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    tapCount: { type: Number, default: 0 },
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

export const IceBreaker: Model<IIceBreaker> = (mongoose.models.IceBreaker as any) || model<IIceBreaker>('IceBreaker', IceBreakerSchema);
