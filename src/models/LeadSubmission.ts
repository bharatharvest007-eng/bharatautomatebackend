import mongoose, { Schema, model, type Model } from 'mongoose';

export type LeadSource = 'dm' | 'bio_page' | 'ask_node' | 'lead_form' | 'widget' | 'ai_agent' | 'api' | 'import';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';

export const LEAD_SOURCES: readonly LeadSource[] = ['dm', 'bio_page', 'ask_node', 'lead_form', 'widget', 'ai_agent', 'api', 'import'];
export const LEAD_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost'];

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
  source: LeadSource;
  status: LeadStatus;
  /** Expected deal value in the workspace's currency (major units). */
  value?: number;
  notes?: string;
  score?: number;
  automationId?: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
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
    source: { type: String, default: 'dm', enum: LEAD_SOURCES },
    status: { type: String, default: 'new', enum: LEAD_STATUSES },
    value: { type: Number, min: 0 },
    notes: { type: String },
    score: { type: Number, min: 0, max: 100 },
    automationId: { type: String, index: true },
    ip: { type: String },
    userAgent: { type: String },
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

LeadSubmissionSchema.index({ orgId: 1, createdAt: -1 });
LeadSubmissionSchema.index({ orgId: 1, status: 1, createdAt: -1 });

export const LeadSubmission: Model<ILeadSubmission> = (mongoose.models.LeadSubmission as any) || model<ILeadSubmission>('LeadSubmission', LeadSubmissionSchema);
