import mongoose, { Schema, model } from 'mongoose';
const MembershipSchema = new Schema({
    orgId: { type: String, required: true, index: true },
    role: { type: String, default: 'owner', enum: ['owner', 'admin', 'member', 'viewer'] },
}, { _id: false });
const UserSchema = new Schema({
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    name: { type: String },
    avatarUrl: { type: String },
    passwordHash: { type: String },
    emailVerified: { type: Date },
    lastLoginAt: { type: Date },
    timezone: { type: String, default: 'UTC' },
    locale: { type: String, default: 'en' },
    isSuperAdmin: { type: Boolean, default: false },
    memberships: [MembershipSchema],
}, {
    timestamps: true,
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.passwordHash;
            delete ret.__v;
            return ret;
        },
    },
});
export const User = mongoose.models.User || model('User', UserSchema);
