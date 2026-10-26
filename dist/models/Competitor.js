import mongoose, { Schema, model } from 'mongoose';
const CompetitorSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    igUserId: { type: String },
    name: { type: String },
    profilePictureUrl: { type: String },
    biography: { type: String },
    website: { type: String },
    followers: { type: Number },
    mediaCount: { type: Number },
    lastSyncedAt: { type: Date },
    lastError: { type: String },
    enabled: { type: Boolean, default: true },
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
CompetitorSchema.index({ orgId: 1, username: 1 }, { unique: true });
export const Competitor = mongoose.models.Competitor || model('Competitor', CompetitorSchema);
