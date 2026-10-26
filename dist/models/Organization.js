import mongoose, { Schema, model } from 'mongoose';
const BillingSchema = new Schema({
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
}, { _id: false });
const BillingProfileSchema = new Schema({
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
}, { _id: false });
const OrganizationSchema = new Schema({
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
}, {
    timestamps: true,
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
});
OrganizationSchema.index({ 'billing.status': 1, 'billing.trialEndsAt': 1 });
OrganizationSchema.index({ 'billing.status': 1, 'billing.currentPeriodEnd': 1 });
export const Organization = mongoose.models.Organization || model('Organization', OrganizationSchema);
