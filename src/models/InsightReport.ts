import mongoose, { Schema, model, type Model } from 'mongoose';

export type InsightReportKind = 'weekly' | 'adhoc';

/** An AI-written performance report (weekly digest or on-demand). */
export interface IInsightReport {
  _id: string;
  orgId: string;
  accountId?: string;
  kind: InsightReportKind;
  periodStart: Date;
  periodEnd: Date;
  headline: string;
  summary: string;
  sections: Record<string, unknown>;
  metrics: Record<string, unknown>;
  recommendations: Record<string, unknown>[];
  model?: string;
  credits?: number;
  createdAt: Date;
  updatedAt: Date;
}

const InsightReportSchema = new Schema<IInsightReport>(
  {
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

InsightReportSchema.index({ orgId: 1, createdAt: -1 });
InsightReportSchema.index({ orgId: 1, kind: 1, periodEnd: -1 });

export const InsightReport: Model<IInsightReport> = (mongoose.models.InsightReport as any) || model<IInsightReport>('InsightReport', InsightReportSchema);
