import mongoose, { Schema, model } from 'mongoose';
const OAuthStateSchema = new Schema({
    _id: { type: String, required: true },
    state: { type: String, required: true, unique: true, index: true },
    orgId: { type: String, required: true },
    userId: { type: String },
    mode: { type: String, default: 'instagram' },
    redirectTo: { type: String },
    codeVerifier: { type: String },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
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
export const OAuthState = mongoose.models.OAuthState || model('OAuthState', OAuthStateSchema);
