import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IJob {
  _id: string;
  queue: string;
  name: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'active' | 'done' | 'failed' | 'delayed' | 'cancelled';
  priority: number;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lockedBy?: string;
  lockedAt?: Date;
  lockExpiresAt?: Date;
  dedupeKey?: string;
  groupKey?: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  finishedAt?: Date;
}

const JobSchema = new Schema<IJob>(
  {
    _id: { type: String, required: true },
    queue: { type: String, required: true, index: true },
    name: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, default: 'pending', enum: ['pending', 'active', 'done', 'failed', 'delayed', 'cancelled'], index: true },
    priority: { type: Number, default: 0 },
    runAt: { type: Date, default: Date.now, index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lockedBy: { type: String },
    lockedAt: { type: Date },
    lockExpiresAt: { type: Date, index: true },
    dedupeKey: { type: String, unique: true, sparse: true, index: true },
    groupKey: { type: String, index: true },
    result: { type: Schema.Types.Mixed },
    error: { type: String },
    finishedAt: { type: Date },
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

JobSchema.index({ status: 1, runAt: 1, priority: -1 });

export const Job: Model<IJob> = (mongoose.models.Job as any) || model<IJob>('Job', JobSchema);
