import mongoose, { Schema, model, type Model } from 'mongoose';

export const WEBHOOK_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface IWebhookEvent {
  _id: string;
  /** Set once the event is routed to a connected account. */
  orgId?: string;
  platform: string;
  objectId?: string;
  field?: string;
  signature: string;
  payload: string;
  status: 'pending' | 'processing' | 'done' | 'failed' | 'ignored';
  attempts: number;
  error?: string;
  receivedAt: Date;
  processedAt?: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, index: true },
    platform: { type: String, default: 'instagram' },
    objectId: { type: String },
    field: { type: String },
    signature: { type: String, required: true, unique: true, index: true },
    payload: { type: String, required: true },
    status: { type: String, default: 'pending', enum: ['pending', 'processing', 'done', 'failed', 'ignored'], index: true },
    attempts: { type: Number, default: 0 },
    error: { type: String },
    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
  },
  {
    timestamps: { createdAt: false, updatedAt: false },
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

// Raw payloads contain PII; keep them 30 days. On existing databases the old plain
// receivedAt_1 index is converted to TTL by `reconcileLegacyIndexes()` (config/db.ts).
WebhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: WEBHOOK_EVENT_TTL_SECONDS });
WebhookEventSchema.index({ orgId: 1, receivedAt: -1 });

export const WebhookEvent: Model<IWebhookEvent> = (mongoose.models.WebhookEvent as any) || model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);
