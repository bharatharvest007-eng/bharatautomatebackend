import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IWebhookEvent {
  _id: string;
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
    platform: { type: String, default: 'instagram' },
    objectId: { type: String },
    field: { type: String },
    signature: { type: String, required: true, unique: true, index: true },
    payload: { type: String, required: true },
    status: { type: String, default: 'pending', enum: ['pending', 'processing', 'done', 'failed', 'ignored'], index: true },
    attempts: { type: Number, default: 0 },
    error: { type: String },
    receivedAt: { type: Date, default: Date.now, index: true },
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

export const WebhookEvent: Model<IWebhookEvent> = (mongoose.models.WebhookEvent as any) || model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);
