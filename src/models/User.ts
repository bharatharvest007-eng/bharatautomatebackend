import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IMembership {
  orgId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

export interface IUser {
  _id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  passwordHash?: string;
  emailVerified?: Date;
  lastLoginAt?: Date;
  timezone: string;
  locale: string;
  isSuperAdmin: boolean;
  memberships: IMembership[];
  createdAt: Date;
  updatedAt: Date;
}

const MembershipSchema = new Schema<IMembership>(
  {
    orgId: { type: String, required: true, index: true },
    role: { type: String, default: 'owner', enum: ['owner', 'admin', 'member', 'viewer'] },
  },
  { _id: false },
);

const UserSchema = new Schema<IUser>(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    name: { type: String },
    avatarUrl: { type: String },
    passwordHash: { type: String },
    emailVerified: { type: Date },
    lastLoginAt: { type: Date },
    timezone: { type: String, default: 'UTC' },
    locale: { type: String, default: 'en' },
    isSuperAdmin: { type: Boolean, default: false },
    memberships: [MembershipSchema],
  },
  {
    timestamps: true,
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const User: Model<IUser> = (mongoose.models.User as any) || model<IUser>('User', UserSchema);
