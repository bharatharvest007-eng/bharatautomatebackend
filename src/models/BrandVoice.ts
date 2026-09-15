import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IBrandVoice {
  _id: string;
  orgId: string;
  accountId: string;
  tone: string;
  description?: string;
  examples: string[];
  rules: string[];
  emojiUsage: 'none' | 'light' | 'heavy';
  language: string;
  signature?: string;
  autoReplyEnabled: boolean;
  autoReplyThreshold: number;
  spamGuardEnabled: boolean;
  spamAutoHide: boolean;
  spamAutoDelete: boolean;
  spamThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

const BrandVoiceSchema = new Schema<IBrandVoice>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, unique: true, index: true },
    tone: { type: String, default: 'friendly' },
    description: { type: String },
    examples: [{ type: String }],
    rules: [{ type: String }],
    emojiUsage: { type: String, default: 'light', enum: ['none', 'light', 'heavy'] },
    language: { type: String, default: 'auto' },
    signature: { type: String },
    autoReplyEnabled: { type: Boolean, default: false },
    autoReplyThreshold: { type: Number, default: 0.7 },
    spamGuardEnabled: { type: Boolean, default: false },
    spamAutoHide: { type: Boolean, default: true },
    spamAutoDelete: { type: Boolean, default: false },
    spamThreshold: { type: Number, default: 0.85 },
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

export const BrandVoice: Model<IBrandVoice> = (mongoose.models.BrandVoice as any) || model<IBrandVoice>('BrandVoice', BrandVoiceSchema);
