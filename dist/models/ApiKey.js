import mongoose, { Schema, model } from 'mongoose';
const ApiKeySchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    prefix: { type: String, required: true },
    hash: { type: String, required: true, unique: true, index: true },
    scopes: [{ type: String }],
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    _id: false,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.hash;
            delete ret.__v;
            return ret;
        },
    },
});
export const ApiKey = mongoose.models.ApiKey || model('ApiKey', ApiKeySchema);
