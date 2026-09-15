import mongoose, { Schema, model } from 'mongoose';
const MenuItemSchema = new Schema({
    _id: { type: String, required: true },
    accountId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    actionType: { type: String, default: 'postback', enum: ['web_url', 'postback'] },
    payload: { type: Schema.Types.Mixed, default: {} },
    parentId: { type: String },
    position: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    tapCount: { type: Number, default: 0 },
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
export const MenuItem = mongoose.models.MenuItem || model('MenuItem', MenuItemSchema);
