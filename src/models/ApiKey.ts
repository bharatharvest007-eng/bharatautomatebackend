import mongoose, { Schema, model, type Model } from 'mongoose';

/** Public API key. Only sha256(rawKey) is stored in `hash`; `prefix` is the display hint. */
export interface IApiKey {
  _id: string;
  orgId: string;
  name: string;
  prefix: string;
  hash: string;
  /** 'read' and/or 'write'. */
  scopes: string[];
  /** User who created the key; API-key requests act on their behalf. */
  createdBy?: string;
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    prefix: { type: String, required: true },
    hash: { type: String, required: true, unique: true, index: true },
    scopes: [{ type: String }],
    createdBy: { type: String },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.hash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const ApiKey: Model<IApiKey> = (mongoose.models.ApiKey as any) || model<IApiKey>('ApiKey', ApiKeySchema);
