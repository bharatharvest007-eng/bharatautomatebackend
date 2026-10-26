import mongoose, { Schema, model, type Model } from 'mongoose';

/** Append-only record of security- and billing-relevant actions in a workspace. */
export interface IAuditLog {
  _id: string;
  orgId: string;
  userId?: string;
  /** Dotted verb, e.g. 'member.invited', 'api_key.created', 'subscription.changed'. */
  action: string;
  targetType?: string;
  targetId?: string;
  meta: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    userId: { type: String },
    action: { type: String, required: true },
    targetType: { type: String },
    targetId: { type: String },
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String },
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

AuditLogSchema.index({ orgId: 1, createdAt: -1 });
AuditLogSchema.index({ orgId: 1, action: 1, createdAt: -1 });

export const AuditLog: Model<IAuditLog> = (mongoose.models.AuditLog as any) || model<IAuditLog>('AuditLog', AuditLogSchema);
