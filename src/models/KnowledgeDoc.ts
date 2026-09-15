import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IKnowledgeDoc {
  _id: string;
  orgId: string;
  title: string;
  content: string;
  source: 'manual' | 'url' | 'file' | 'caption_import';
  sourceUrl?: string;
  chunks: { text: string; vector?: number[] }[];
  enabled: boolean;
  tokens: number;
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeDocSchema = new Schema<IKnowledgeDoc>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    source: { type: String, default: 'manual' },
    sourceUrl: { type: String },
    chunks: { type: [Schema.Types.Mixed] as any, default: [] },
    enabled: { type: Boolean, default: true },
    tokens: { type: Number, default: 0 },
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
