import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IDailyStat {
  _id: string;
  orgId: string;
  /** Connected account id, or '_org' for workspace-level stats. */
  accountId: string;
  /** 'YYYY-MM-DD' (UTC). */
  day: string;
  metric: string;
  value: number;
  updatedAt: Date;
}

const DailyStatSchema = new Schema<IDailyStat>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, default: '_org', index: true },
    day: { type: String, required: true, index: true },
    metric: { type: String, required: true, index: true },
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

// Unique per org: the old { accountId, day, metric } unique index collided across orgs for
// '_org'-level stats; `reconcileLegacyIndexes()` (config/db.ts) drops it on startup.
DailyStatSchema.index({ orgId: 1, accountId: 1, day: 1, metric: 1 }, { unique: true });
DailyStatSchema.index({ orgId: 1, day: -1 });

export const DailyStat: Model<IDailyStat> = (mongoose.models.DailyStat as any) || model<IDailyStat>('DailyStat', DailyStatSchema);
