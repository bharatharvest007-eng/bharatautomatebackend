import mongoose, { Schema, model } from 'mongoose';
const ConversationSchema = new Schema({
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
}, {
    timestamps: true,
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
});
ConversationSchema.index({ accountId: 1, contactId: 1 }, { unique: true });
ConversationSchema.index({ orgId: 1, status: 1, lastMessageAt: -1 });
export const Conversation = mongoose.models.Conversation || model('Conversation', ConversationSchema);
