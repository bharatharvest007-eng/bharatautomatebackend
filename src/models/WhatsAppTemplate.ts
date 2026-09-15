import mongoose, { Schema, model, type Model } from 'mongoose';

/**
 * WhatsApp message templates (HSMs).
 *
 * Not the same thing as our own `Template` model — that holds reusable
 * message snippets we compose freely. A WhatsApp template is pre-approved by
 * Meta, has a fixed structure, and is the *only* way to start a conversation
 * with someone (or message them again after the 24h window closes). We mirror
 * Meta's own list here so automations and broadcasts can pick from what's
 * actually usable without a round trip on every send.
 */

export interface ITemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  text?: string;
  example?: Record<string, unknown>;
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[];
}

export interface IWhatsAppTemplate {
  _id: string;
  orgId: string;
  accountId: string;
  /** Meta's template id, once synced. */
  metaTemplateId?: string;
  name: string;
  language: string;
  category: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'DRAFT';
  components: ITemplateComponent[];
  rejectedReason?: string;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TemplateComponentSchema = new Schema<ITemplateComponent>(
  {
    type: { type: String, required: true },
    format: { type: String },
    text: { type: String },
    example: { type: Schema.Types.Mixed },
    buttons: [{ type: Schema.Types.Mixed }],
  },
  { _id: false },
);

const WhatsAppTemplateSchema = new Schema<IWhatsAppTemplate>(
  {
    _id: { type: String, required: true },
    orgId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    metaTemplateId: { type: String },
    name: { type: String, required: true },
    language: { type: String, default: 'en_US' },
    category: { type: String, default: 'UTILITY', enum: ['AUTHENTICATION', 'MARKETING', 'UTILITY'] },
    status: {
      type: String,
      default: 'DRAFT',
      enum: ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'DRAFT'],
      index: true,
    },
    components: { type: [TemplateComponentSchema], default: [] },
    rejectedReason: { type: String },
    lastSyncedAt: { type: Date },
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

WhatsAppTemplateSchema.index({ accountId: 1, name: 1, language: 1 }, { unique: true });

export const WhatsAppTemplate: Model<IWhatsAppTemplate> =
  (mongoose.models.WhatsAppTemplate as any) || model<IWhatsAppTemplate>('WhatsAppTemplate', WhatsAppTemplateSchema);
