import mongoose, { Schema, model, type Model } from 'mongoose';

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

/** One outbound webhook delivery (with retries). Kept for 30 days for the deliveries log. */
export interface IWebhookDelivery {
  _id: string;
  orgId: string;
  endpointId: string;
  event: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus?: number;
  durationMs?: number;
  error?: string;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookDeliverySchema = new Schema<IWebhookDelivery>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    endpointId: { type: String, required: true, index: true },
    event: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, default: 'pending', enum: ['pending', 'success', 'failed'] },
    attempts: { type: Number, default: 0 },
    responseStatus: { type: Number },
    durationMs: { type: Number },
    error: { type: String },
    deliveredAt: { type: Date },
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

WebhookDeliverySchema.index({ orgId: 1, endpointId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookDelivery: Model<IWebhookDelivery> = (mongoose.models.WebhookDelivery as any) || model<IWebhookDelivery>('WebhookDelivery', WebhookDeliverySchema);
