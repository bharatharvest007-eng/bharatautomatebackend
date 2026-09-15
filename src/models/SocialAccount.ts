import mongoose, { Schema, model, type Model } from 'mongoose';

export interface ISocialAccount {
  _id: string;
  orgId: string;
  platform: string;
  igUserId: string;
  username: string;
  name?: string;
  avatarUrl?: string;
  biography?: string;
  website?: string;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
  accountType?: string;
  pageId?: string;
  pageName?: string;
  loginMode: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  lastRefreshedAt?: Date;
  scopes: string[];
  status: string;
  statusReason?: string;
  paused: boolean;
  timezone: string;
  dailyDmLimit?: number;
  minSendIntervalMs?: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  webhookSubscribed: boolean;
  lastSyncAt?: Date;
  lastWebhookAt?: Date;
  connectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SocialAccountSchema = new Schema<ISocialAccount>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    platform: { type: String, default: 'instagram' },
    igUserId: { type: String, required: true, index: true },
    username: { type: String, required: true, index: true },
    name: { type: String },
    avatarUrl: { type: String },
    biography: { type: String },
    website: { type: String },
    followersCount: { type: Number, default: 0 },
    followsCount: { type: Number, default: 0 },
    mediaCount: { type: Number, default: 0 },
    accountType: { type: String },
    pageId: { type: String },
    pageName: { type: String },
    loginMode: { type: String, default: 'instagram' },
    accessToken: { type: String, required: true },
    refreshToken: { type: String },
    tokenExpiresAt: { type: Date },
    lastRefreshedAt: { type: Date },
    scopes: [{ type: String }],
    status: { type: String, default: 'connected', index: true },
    statusReason: { type: String },
    paused: { type: Boolean, default: false },
    timezone: { type: String, default: 'UTC' },
    dailyDmLimit: { type: Number },
    minSendIntervalMs: { type: Number },
    quietHoursStart: { type: Number },
    quietHoursEnd: { type: Number },
    webhookSubscribed: { type: Boolean, default: false },
    lastSyncAt: { type: Date },
    lastWebhookAt: { type: Date },
    connectedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.accessToken;
        delete ret.refreshToken;
        delete ret.__v;
        return ret;
      },
    },
  },
);

SocialAccountSchema.index({ orgId: 1, igUserId: 1 }, { unique: true });

export const SocialAccount: Model<ISocialAccount> = (mongoose.models.SocialAccount as any) || model<ISocialAccount>('SocialAccount', SocialAccountSchema);
