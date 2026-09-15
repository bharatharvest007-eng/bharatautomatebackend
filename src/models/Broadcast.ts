import mongoose, { Schema, model, type Model } from 'mongoose';
import type { AudienceFilter, MessageContent } from '../types/index.js';

/**
 * A one-time or scheduled send to a segment of contacts.
 *
 * WhatsApp broadcasts must reference an approved template (Meta rejects free
 * text outside the 24h window); Instagram and Facebook broadcasts send
 * `content` directly to anyone whose messaging window is still open. The
 * sender enforces that distinction — see `broadcasts.routes.ts`.
 */

export interface IBroadcast {
  _id: string;
  orgId: string;
  accountId: string;
  platform: string;
  name: string;
  content?: MessageContent;
  /** WhatsApp only: which approved template to send, and the values for its variables. */
  templateId?: string;
  templateParams?: Record<string, string>;
  audience: AudienceFilter;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'failed' | 'cancelled';
  scheduledFor?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  /** Sends per minute — keeps a broadcast from tripping platform rate limits. */
  throttlePerMinute: number;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  deliveredCount: number;
  readCount: number;
  clickCount: number;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BroadcastSchema = new Schema<IBroadcast>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    platform: { type: String, required: true, index: true },
    name: { type: String, required: true },
    content: { type: Schema.Types.Mixed },
    templateId: { type: String },
    templateParams: { type: Schema.Types.Mixed, default: {} },
    audience: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      default: 'draft',
      enum: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'failed', 'cancelled'],
      index: true,
    },
    scheduledFor: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    throttlePerMinute: { type: Number, default: 30 },
    totalCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    readCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    createdBy: { type: String },
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

BroadcastSchema.index({ orgId: 1, status: 1 });

export const Broadcast: Model<IBroadcast> =
  (mongoose.models.Broadcast as any) || model<IBroadcast>('Broadcast', BroadcastSchema);

// --- per-recipient send record ----------------------------------------------

export interface IBroadcastRecipient {
  _id: string;
  broadcastId: string;
  contactId: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  error?: string;
  sentAt?: Date;
}

const BroadcastRecipientSchema = new Schema<IBroadcastRecipient>(
  {
    _id: { type: String, required: true },
    broadcastId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    status: { type: String, default: 'pending', enum: ['pending', 'sent', 'failed', 'skipped'] },
    error: { type: String },
    sentAt: { type: Date },
  },
  { timestamps: false, _id: false },
);

BroadcastRecipientSchema.index({ broadcastId: 1, contactId: 1 }, { unique: true });
BroadcastRecipientSchema.index({ broadcastId: 1, status: 1 });

export const BroadcastRecipient: Model<IBroadcastRecipient> =
  (mongoose.models.BroadcastRecipient as any) ||
  model<IBroadcastRecipient>('BroadcastRecipient', BroadcastRecipientSchema);
