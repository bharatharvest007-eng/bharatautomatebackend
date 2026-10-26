import mongoose, { Schema, model, type Model } from 'mongoose';

/**
 * Named monotonic sequences (e.g. GST invoice numbers per financial year).
 * `_id` is the counter name; use `nextSequence(name)` from `src/lib/ids.ts`.
 */
export interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  {
    timestamps: false,
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

export const Counter: Model<ICounter> = (mongoose.models.Counter as any) || model<ICounter>('Counter', CounterSchema);
