import mongoose, { Schema, model } from 'mongoose';
const InsightReportSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, index: true },
    kind: { type: String, default: 'weekly', enum: ['weekly', 'adhoc'] },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    headline: { type: String, required: true },
    summary: { type: String, default: '' },
    sections: { type: Schema.Types.Mixed, default: {} },
    metrics: { type: Schema.Types.Mixed, default: {} },
    recommendations: { type: Schema.Types.Mixed, default: () => [] },
    model: { type: String },
    credits: { type: Number },
}, {
    timestamps: true,
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
InsightReportSchema.index({ orgId: 1, createdAt: -1 });
InsightReportSchema.index({ orgId: 1, kind: 1, periodEnd: -1 });
export const InsightReport = mongoose.models.InsightReport || model('InsightReport', InsightReportSchema);
