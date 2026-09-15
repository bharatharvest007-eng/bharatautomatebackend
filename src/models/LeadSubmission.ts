import mongoose, { Schema, model, type Model } from 'mongoose';

export interface ILeadSubmission {
  _id: string;
  orgId: string;
  accountId: string;
  leadCardId?: string;
  contactId?: string;
  email?: string;
  phone?: string;
  name?: string;
  data: Record<string, unknown>;
  source: 'dm' | 'bio_page' | 'ask_node';
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const LeadSubmissionSchema = new Schema<ILeadSubmission>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    leadCardId: { type: String, index: true },
    contactId: { type: String, index: true },
    email: { type: String, index: true },
    phone: { type: String },
    name: { type: String },
    data: { type: Schema.Types.Mixed, default: {} },
    source: { type: String, default: 'dm' },
    ip: { type: String },
    userAgent: { type: String },
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

LeadSubmissionSchema.index({ orgId: 1, createdAt: -1 });

export const LeadSubmission: Model<ILeadSubmission> = (mongoose.models.LeadSubmission as any) || model<ILeadSubmission>('LeadSubmission', LeadSubmissionSchema);
