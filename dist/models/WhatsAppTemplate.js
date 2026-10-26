import mongoose, { Schema, model } from 'mongoose';
const TemplateButtonSchema = new Schema({
    type: { type: String, required: true },
    text: { type: String },
    url: { type: String },
    phone_number: { type: String },
    example: [{ type: String }],
    otp_type: { type: String },
}, { _id: false });
const TemplateComponentSchema = new Schema({
    type: { type: String, required: true },
    format: { type: String },
    text: { type: String },
    example: { type: Schema.Types.Mixed },
    buttons: { type: [TemplateButtonSchema], default: undefined },
    limited_time_offer: { type: Schema.Types.Mixed },
}, { _id: false });
const TemplateCardSchema = new Schema({
    card_index: { type: Number },
    components: { type: [TemplateComponentSchema], default: [] },
}, { _id: false });
const WhatsAppTemplateSchema = new Schema({
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
WhatsAppTemplateSchema.index({ accountId: 1, name: 1, language: 1 }, { unique: true });
export const WhatsAppTemplate = mongoose.models.WhatsAppTemplate || model('WhatsAppTemplate', WhatsAppTemplateSchema);
// ---------------------------------------------------------------------------
// Classification helpers — shared by the sync route so "what kind of template
// is this" is computed in exactly one place.
// ---------------------------------------------------------------------------
export function classifyTemplate(category, components) {
    const header = components.find((c) => c.type === 'HEADER');
    const buttonsComponent = components.find((c) => c.type === 'BUTTONS');
    const buttonTypes = (buttonsComponent?.buttons ?? []).map((b) => b.type);
    const hasCarousel = components.some((c) => c.type === 'CAROUSEL');
    const hasOffer = components.some((c) => c.type === 'LIMITED_TIME_OFFER');
    const hasCatalogButton = buttonTypes.includes('CATALOG') || buttonTypes.includes('MPM');
    let kind = 'standard';
    if (category === 'AUTHENTICATION')
        kind = 'authentication';
    else if (hasCarousel)
        kind = 'carousel';
    else if (hasOffer)
        kind = 'limited_time_offer';
    else if (hasCatalogButton)
        kind = 'catalog';
    const body = components.find((c) => c.type === 'BODY');
    const bodyVars = (body?.text?.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).length;
    const headerVars = header?.format === 'TEXT' ? (header.text?.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).length : 0;
    return {
        kind,
        headerFormat: header?.format ?? 'NONE',
        buttonTypes,
        variableCount: bodyVars + headerVars,
    };
}
