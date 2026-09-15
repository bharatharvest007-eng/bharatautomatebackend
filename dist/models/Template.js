import mongoose, { Schema, model } from 'mongoose';
const TemplateSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    category: { type: String, default: 'general', index: true },
    content: { type: Schema.Types.Mixed, default: { kind: 'text', text: '' } },
    usedCount: { type: Number, default: 0 },
    createdBy: { type: String },
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
export const Template = mongoose.models.Template || model('Template', TemplateSchema);
