import mongoose, { Schema, model, type Model } from 'mongoose';

export interface ISocialAccount {
  _id: string;
  orgId: string;
  /** instagram | whatsapp | facebook */
  platform: string;
  /** Instagram-only: the Instagram-scoped user id the Messaging API addresses. */
  igUserId?: string;
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

  // --- WhatsApp Business Cloud API -----------------------------------------
  /** Meta's Phone Number ID — the id every WhatsApp send/receive call is scoped to. */
  phoneNumberId?: string;
  /** The WhatsApp Business Account this number belongs to. */
  wabaId?: string;
  /** The Meta Business Manager id that owns the WABA. */
  businessId?: string;
  /** Human-readable number, e.g. "+91 73638 64780". */
  phoneNumber?: string;
  /** Meta's own display name review status: PENDING | APPROVED | REJECTED. */
  displayNameStatus?: string;
  /** GREEN | YELLOW | RED — falling quality throttles how many people you can message. */
  qualityRating?: string;
  /** Meta's messaging tier: how many *new* conversations may start per 24h. */
  messagingLimitTier?: string;
  /** Commerce Catalog id, once one is connected — needed for catalog/product messages. */
  catalogId?: string;

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
    platform: { type: String, default: 'instagram', index: true },
    igUserId: { type: String, index: true },
    username: { type: String, required: true, index: true },
    name: { type: String },
    avatarUrl: { type: String },
    biography: { type: String },
    website: { type: String },
    followersCount: { type: Number, default: 0 },
    followsCount: { type: Number, default: 0 },
    mediaCount: { type: Number, default: 0 },
    accountType: { type: String },
    pageId: { type: String, index: true },
    pageName: { type: String },
    loginMode: { type: String, default: 'instagram' },

    phoneNumberId: { type: String, index: true },
    wabaId: { type: String, index: true },
    businessId: { type: String },
    phoneNumber: { type: String },
    displayNameStatus: { type: String },
    qualityRating: { type: String },
    messagingLimitTier: { type: String },
    catalogId: { type: String },

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

// Each platform has its own notion of "the same account", so uniqueness is
// enforced per platform rather than on one shared column.
//
// `sparse` is NOT what we want here: for a *compound* index, MongoDB only
// excludes a document from a sparse index when EVERY indexed field is
// missing — and `orgId` is always present, so a plain `sparse: true` on
// `{orgId, phoneNumberId}` would still index (and collide) every Instagram
// account, which has no phoneNumberId at all. A partial index with an
// explicit filter is what actually excludes "this platform doesn't have
// that field" documents.
SocialAccountSchema.index(
  { orgId: 1, igUserId: 1 },
  { unique: true, partialFilterExpression: { igUserId: { $type: 'string' } } },
);
SocialAccountSchema.index(
  { orgId: 1, phoneNumberId: 1 },
  { unique: true, partialFilterExpression: { phoneNumberId: { $type: 'string' } } },
);
SocialAccountSchema.index(
  { orgId: 1, pageId: 1, platform: 1 },
  { unique: true, partialFilterExpression: { pageId: { $type: 'string' } } },
);

export const SocialAccount: Model<ISocialAccount> = (mongoose.models.SocialAccount as any) || model<ISocialAccount>('SocialAccount', SocialAccountSchema);
