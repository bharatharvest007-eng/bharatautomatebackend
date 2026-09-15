import mongoose, { Schema, model, type Model } from 'mongoose';
import type { AutomationTrigger, FlowDefinition } from '../types/index.js';

export interface IAutomation {
  _id: string;
  orgId: string;
  accountId: string;
  name: string;
  description?: string;
  type: string;
  status: 'draft' | 'live' | 'paused' | 'disabled' | 'archived';
  priority: number;
  trigger: AutomationTrigger;
  flow: FlowDefinition;
  keywords: string[];
  mediaIds: string[];
  cooldownHours?: number;
  oncePerContact: boolean;
  maxRunsPerDay?: number;
  respectQuietHours: boolean;
  triggeredCount: number;
  sentCount: number;
  clickCount: number;
  leadCount: number;
  failedCount: number;
  lastTriggeredAt?: Date;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AutomationSchema = new Schema<IAutomation>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    type: { type: String, required: true, index: true },
    status: { type: String, default: 'draft', enum: ['draft', 'live', 'paused', 'disabled', 'archived'], index: true },
    priority: { type: Number, default: 0 },
    trigger: { type: Schema.Types.Mixed, default: {} },
    flow: { type: Schema.Types.Mixed, default: { version: 1, entry: 'start', nodes: [] } },
    keywords: [{ type: String, index: true }],
    mediaIds: [{ type: String, index: true }],
    cooldownHours: { type: Number },
    oncePerContact: { type: Boolean, default: false },
    maxRunsPerDay: { type: Number },
    respectQuietHours: { type: Boolean, default: true },
    triggeredCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    leadCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    lastTriggeredAt: { type: Date },
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

AutomationSchema.index({ accountId: 1, status: 1, priority: -1 });

export const Automation: Model<IAutomation> = (mongoose.models.Automation as any) || model<IAutomation>('Automation', AutomationSchema);
