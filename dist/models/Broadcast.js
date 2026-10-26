import mongoose, { Schema, model } from 'mongoose';
const BroadcastSchema = new Schema({
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
BroadcastSchema.index({ orgId: 1, status: 1 });
export const Broadcast = mongoose.models.Broadcast || model('Broadcast', BroadcastSchema);
const BroadcastRecipientSchema = new Schema({
    _id: { type: String, required: true },
    broadcastId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    status: { type: String, default: 'pending', enum: ['pending', 'sent', 'failed', 'skipped'] },
    error: { type: String },
    sentAt: { type: Date },
}, { timestamps: false, _id: false });
BroadcastRecipientSchema.index({ broadcastId: 1, contactId: 1 }, { unique: true });
BroadcastRecipientSchema.index({ broadcastId: 1, status: 1 });
export const BroadcastRecipient = mongoose.models.BroadcastRecipient ||
    model('BroadcastRecipient', BroadcastRecipientSchema);
