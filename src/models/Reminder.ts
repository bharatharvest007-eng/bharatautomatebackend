import mongoose, { Schema, model, type Model } from 'mongoose';

/** A team-inbox follow-up: "check back on this conversation at X". */
export interface IReminder {
  _id: string;
  orgId: string;
  conversationId: string;
  userId?: string;
  note: string;
  remindAt: Date;
  doneAt?: Date;
  createdAt: Date;
}

const ReminderSchema = new Schema<IReminder>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    userId: { type: String, index: true },
    note: { type: String, required: true },
    remindAt: { type: Date, required: true, index: true },
    doneAt: { type: Date },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

ReminderSchema.index({ orgId: 1, remindAt: 1, doneAt: 1 });

export const Reminder: Model<IReminder> = (mongoose.models.Reminder as any) || model<IReminder>('Reminder', ReminderSchema);
