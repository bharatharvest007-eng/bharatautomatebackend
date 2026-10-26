import * as models from '../models/index.js';
import { newId } from '../lib/ids.js';
import { recordStat } from './stats.js';
import { emitEvent } from './events.js';
import { notify } from './notify.js';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SOURCE_LABELS = {
    dm: 'Instagram DM',
    bio_page: 'link-in-bio page',
    ask_node: 'automation question',
    lead_form: 'lead form',
    widget: 'website chat',
    ai_agent: 'AI agent',
    api: 'API',
    import: 'import',
};
/** Lowercased, trimmed email, or undefined when it does not look like an email. */
export function normalizeEmail(value) {
    const email = value?.trim().toLowerCase();
    return email && email.length <= 254 && EMAIL_PATTERN.test(email) ? email : undefined;
}
/** Phone as '+<digits>' (or bare digits when no country prefix was given); undefined unless 7–15 digits. */
export function normalizePhone(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15)
        return undefined;
    return trimmed.startsWith('+') || trimmed.startsWith('00') ? `+${trimmed.startsWith('00') ? digits.slice(2) : digits}` : digits;
}
function cleanName(value) {
    const name = value?.replace(/\s+/g, ' ').trim();
    return name ? name.slice(0, 120) : undefined;
}
export async function captureLead(input) {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const name = cleanName(input.name);
    const lead = await models.LeadSubmission.create({
        _id: newId('lead'),
        orgId: input.orgId,
        accountId: input.accountId,
        contactId: input.contactId,
        leadCardId: input.leadCardId,
        automationId: input.automationId,
        source: input.source,
        status: 'new',
        email,
        phone,
        name,
        data: input.data ?? {},
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 300),
    });
    if (input.contactId) {
        // Only fill blanks: details the business already has (or edited) win over a form entry.
        const contact = await models.Contact.findOne({ _id: input.contactId, orgId: input.orgId }, { email: 1, phone: 1, name: 1 }).lean();
        if (contact) {
            const fill = {};
            if (email && !contact.email)
                fill.email = email;
            if (phone && !contact.phone)
                fill.phone = phone;
            if (name && !contact.name)
                fill.name = name;
            if (Object.keys(fill).length > 0) {
                await models.Contact.updateOne({ _id: contact._id, orgId: input.orgId }, { $set: fill });
            }
        }
    }
    await recordStat(input.orgId, input.accountId, 'leads_captured');
    await emitEvent(input.orgId, 'lead.created', {
        id: lead._id,
        accountId: lead.accountId,
        contactId: lead.contactId,
        source: lead.source,
        status: lead.status,
        email: lead.email,
        phone: lead.phone,
        name: lead.name,
        data: lead.data,
        leadCardId: lead.leadCardId,
        automationId: lead.automationId,
        createdAt: lead.createdAt.toISOString(),
    });
    await notify(input.orgId, {
        type: 'lead',
        severity: 'success',
        title: `New lead: ${name || email || phone || 'Unknown'}`,
        body: `Captured from ${SOURCE_LABELS[input.source] ?? input.source}.`,
        link: '/leads',
    });
    return lead;
}
