import mongoose, { Schema, model } from 'mongoose';
const OrganizationSchema = new Schema({
    _id: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    plan: { type: String, default: 'unlimited', index: true },
    timezone: { type: String, default: 'UTC' },
    limits: { type: Schema.Types.Mixed, default: {} },
    settings: { type: Schema.Types.Mixed, default: {} },
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
export const Organization = mongoose.models.Organization || model('Organization', OrganizationSchema);
