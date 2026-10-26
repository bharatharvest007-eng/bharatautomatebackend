import mongoose, { Schema, model, type Model } from 'mongoose';

/**
 * A pending invitation to join a workspace. The raw invite token is only ever
 * shown once (as a copyable link); the DB keeps its sha256 hash. Expired
 * invites are removed by the TTL index on `expiresAt`.
 */
export interface IInvite {
  _id: string;
  orgId: string;
  email: string;
  name?: string;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt?: Date;
  acceptedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InviteSchema = new Schema<IInvite>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String },
    tokenHash: { type: String, required: true, unique: true, index: true },
    invitedBy: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    acceptedAt: { type: Date },
    acceptedBy: { type: String },
  },
  {
    timestamps: true,
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.tokenHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

InviteSchema.index({ orgId: 1, email: 1 });

export const Invite: Model<IInvite> = (mongoose.models.Invite as any) || model<IInvite>('Invite', InviteSchema);
