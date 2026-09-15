import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IRewindJob {
  _id: string;
  orgId: string;
  accountId: string;
  automationId: string;
  mediaId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  since?: Date;
  scanned: number;
  matched: number;
  queued: number;
  skippedWindow: number;
  skippedDuplicate: number;
  failed: number;
  error?: string;
  cursor?: string;
  dryRun: boolean;
  startedAt?: Date;
  finishedAt?: Date;
  createdBy?: string;
  createdAt: Date;
}

const RewindJobSchema = new Schema<IRewindJob>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    automationId: { type: String, required: true, index: true },
    mediaId: { type: String },
    status: { type: String, default: 'pending', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'], index: true },
    since: { type: Date },
    scanned: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    queued: { type: Number, default: 0 },
    skippedWindow: { type: Number, default: 0 },
    skippedDuplicate: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    error: { type: String },
    cursor: { type: String },
    dryRun: { type: Boolean, default: false },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    createdBy: { type: String },
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

export const RewindJob: Model<IRewindJob> = (mongoose.models.RewindJob as any) || model<IRewindJob>('RewindJob', RewindJobSchema);
