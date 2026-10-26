import mongoose, { Schema, model, type Model } from 'mongoose';

/**
 * Raw billing-provider webhook events. The unique `eventId` makes webhook
 * processing idempotent: providers retry deliveries, and a duplicate insert
 * means the event was already handled.
 */
export interface IBillingEvent {
  _id: string;
  provider: string;
  eventId: string;
  type: string;
  orgId?: string;
  payload: Record<string, unknown>;
  processedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BillingEventSchema = new Schema<IBillingEvent>(
  {
    _id: { type: String, required: true },
    provider: { type: String, required: true },
    eventId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true },
    orgId: { type: String, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    processedAt: { type: Date },
    error: { type: String },
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

export const BillingEvent: Model<IBillingEvent> = (mongoose.models.BillingEvent as any) || model<IBillingEvent>('BillingEvent', BillingEventSchema);
