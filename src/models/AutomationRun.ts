import mongoose, { Schema, model, type Model } from 'mongoose';
import type { RunContext } from '../types/index.js';

export interface IAutomationRun {
  _id: string;
  orgId: string;
  accountId: string;
  automationId?: string;
  contactId?: string;
  conversationId?: string;
  trigger: Record<string, unknown>;
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  currentNode?: string;
  context: RunContext;
  trace: unknown[];
  waitingUntil?: Date;
  waitingForKind?: string;
  error?: string;
  skipReason?: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  dedupeKey?: string;
}

const AutomationRunSchema = new Schema<IAutomationRun>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    automationId: { type: String, index: true },
    contactId: { type: String, index: true },
    conversationId: { type: String, index: true },
    trigger: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, default: 'pending', enum: ['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'skipped'], index: true },
    currentNode: { type: String },
    context: { type: Schema.Types.Mixed, default: { vars: {}, visited: [] } },
    trace: { type: [Schema.Types.Mixed], default: [] },
    waitingUntil: { type: Date, index: true },
    waitingForKind: { type: String },
    error: { type: String },
    skipReason: { type: String },
    startedAt: { type: Date, default: Date.now, index: true },
    finishedAt: { type: Date },
    durationMs: { type: Number },
    dedupeKey: { type: String, unique: true, sparse: true, index: true },
  },
  {
    timestamps: { createdAt: false, updatedAt: false },
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

export const AutomationRun: Model<IAutomationRun> = (mongoose.models.AutomationRun as any) || model<IAutomationRun>('AutomationRun', AutomationRunSchema);
