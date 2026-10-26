import mongoose, { Schema, model } from 'mongoose';
const ReminderSchema = new Schema({
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    userId: { type: String, index: true },
    note: { type: String, required: true },
    remindAt: { type: Date, required: true, index: true },
    doneAt: { type: Date },
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
ReminderSchema.index({ orgId: 1, remindAt: 1, doneAt: 1 });
export const Reminder = mongoose.models.Reminder || model('Reminder', ReminderSchema);
