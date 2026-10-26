import mongoose, { Schema, model, type Model } from 'mongoose';

export interface ISession {
  _id: string;
  userId: string;
  /** sha256 hex of the bearer token — the raw token is never stored. */
  token: string;
  orgId?: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  lastSeenAt?: Date;
  createdAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    orgId: { type: String },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    lastSeenAt: { type: Date },
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

export const Session: Model<ISession> = (mongoose.models.Session as any) || model<ISession>('Session', SessionSchema);
