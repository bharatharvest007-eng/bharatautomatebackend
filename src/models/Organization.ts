import mongoose, { Schema, model, type Model } from 'mongoose';
import type { BillingInterval, PlanId, SubscriptionStatus } from '../config/plans.js';

export type BillingProvider = 'razorpay' | 'dev' | 'none';

/**
 * Subscription state. `Organization.plan` stays the effective paid plan id
 * ('free' while trialing); the entitlements service combines `plan`, `billing`
 * and `limits` into what the workspace may use.
 */
export interface IOrganizationBilling {
  provider: BillingProvider;
  status: SubscriptionStatus;
  planId?: PlanId;
  interval?: BillingInterval;
  trialPlan?: PlanId;
  trialEndsAt?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  customerId?: string;
  subscriptionId?: string;
  lastPaymentAt?: Date;
}

/** Buyer details printed on GST invoices. */
export interface IBillingProfile {
  legalName?: string;
  gstin?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  /** Two-digit GST state code, e.g. '29'. */
  stateCode?: string;
  postalCode?: string;
  country: string;
}

export interface IOrganization {
  _id: string;
  name: string;
  slug: string;
  /** Catalog PlanId; legacy rows may hold 'unlimited' (resolved to 'enterprise'). */
  plan: string;
  timezone: string;
  locale: string;
  industry?: string;
  ownerId?: string;
  /** Public key the website widget embeds instead of the raw org id. */
  widgetKey?: string;
  /** Per-org quota overrides keyed by QuotaMetric (null / negative = unlimited). */
  limits: Record<string, number | null>;
  settings: Record<string, unknown>;
  billing: IOrganizationBilling;
  billingProfile: IBillingProfile;
  /** Purchased AI credits remaining (decimal, 2 places). */
  creditBalance: number;
  createdAt: Date;
  updatedAt: Date;
}

const BillingSchema = new Schema<IOrganizationBilling>(
  {
    provider: { type: String, default: 'none', enum: ['razorpay', 'dev', 'none'] },
    status: {
      type: String,
      default: 'free',
      enum: ['free', 'trialing', 'active', 'past_due', 'halted', 'cancelled', 'expired'],
    },
    planId: { type: String },
    interval: { type: String, enum: ['month', 'year'] },
    trialPlan: { type: String },
    trialEndsAt: { type: Date },
    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    customerId: { type: String },
    subscriptionId: { type: String, index: true },
    lastPaymentAt: { type: Date },
  },
  { _id: false },
);

const BillingProfileSchema = new Schema<IBillingProfile>(
  {
    legalName: { type: String },
    gstin: { type: String, uppercase: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String },
    addressLine1: { type: String },
    addressLine2: { type: String },
    city: { type: String },
    state: { type: String },
    stateCode: { type: String },
    postalCode: { type: String },
    country: { type: String, default: 'IN' },
  },
  { _id: false },
);

const OrganizationSchema = new Schema<IOrganization>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    plan: { type: String, default: 'free', index: true },
    timezone: { type: String, default: 'UTC' },
    locale: { type: String, default: 'en' },
    industry: { type: String },
    ownerId: { type: String, index: true },
    widgetKey: { type: String, unique: true, sparse: true },
    limits: { type: Schema.Types.Mixed, default: {} },
    settings: { type: Schema.Types.Mixed, default: {} },
    billing: { type: BillingSchema, default: () => ({}) },
    billingProfile: { type: BillingProfileSchema, default: () => ({}) },
    creditBalance: { type: Number, default: 0 },
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

OrganizationSchema.index({ 'billing.status': 1, 'billing.trialEndsAt': 1 });
OrganizationSchema.index({ 'billing.status': 1, 'billing.currentPeriodEnd': 1 });

export const Organization: Model<IOrganization> = (mongoose.models.Organization as any) || model<IOrganization>('Organization', OrganizationSchema);
