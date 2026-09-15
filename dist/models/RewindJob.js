import mongoose, { Schema, model } from 'mongoose';
const RewindJobSchema = new Schema({
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
export const RewindJob = mongoose.models.RewindJob || model('RewindJob', RewindJobSchema);
