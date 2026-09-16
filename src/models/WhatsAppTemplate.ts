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
 *
 * The shape below covers every template kind WhatsApp supports, not just the
 * plain header/body/footer/buttons ones:
 *  - standard: HEADER (text/image/video/document) + BODY + optional FOOTER + BUTTONS
 *  - authentication: an OTP-delivery body with a COPY_CODE / ONE_TAP / ZERO_TAP button
 *  - carousel: a shared intro + up to 10 CARDS, each with its own media + body + buttons
 *  - catalog-linked: a CATALOG or MPM (multi-product) button opening your Commerce Catalog
 *  - limited-time offer: a MARKETING template carrying an expiration + coupon code
 * We don't try to build a creation/approval flow for these — that's Meta's
 * own review process — but we mirror and classify every kind so the template
 * picker used when building an automation or campaign can group and preview
 * all of them correctly.
 */

export type ButtonType =
  | 'QUICK_REPLY'
  | 'URL'
  | 'PHONE_NUMBER'
  | 'COPY_CODE'
  | 'FLOW'
  | 'CATALOG'
  | 'MPM'
  | 'OTP'
  | 'VOICE_CALL';

export interface ITemplateButton {
  type: ButtonType | string;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string[];
  /** OTP buttons: ONE_TAP autofills, ZERO_TAP requires no user tap at all. */
  otp_type?: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP';
}

export interface ITemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | 'CAROUSEL' | 'LIMITED_TIME_OFFER';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  text?: string;
  example?: Record<string, unknown>;
  buttons?: ITemplateButton[];
  /** LIMITED_TIME_OFFER component: the offer's own text + whether a countdown shows in-thread. */
  limited_time_offer?: { text?: string; has_expiration?: boolean };
}

/** One card of a CAROUSEL template — a mini template in its own right. */
export interface ITemplateCard {
  card_index?: number;
  components: ITemplateComponent[];
}

/** Our own classification, computed at sync time so the UI can group/filter without re-deriving this. */
export type TemplateKind = 'standard' | 'authentication' | 'carousel' | 'catalog' | 'limited_time_offer';

export interface IWhatsAppTemplate {
  _id: string;
  orgId: string;
  accountId: string;
  /** Meta's template id, once synced. */
  metaTemplateId?: string;
  name: string;
  language: string;
  category: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';
  kind: TemplateKind;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'DRAFT';
  components: ITemplateComponent[];
  /** Only present on kind: 'carousel'. */
  cards: ITemplateCard[];
  /** Every variable name/index this template needs filled in when sending it. */
  variableCount: number;
  headerFormat?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' | 'NONE';
  buttonTypes: string[];
  rejectedReason?: string;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TemplateButtonSchema = new Schema<ITemplateButton>(
  {
    type: { type: String, required: true },
    text: { type: String },
    url: { type: String },
    phone_number: { type: String },
    example: [{ type: String }],
    otp_type: { type: String },
  },
  { _id: false },
);

const TemplateComponentSchema = new Schema<ITemplateComponent>(
  {
    type: { type: String, required: true },
    format: { type: String },
    text: { type: String },
    example: { type: Schema.Types.Mixed },
    buttons: { type: [TemplateButtonSchema], default: undefined },
    limited_time_offer: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const TemplateCardSchema = new Schema<ITemplateCard>(
  {
    card_index: { type: Number },
    components: { type: [TemplateComponentSchema], default: [] },
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
    kind: {
      type: String,
      default: 'standard',
      enum: ['standard', 'authentication', 'carousel', 'catalog', 'limited_time_offer'],
      index: true,
    },
    status: {
      type: String,
      default: 'DRAFT',
      enum: ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'DRAFT'],
      index: true,
    },
    components: { type: [TemplateComponentSchema], default: [] },
    cards: { type: [TemplateCardSchema], default: [] },
    variableCount: { type: Number, default: 0 },
    headerFormat: { type: String },
    buttonTypes: { type: [String], default: [] },
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

// ---------------------------------------------------------------------------
// Classification helpers — shared by the sync route so "what kind of template
// is this" is computed in exactly one place.
// ---------------------------------------------------------------------------

export function classifyTemplate(category: string, components: ITemplateComponent[]): {
  kind: TemplateKind;
  headerFormat: IWhatsAppTemplate['headerFormat'];
  buttonTypes: string[];
  variableCount: number;
} {
  const header = components.find((c) => c.type === 'HEADER');
  const buttonsComponent = components.find((c) => c.type === 'BUTTONS');
  const buttonTypes = (buttonsComponent?.buttons ?? []).map((b) => b.type);
  const hasCarousel = components.some((c) => c.type === 'CAROUSEL');
  const hasOffer = components.some((c) => c.type === 'LIMITED_TIME_OFFER');
  const hasCatalogButton = buttonTypes.includes('CATALOG') || buttonTypes.includes('MPM');

  let kind: TemplateKind = 'standard';
  if (category === 'AUTHENTICATION') kind = 'authentication';
  else if (hasCarousel) kind = 'carousel';
  else if (hasOffer) kind = 'limited_time_offer';
  else if (hasCatalogButton) kind = 'catalog';

  const body = components.find((c) => c.type === 'BODY');
  const bodyVars = (body?.text?.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).length;
  const headerVars = header?.format === 'TEXT' ? (header.text?.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).length : 0;

  return {
    kind,
    headerFormat: (header?.format as IWhatsAppTemplate['headerFormat']) ?? 'NONE',
    buttonTypes,
    variableCount: bodyVars + headerVars,
  };
}
