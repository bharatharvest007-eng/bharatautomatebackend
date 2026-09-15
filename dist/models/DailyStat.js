import mongoose, { Schema, model } from 'mongoose';
const DailyStatSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    day: { type: String, required: true, index: true },
    metric: { type: String, required: true, index: true },
    value: { type: Number, default: 0 },
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
DailyStatSchema.index({ accountId: 1, day: 1, metric: 1 }, { unique: true });
DailyStatSchema.index({ orgId: 1, day: -1 });
export const DailyStat = mongoose.models.DailyStat || model('DailyStat', DailyStatSchema);
