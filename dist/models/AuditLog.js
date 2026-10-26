import mongoose, { Schema, model } from 'mongoose';
const AuditLogSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    userId: { type: String },
    action: { type: String, required: true },
    targetType: { type: String },
    targetId: { type: String },
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String },
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
AuditLogSchema.index({ orgId: 1, createdAt: -1 });
AuditLogSchema.index({ orgId: 1, action: 1, createdAt: -1 });
export const AuditLog = mongoose.models.AuditLog || model('AuditLog', AuditLogSchema);
