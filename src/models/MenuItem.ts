import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IMenuItem {
  _id: string;
  accountId: string;
  title: string;
  actionType: 'web_url' | 'postback';
  payload: Record<string, unknown>;
  parentId?: string;
  position: number;
  enabled: boolean;
  tapCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const MenuItemSchema = new Schema<IMenuItem>(
  {
    _id: { type: String, required: true },
    accountId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    actionType: { type: String, default: 'postback', enum: ['web_url', 'postback'] },
    payload: { type: Schema.Types.Mixed, default: {} },
    parentId: { type: String },
    position: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    tapCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
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

export const MenuItem: Model<IMenuItem> = (mongoose.models.MenuItem as any) || model<IMenuItem>('MenuItem', MenuItemSchema);
