import mongoose, { Schema, model, type Model } from 'mongoose';

/**
 * A customer-registered URL that receives outbound event webhooks.
 * `secret` is stored encrypted (`encryptSecret`) and used to sign each
 * delivery; it is stripped from JSON output. `events` holds AppEvent names or '*'.
 */
export interface IWebhookEndpoint {
  _id: string;
  orgId: string;
  url: string;
  description?: string;
  secret: string;
  events: string[];
  enabled: boolean;
  /** Consecutive failed deliveries; the endpoint is disabled after too many. */
  failureCount: number;
  lastDeliveryAt?: Date;
  /** HTTP status of the last delivery attempt (0 = network error / timeout). */
  lastStatus?: number;
  lastError?: string;
  disabledAt?: Date;
  disabledReason?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookEndpointSchema = new Schema<IWebhookEndpoint>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    url: { type: String, required: true },
    description: { type: String },
    secret: { type: String, required: true },
    events: { type: [String], default: ['*'] },
    enabled: { type: Boolean, default: true },
    failureCount: { type: Number, default: 0 },
    lastDeliveryAt: { type: Date },
    lastStatus: { type: Number },
    lastError: { type: String },
    disabledAt: { type: Date },
    disabledReason: { type: String },
    createdBy: { type: String },
  },
  {
    timestamps: true,
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.secret;
        delete ret.__v;
        return ret;
      },
    },
  },
);

WebhookEndpointSchema.index({ orgId: 1, enabled: 1 });

export const WebhookEndpoint: Model<IWebhookEndpoint> = (mongoose.models.WebhookEndpoint as any) || model<IWebhookEndpoint>('WebhookEndpoint', WebhookEndpointSchema);
