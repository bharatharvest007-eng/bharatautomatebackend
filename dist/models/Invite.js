import mongoose, { Schema, model } from 'mongoose';
const InviteSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String },
    tokenHash: { type: String, required: true, unique: true, index: true },
    invitedBy: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    acceptedAt: { type: Date },
    acceptedBy: { type: String },
}, {
    timestamps: true,
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.tokenHash;
            delete ret.__v;
            return ret;
        },
    },
});
InviteSchema.index({ orgId: 1, email: 1 });
export const Invite = mongoose.models.Invite || model('Invite', InviteSchema);
