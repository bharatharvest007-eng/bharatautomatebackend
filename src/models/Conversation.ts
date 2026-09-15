import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IConversation {
  _id: string;
  orgId: string;
  accountId: string;
  contactId: string;
  status: 'open' | 'closed' | 'snoozed';
  isRead: boolean;
  isFavorite: boolean;
  assignedTo?: string;
  labels: string[];
  note?: string;
  snoozedUntil?: Date;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
  lastMessageAt: Date;
  lastMessagePreview?: string;
  unreadCount: number;
  messageCount: number;
  humanHandover: boolean;
  handoverAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    status: { type: String, default: 'open', enum: ['open', 'closed', 'snoozed'], index: true },
    isRead: { type: Boolean, default: false },
    isFavorite: { type: Boolean, default: false },
    assignedTo: { type: String, index: true },
    labels: [{ type: String }],
    note: { type: String },
    snoozedUntil: { type: Date },
    lastInboundAt: { type: Date },
    lastOutboundAt: { type: Date },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String },
    unreadCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    humanHandover: { type: Boolean, default: false },
    handoverAt: { type: Date },
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

ConversationSchema.index({ accountId: 1, contactId: 1 }, { unique: true });
ConversationSchema.index({ orgId: 1, status: 1, lastMessageAt: -1 });

export const Conversation: Model<IConversation> = (mongoose.models.Conversation as any) || model<IConversation>('Conversation', ConversationSchema);
