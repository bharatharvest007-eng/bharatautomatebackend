import mongoose, { Schema, model, type Model } from 'mongoose';

export type NotificationType =
  | 'approval'
  | 'lead'
  | 'reminder'
  | 'billing'
  | 'quota'
  | 'account'
  | 'publish'
  | 'broadcast'
  | 'insight'
  | 'system';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
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

/**
 * In-app notification. `userId` targets one member; without it the
 * notification is workspace-wide. `dedupeKey` (unique per org) lets callers
 * fire "once per period" alerts such as `quota:<metric>:<YYYY-MM>` safely.
 */
export interface INotification {
  _id: string;
  orgId: string;
  userId?: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  link?: string;
  readAt?: Date;
  dedupeKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
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

NotificationSchema.index({ orgId: 1, createdAt: -1 });
NotificationSchema.index({ orgId: 1, readAt: 1 });
NotificationSchema.index(
  { orgId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

export const Notification: Model<INotification> = (mongoose.models.Notification as any) || model<INotification>('Notification', NotificationSchema);
