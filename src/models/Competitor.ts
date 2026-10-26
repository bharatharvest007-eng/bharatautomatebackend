import mongoose, { Schema, model, type Model } from 'mongoose';

/**
 * A public Instagram business/creator account the workspace tracks. Snapshots
 * are fetched through IG Business Discovery using the token of `accountId`
 * (one of the workspace's own connected accounts).
 */
export interface ICompetitor {
  _id: string;
  orgId: string;
  accountId: string;
  /** Lowercase IG username without '@'. */
  username: string;
  igUserId?: string;
  name?: string;
  profilePictureUrl?: string;
  biography?: string;
  website?: string;
  followers?: number;
  mediaCount?: number;
  lastSyncedAt?: Date;
  lastError?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CompetitorSchema = new Schema<ICompetitor>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    igUserId: { type: String },
    name: { type: String },
    profilePictureUrl: { type: String },
    biography: { type: String },
    website: { type: String },
    followers: { type: Number },
    mediaCount: { type: Number },
    lastSyncedAt: { type: Date },
    lastError: { type: String },
    enabled: { type: Boolean, default: true },
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

CompetitorSchema.index({ orgId: 1, username: 1 }, { unique: true });

export const Competitor: Model<ICompetitor> = (mongoose.models.Competitor as any) || model<ICompetitor>('Competitor', CompetitorSchema);
