import mongoose, { Schema, model, type Model } from 'mongoose';

export type CreditLedgerKind = 'grant' | 'purchase' | 'consume' | 'expire' | 'adjust' | 'refund';

/**
 * Movements of the purchased AI-credit wallet (`Organization.creditBalance`).
 * Included monthly credits are metered in UsageCounter instead; only overflow
 * consumption lands here. `credits` is signed (negative for consume/expire).
 * The unique (orgId, kind, refId) index makes grants idempotent per payment.
 */
export interface ICreditLedger {
  _id: string;
  orgId: string;
  kind: CreditLedgerKind;
  credits: number;
  balanceAfter?: number;
  feature?: string;
  refType?: string;
  refId?: string;
  userId?: string;
  note?: string;
  createdAt: Date;
}

const CreditLedgerSchema = new Schema<ICreditLedger>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    kind: { type: String, required: true, enum: ['grant', 'purchase', 'consume', 'expire', 'adjust', 'refund'] },
    credits: { type: Number, required: true },
    balanceAfter: { type: Number },
    feature: { type: String },
    refType: { type: String },
    refId: { type: String },
    userId: { type: String },
    note: { type: String },
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

CreditLedgerSchema.index({ orgId: 1, createdAt: -1 });
CreditLedgerSchema.index(
  { orgId: 1, kind: 1, refId: 1 },
  { unique: true, partialFilterExpression: { refId: { $type: 'string' } } },
);

export const CreditLedger: Model<ICreditLedger> = (mongoose.models.CreditLedger as any) || model<ICreditLedger>('CreditLedger', CreditLedgerSchema);
