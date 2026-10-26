import mongoose, { Schema, model } from 'mongoose';
export const LEAD_SOURCES = ['dm', 'bio_page', 'ask_node', 'lead_form', 'widget', 'ai_agent', 'api', 'import'];
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
const LeadSubmissionSchema = new Schema({
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
LeadSubmissionSchema.index({ orgId: 1, createdAt: -1 });
LeadSubmissionSchema.index({ orgId: 1, status: 1, createdAt: -1 });
export const LeadSubmission = mongoose.models.LeadSubmission || model('LeadSubmission', LeadSubmissionSchema);
