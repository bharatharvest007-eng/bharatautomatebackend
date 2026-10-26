import mongoose, { Schema, model } from 'mongoose';
export const SOCIAL_ACCOUNT_STATUSES = ['active', 'connected', 'paused', 'expired', 'disconnected', 'error', 'revoked'];
const SocialAccountSchema = new Schema({
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
    status: { type: String, default: 'active', enum: SOCIAL_ACCOUNT_STATUSES, index: true },
    statusReason: { type: String },
    healthStatus: { type: String, default: 'ok', enum: ['ok', 'warning', 'error'] },
    lastError: { type: String },
    tokenRefreshedAt: { type: Date },
    lastHealthCheckAt: { type: Date },
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
}, {
    timestamps: true,
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.accessToken;
            delete ret.refreshToken;
            delete ret.__v;
            return ret;
        },
    },
});
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
SocialAccountSchema.index({ orgId: 1, igUserId: 1 }, { unique: true, partialFilterExpression: { igUserId: { $type: 'string' } } });
SocialAccountSchema.index({ orgId: 1, phoneNumberId: 1 }, { unique: true, partialFilterExpression: { phoneNumberId: { $type: 'string' } } });
SocialAccountSchema.index({ orgId: 1, pageId: 1, platform: 1 }, { unique: true, partialFilterExpression: { pageId: { $type: 'string' } } });
export const SocialAccount = mongoose.models.SocialAccount || model('SocialAccount', SocialAccountSchema);
