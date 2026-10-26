import mongoose, { Schema, model, type Model } from 'mongoose';

export type InvoiceKind = 'subscription' | 'credits';
export type InvoiceStatus = 'paid' | 'void' | 'refunded';
export type InvoiceCurrency = 'INR' | 'USD';

/** Amounts are in minor units (paise / cents). */
export interface IInvoiceLine {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

/** e.g. { name: 'CGST', rate: 9, amount } — `rate` is a percentage. */
export interface IInvoiceTax {
  name: string;
  rate: number;
  amount: number;
}

/**
 * Immutable GST tax invoice. Buyer (`billingProfile`) and seller (`supplier`)
 * details are snapshotted at issue time so later profile edits never change a
 * past invoice. `number` is FY-based, e.g. 'BA/2026-27/000001'.
 */
export interface IInvoice {
  _id: string;
  orgId: string;
  number: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  currency: InvoiceCurrency;
  lines: IInvoiceLine[];
  subtotal: number;
  taxes: IInvoiceTax[];
  total: number;
  billingProfile: Record<string, unknown>;
  supplier: Record<string, unknown>;
  paymentId?: string;
  providerRef?: string;
  periodStart?: Date;
  periodEnd?: Date;
  issuedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceLineSchema = new Schema<IInvoiceLine>(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitAmount: { type: Number, required: true },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const InvoiceTaxSchema = new Schema<IInvoiceTax>(
  {
    name: { type: String, required: true },
    rate: { type: Number, required: true },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const InvoiceSchema = new Schema<IInvoice>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    number: { type: String, required: true, unique: true, index: true },
    kind: { type: String, required: true, enum: ['subscription', 'credits'] },
    status: { type: String, default: 'paid', enum: ['paid', 'void', 'refunded'] },
    currency: { type: String, default: 'INR', enum: ['INR', 'USD'] },
    lines: { type: [InvoiceLineSchema], default: [] },
    subtotal: { type: Number, required: true },
    taxes: { type: [InvoiceTaxSchema], default: [] },
    total: { type: Number, required: true },
    billingProfile: { type: Schema.Types.Mixed, default: {} },
    supplier: { type: Schema.Types.Mixed, default: {} },
    paymentId: { type: String, index: true },
    providerRef: { type: String },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    issuedAt: { type: Date, default: Date.now },
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

InvoiceSchema.index({ orgId: 1, issuedAt: -1 });

export const Invoice: Model<IInvoice> = (mongoose.models.Invoice as any) || model<IInvoice>('Invoice', InvoiceSchema);
