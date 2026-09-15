import mongoose, { Schema, model, type Model } from 'mongoose';
import type { MessageContent } from '../types/index.js';

export interface ITemplate {
  _id: string;
  orgId: string;
  name: string;
  category: string;
  content: MessageContent;
  usedCount: number;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TemplateSchema = new Schema<ITemplate>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    category: { type: String, default: 'general', index: true },
    content: { type: Schema.Types.Mixed, default: { kind: 'text', text: '' } },
    usedCount: { type: Number, default: 0 },
    createdBy: { type: String },
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

export const Template: Model<ITemplate> = (mongoose.models.Template as any) || model<ITemplate>('Template', TemplateSchema);
