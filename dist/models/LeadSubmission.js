import mongoose, { Schema, model } from 'mongoose';
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
    source: { type: String, default: 'dm' },
    ip: { type: String },
    userAgent: { type: String },
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
LeadSubmissionSchema.index({ orgId: 1, createdAt: -1 });
export const LeadSubmission = mongoose.models.LeadSubmission || model('LeadSubmission', LeadSubmissionSchema);
