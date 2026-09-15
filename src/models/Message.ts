import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IMessage {
  _id: string;
  orgId: string;
  accountId: string;
  conversationId: string;
  contactId: string;
  direction: 'in' | 'out';
  type: string;
  text?: string;
  payload: Record<string, unknown>;
  attachments: unknown[];
  externalId?: string;
  replyToId?: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
  error?: string;
  errorCode?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  automationId?: string;
  runId?: string;
  broadcastId?: string;
  sentByUserId?: string;
  isEcho: boolean;
  messageTag?: string;
  createdAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    direction: { type: String, required: true, enum: ['in', 'out'], index: true },
    type: { type: String, default: 'text' },
    text: { type: String },
    payload: { type: Schema.Types.Mixed, default: {} },
    attachments: { type: [Schema.Types.Mixed], default: [] },
    externalId: { type: String, unique: true, sparse: true, index: true },
    replyToId: { type: String },
    status: { type: String, default: 'sent', enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'] },
    error: { type: String },
    errorCode: { type: String },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    automationId: { type: String, index: true },
    runId: { type: String, index: true },
    broadcastId: { type: String },
    sentByUserId: { type: String },
    isEcho: { type: Boolean, default: false },
    messageTag: { type: String },
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

MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ orgId: 1, createdAt: -1 });

export const Message: Model<IMessage> = (mongoose.models.Message as any) || model<IMessage>('Message', MessageSchema);
