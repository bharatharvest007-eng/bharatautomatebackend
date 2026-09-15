import mongoose, { Schema, model } from 'mongoose';
const JobSchema = new Schema({
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
}, {
    timestamps: { createdAt: true, updatedAt: false },
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        },
    },
});
JobSchema.index({ status: 1, runAt: 1, priority: -1 });
export const Job = mongoose.models.Job || model('Job', JobSchema);
