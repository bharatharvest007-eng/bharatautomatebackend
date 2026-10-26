import mongoose, { Schema, model, type Model } from 'mongoose';

/** Point-in-time metrics for a tracked competitor (one per sync). */
export interface ICompetitorSnapshot {
  _id: string;
  orgId: string;
  competitorId: string;
  followers: number;
  mediaCount: number;
  avgLikes: number;
  avgComments: number;
  /** (avg likes + avg comments) / followers, as a fraction (0.034 = 3.4%). */
  engagementRate: number;
  postsLast7d: number;
  topPosts: Record<string, unknown>[];
  capturedAt: Date;
  createdAt: Date;
}

const CompetitorSnapshotSchema = new Schema<ICompetitorSnapshot>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    competitorId: { type: String, required: true },
    followers: { type: Number, default: 0 },
    mediaCount: { type: Number, default: 0 },
    avgLikes: { type: Number, default: 0 },
    avgComments: { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 },
    postsLast7d: { type: Number, default: 0 },
    topPosts: { type: Schema.Types.Mixed, default: () => [] },
    capturedAt: { type: Date, default: Date.now },
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

CompetitorSnapshotSchema.index({ competitorId: 1, capturedAt: -1 });

export const CompetitorSnapshot: Model<ICompetitorSnapshot> = (mongoose.models.CompetitorSnapshot as any) || model<ICompetitorSnapshot>('CompetitorSnapshot', CompetitorSnapshotSchema);
