import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IRateLimitState {
  _id: string;
  accountId: string;
  bucket: string;
  tokens: number;
  capacity: number;
  refillPerSec: number;
  callCountPct: number;
  totalTimePct: number;
  totalCpuPct: number;
  blockedUntil?: Date;
  updatedAt: Date;
}

const RateLimitStateSchema = new Schema<IRateLimitState>(
  {
    _id: { type: String, required: true },
    accountId: { type: String, required: true, index: true },
    bucket: { type: String, required: true, index: true },
    tokens: { type: Number, default: 0 },
    capacity: { type: Number, default: 0 },
    refillPerSec: { type: Number, default: 0 },
    callCountPct: { type: Number, default: 0 },
    totalTimePct: { type: Number, default: 0 },
    totalCpuPct: { type: Number, default: 0 },
    blockedUntil: { type: Date },
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

RateLimitStateSchema.index({ accountId: 1, bucket: 1 }, { unique: true });

export const RateLimitState: Model<IRateLimitState> = (mongoose.models.RateLimitState as any) || model<IRateLimitState>('RateLimitState', RateLimitStateSchema);
