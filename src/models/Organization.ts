import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IOrganization {
  _id: string;
  name: string;
  slug: string;
  plan: string;
  timezone: string;
  limits: Record<string, number>;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    plan: { type: String, default: 'unlimited', index: true },
    timezone: { type: String, default: 'UTC' },
    limits: { type: Schema.Types.Mixed, default: {} },
    settings: { type: Schema.Types.Mixed, default: {} },
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

export const Organization: Model<IOrganization> = (mongoose.models.Organization as any) || model<IOrganization>('Organization', OrganizationSchema);
