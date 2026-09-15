import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IAiUsage {
  _id: string;
  orgId: string;
  accountId?: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  credits: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  createdAt: Date;
}

const AiUsageSchema = new Schema<IAiUsage>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, index: true },
    feature: { type: String, required: true, index: true },
    model: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    credits: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    success: { type: Boolean, default: true },
    error: { type: String },
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

AiUsageSchema.index({ orgId: 1, createdAt: -1 });

export const AiUsage: Model<IAiUsage> = (mongoose.models.AiUsage as any) || model<IAiUsage>('AiUsage', AiUsageSchema);
