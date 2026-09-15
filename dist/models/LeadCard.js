import mongoose, { Schema, model } from 'mongoose';
const FormFieldSchema = new Schema({
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, default: 'text' },
    required: { type: Boolean, default: true },
    placeholder: { type: String },
    options: [{ type: String }],
}, { _id: false });
const LeadCardSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    title: { type: String, required: true },
    subtitle: { type: String },
    buttonText: { type: String, default: 'Submit' },
    fields: [FormFieldSchema],
    successMessage: { type: String, default: 'Thanks! Check your inbox.' },
    tagsOnSubmit: [{ type: String }],
    notify: { type: Schema.Types.Mixed, default: {} },
    privacyUrl: { type: String },
    enabled: { type: Boolean, default: true },
    submitCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
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
export const LeadCard = mongoose.models.LeadCard || model('LeadCard', LeadCardSchema);
