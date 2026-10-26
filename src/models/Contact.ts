import mongoose, { Schema, model, type Model } from 'mongoose';

export type ContactStage = 'new' | 'engaged' | 'qualified' | 'customer' | 'lost';
export const CONTACT_STAGES: readonly ContactStage[] = ['new', 'engaged', 'qualified', 'customer', 'lost'];

/** WhatsApp marketing templates may only go to contacts who opted in. */
export interface IContactConsent {
  whatsappOptIn: boolean;
  optInAt?: Date;
  optInSource?: string;
}

export interface IContact {
  _id: string;
  orgId: string;
  accountId: string;
  igsid: string;
  username?: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  locale?: string;
  timezone?: string;
  country?: string;
  fields: Record<string, string>;
  tags: string[];
  /** How this contact first reached us: organic | ctwa_ad | referral | widget. */
  source: string;
  /** Raw referral payload Meta attaches when a conversation starts from a Click-to-WhatsApp/IG ad. */
  referral?: Record<string, unknown>;
  isFollower: boolean;
  followerCheckedAt?: Date;
  followConfirmedAt?: Date;
  optedOut: boolean;
  optedOutAt?: Date;
  blocked: boolean;
  messagesSent: number;
  messagesReceived: number;
  linkClicks: number;
  triggersFired: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
  /** AI lead score 0-100. */
  score: number;
  stage: ContactStage;
  scoreReasons: string[];
  nextAction?: string;
  nextActionMessage?: string;
  lastScoredAt?: Date;
  consent: IContactConsent;
  createdAt: Date;
  updatedAt: Date;
}

const ContactConsentSchema = new Schema<IContactConsent>(
  {
    whatsappOptIn: { type: Boolean, default: false },
    optInAt: { type: Date },
    optInSource: { type: String },
  },
  { _id: false },
);

const ContactSchema = new Schema<IContact>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    igsid: { type: String, required: true, index: true },
    username: { type: String, index: true },
    name: { type: String },
    avatarUrl: { type: String },
    email: { type: String, index: true },
    phone: { type: String },
    whatsapp: { type: String },
    locale: { type: String },
    timezone: { type: String },
    country: { type: String },
    fields: { type: Schema.Types.Mixed, default: {} },
    tags: [{ type: String }],
    source: { type: String, default: 'organic' },
    referral: { type: Schema.Types.Mixed },
    isFollower: { type: Boolean, default: false },
    followerCheckedAt: { type: Date },
    followConfirmedAt: { type: Date },
    optedOut: { type: Boolean, default: false },
    optedOutAt: { type: Date },
    blocked: { type: Boolean, default: false },
    messagesSent: { type: Number, default: 0 },
    messagesReceived: { type: Number, default: 0 },
    linkClicks: { type: Number, default: 0 },
    triggersFired: { type: Number, default: 0 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    lastInboundAt: { type: Date },
    lastOutboundAt: { type: Date },
    score: { type: Number, default: 0, min: 0, max: 100 },
    stage: { type: String, default: 'new', enum: CONTACT_STAGES },
    scoreReasons: { type: [String], default: [] },
    nextAction: { type: String },
    nextActionMessage: { type: String },
    lastScoredAt: { type: Date },
    consent: { type: ContactConsentSchema, default: () => ({}) },
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

ContactSchema.index({ accountId: 1, igsid: 1 }, { unique: true });
ContactSchema.index({ orgId: 1, lastSeenAt: -1 });
ContactSchema.index({ orgId: 1, score: -1 });
ContactSchema.index({ orgId: 1, stage: 1, lastSeenAt: -1 });

export const Contact: Model<IContact> = (mongoose.models.Contact as any) || model<IContact>('Contact', ContactSchema);
