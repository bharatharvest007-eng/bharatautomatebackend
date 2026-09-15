import mongoose, { Schema, model } from 'mongoose';
const KnowledgeDocSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    source: { type: String, default: 'manual' },
    sourceUrl: { type: String },
    chunks: { type: [Schema.Types.Mixed], default: [] },
    enabled: { type: Boolean, default: true },
    tokens: { type: Number, default: 0 },
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
export const KnowledgeDoc = mongoose.models.KnowledgeDoc || model('KnowledgeDoc', KnowledgeDocSchema);
