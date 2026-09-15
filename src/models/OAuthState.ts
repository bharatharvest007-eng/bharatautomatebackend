import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IOAuthState {
  _id: string;
  state: string;
  orgId: string;
  userId?: string;
  mode: 'instagram' | 'facebook';
  redirectTo?: string;
  codeVerifier?: string;
  expiresAt: Date;
  createdAt: Date;
}

const OAuthStateSchema = new Schema<IOAuthState>(
  {
    _id: { type: String, required: true },
    state: { type: String, required: true, unique: true, index: true },
    orgId: { type: String, required: true },
    userId: { type: String },
    mode: { type: String, default: 'instagram' },
    redirectTo: { type: String },
    codeVerifier: { type: String },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
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

export const OAuthState: Model<IOAuthState> = (mongoose.models.OAuthState as any) || model<IOAuthState>('OAuthState', OAuthStateSchema);
