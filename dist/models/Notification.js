import mongoose, { Schema, model } from 'mongoose';
export const NOTIFICATION_TYPES = [
    'approval',
    'lead',
    'reminder',
    'billing',
    'quota',
    'account',
    'publish',
    'broadcast',
    'insight',
    'system',
];
const NotificationSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    userId: { type: String, index: true },
    type: { type: String, required: true, enum: NOTIFICATION_TYPES },
    severity: { type: String, default: 'info', enum: ['info', 'success', 'warning', 'error'] },
    title: { type: String, required: true },
    body: { type: String },
    link: { type: String },
    readAt: { type: Date },
    dedupeKey: { type: String },
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
NotificationSchema.index({ orgId: 1, createdAt: -1 });
NotificationSchema.index({ orgId: 1, readAt: 1 });
NotificationSchema.index({ orgId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
export const Notification = mongoose.models.Notification || model('Notification', NotificationSchema);
