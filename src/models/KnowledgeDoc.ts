import mongoose, { Schema, model, type Model } from 'mongoose';

/** Where the document came from (the spec's "sourceType"). */
export type KnowledgeDocSource = 'manual' | 'text' | 'faq' | 'url' | 'file' | 'caption_import';
export type KnowledgeDocStatus = 'ready' | 'processing' | 'error';

export interface IKnowledgeDoc {
  _id: string;
  orgId: string;
  /** Restricts the doc to one account's agent; unset = workspace-wide. */
  accountId?: string;
  title: string;
  content: string;
  source: KnowledgeDocSource;
  sourceUrl?: string;
  chunks: { text: string; vector?: number[] }[];
  enabled: boolean;
  tokens: number;
  status: KnowledgeDocStatus;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeDocSchema = new Schema<IKnowledgeDoc>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    source: { type: String, default: 'manual' },
    sourceUrl: { type: String },
    chunks: { type: [Schema.Types.Mixed] as any, default: [] },
    enabled: { type: Boolean, default: true },
    tokens: { type: Number, default: 0 },
    status: { type: String, default: 'ready', enum: ['ready', 'processing', 'error'] },
    error: { type: String },
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

export const KnowledgeDoc: Model<IKnowledgeDoc> = (mongoose.models.KnowledgeDoc as any) || model<IKnowledgeDoc>('KnowledgeDoc', KnowledgeDocSchema);
