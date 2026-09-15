import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IUsageCounter {
  _id: string;
  orgId: string;
  accountId?: string;
  metric: string;
  period: string;
  value: number;
  updatedAt: Date;
}

const UsageCounterSchema = new Schema<IUsageCounter>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String },
    metric: { type: String, required: true, index: true },
    period: { type: String, required: true, index: true },
    value: { type: Number, default: 0 },
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

UsageCounterSchema.index({ orgId: 1, accountId: 1, metric: 1, period: 1 }, { unique: true });

export const UsageCounter: Model<IUsageCounter> = (mongoose.models.UsageCounter as any) || model<IUsageCounter>('UsageCounter', UsageCounterSchema);
