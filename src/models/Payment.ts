import mongoose, { Schema, model, type Model } from 'mongoose';

export type PaymentProvider = 'razorpay' | 'dev';
export type PaymentKind = 'subscription' | 'credits';
export type PaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

/** One payment attempt / charge. `amount` is in minor units (paise / cents). */
export interface IPayment {
  _id: string;
  orgId: string;
  provider: PaymentProvider;
  kind: PaymentKind;
  status: PaymentStatus;
  amount: number;
  currency: 'INR' | 'USD';
  providerPaymentId?: string;
  providerOrderId?: string;
  providerSubscriptionId?: string;
  planId?: string;
  interval?: 'month' | 'year';
  credits?: number;
  invoiceId?: string;
  raw: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    provider: { type: String, required: true, enum: ['razorpay', 'dev'] },
    kind: { type: String, required: true, enum: ['subscription', 'credits'] },
    status: { type: String, default: 'created', enum: ['created', 'authorized', 'captured', 'failed', 'refunded'] },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR', enum: ['INR', 'USD'] },
    providerPaymentId: { type: String, index: true },
    providerOrderId: { type: String, index: true },
    providerSubscriptionId: { type: String, index: true },
    planId: { type: String },
    interval: { type: String, enum: ['month', 'year'] },
    credits: { type: Number },
    invoiceId: { type: String },
    raw: { type: Schema.Types.Mixed, default: {} },
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

PaymentSchema.index({ orgId: 1, createdAt: -1 });

export const Payment: Model<IPayment> = (mongoose.models.Payment as any) || model<IPayment>('Payment', PaymentSchema);
