import mongoose, { Schema, model, type Model } from 'mongoose';

export interface IFormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'number' | 'select';
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface ILeadCard {
  _id: string;
  orgId: string;
  name: string;
  title: string;
  subtitle?: string;
  buttonText: string;
  fields: IFormField[];
  successMessage: string;
  tagsOnSubmit: string[];
  notify: Record<string, unknown>;
  privacyUrl?: string;
  enabled: boolean;
  submitCount: number;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const FormFieldSchema = new Schema<IFormField>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, default: 'text' },
    required: { type: Boolean, default: true },
    placeholder: { type: String },
    options: [{ type: String }],
  },
  { _id: false },
);

const LeadCardSchema = new Schema<ILeadCard>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    title: { type: String, required: true },
    subtitle: { type: String },
    buttonText: { type: String, default: 'Submit' },
    fields: [FormFieldSchema],
    successMessage: { type: String, default: 'Thanks! Check your inbox.' },
    tagsOnSubmit: [{ type: String }],
    notify: { type: Schema.Types.Mixed, default: {} },
    privacyUrl: { type: String },
    enabled: { type: Boolean, default: true },
    submitCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
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

export const LeadCard: Model<ILeadCard> = (mongoose.models.LeadCard as any) || model<ILeadCard>('LeadCard', LeadCardSchema);
