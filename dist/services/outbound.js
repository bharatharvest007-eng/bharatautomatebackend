/**
 * Channel-agnostic send to one contact. Initial version by the foundation;
 * owned by D3 (channels) afterwards.
 *
 * Used by the inbox, approvals, broadcasts and the public API so every
 * outbound message gets the same treatment: plan quota, opt-out/block and
 * 24-hour-window rules, the right channel API, a persisted `Message`, updated
 * conversation/contact counters, metering, stats and the 'message.sent' event.
 *
 * Failures are returned (`{ success: false, error, code }`), never thrown, so
 * batch senders can carry on with the next recipient.
 */
import * as models from '../models/index.js';
import { accountToken } from '../lib/crypto.js';
import { newId } from '../lib/ids.js';
import { MetaService } from './metaService.js';
import { WhatsAppService } from './whatsappService.js';
import { checkQuota } from './entitlements.js';
import { recordUsage } from './usage.js';
import { recordStat } from './stats.js';
import { emitEvent } from './events.js';
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 24 * HOUR_MS;
const HUMAN_AGENT_WINDOW_MS = 7 * 24 * HOUR_MS;
const MAX_META_BUTTONS = 3;
const PREVIEW_CHARS = 140;
/** True when the contact's last inbound message is less than 24 hours old (Meta's standard messaging window). */
export function isWithin24hWindow(lastInboundAt) {
    if (!lastInboundAt)
        return false;
    const at = new Date(lastInboundAt).getTime();
    return Number.isFinite(at) && Date.now() - at < WINDOW_MS;
}
function isWithinHumanAgentWindow(lastInboundAt) {
    if (!lastInboundAt)
        return false;
    const at = new Date(lastInboundAt).getTime();
    return Number.isFinite(at) && Date.now() - at < HUMAN_AGENT_WINDOW_MS;
}
/** Human-readable text of a message, for previews and the Message `text` field. */
export function contentPreviewText(content) {
    switch (content.kind) {
        case 'text':
        case 'buttons':
        case 'interactive_list':
        case 'location_request':
            return content.text;
        case 'cards':
            return content.cards.map((card) => [card.title, card.subtitle].filter(Boolean).join(' — ')).join('\n');
        case 'image':
        case 'video':
            return content.caption || `[${content.kind}]`;
        case 'audio':
            return '[audio]';
        case 'file':
            return content.filename ? `[file: ${content.filename}]` : '[file]';
        case 'whatsapp_template':
            return `[template: ${content.templateName}]`;
        case 'catalog':
            return content.bodyText || '[products]';
        case 'sticker':
            return '[sticker]';
        case 'reaction':
            return '[reaction]';
        case 'media_share':
            return '[shared post]';
        case 'template':
            return '[saved reply]';
        default:
            return '';
    }
}
function clip(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
/** Maps our button model to what the IG/FB Send API accepts (web_url and postback only). */
function toMetaButtons(buttons) {
    const mapped = [];
    for (const button of buttons ?? []) {
        switch (button.type) {
            case 'url':
                mapped.push({ title: button.title, url: button.url });
                break;
            case 'postback':
                mapped.push({ title: button.title, payload: button.payload });
                break;
            case 'whatsapp': {
                const digits = button.phone.replace(/\D/g, '');
                const text = button.prefilledText ? `?text=${encodeURIComponent(button.prefilledText)}` : '';
                if (digits)
                    mapped.push({ title: button.title, url: `https://wa.me/${digits}${text}` });
                break;
            }
            // tel: and mailto: links are not valid web_url buttons on Instagram/Messenger; callers get them as text instead.
            default:
                break;
        }
    }
    return mapped.slice(0, MAX_META_BUTTONS);
}
/** Contact details from phone/email buttons that cannot be rendered as Meta buttons. */
function inlineContactLines(buttons) {
    const lines = [];
    for (const button of buttons ?? []) {
        if (button.type === 'phone')
            lines.push(`${button.title}: ${button.phone}`);
        if (button.type === 'email')
            lines.push(`${button.title}: ${button.email}`);
    }
    return lines;
}
/** IG/FB rendering: text plus up to three buttons. Returns null for kinds those channels cannot carry. */
function toMetaMessage(content) {
    switch (content.kind) {
        case 'text':
            return { text: content.text };
        case 'buttons': {
            const extra = inlineContactLines(content.buttons);
            const buttons = toMetaButtons(content.buttons);
            return { text: [content.text, ...extra].filter(Boolean).join('\n'), buttons: buttons.length ? buttons : undefined };
        }
        case 'cards': {
            const card = content.cards[0];
            if (!card)
                return null;
            const text = [card.title, card.subtitle, card.defaultUrl, ...inlineContactLines(card.buttons)].filter(Boolean).join('\n');
            const buttons = toMetaButtons(card.buttons);
            return { text, buttons: buttons.length ? buttons : undefined };
        }
        case 'image':
        case 'video':
        case 'file':
        case 'audio': {
            const caption = 'caption' in content ? content.caption : undefined;
            return { text: [caption, content.url].filter(Boolean).join('\n') };
        }
        default:
            return null;
    }
}
async function dispatch(account, contact, content, tag) {
    const platform = account.platform;
    if (platform === 'widget') {
        // The widget has no push channel: the visitor's browser polls stored messages.
        return { success: true };
    }
    const token = accountToken(account);
    if (!token)
        return { success: false, error: 'This account has no valid access token. Reconnect it.', code: 'TOKEN_MISSING' };
    if (platform === 'whatsapp') {
        if (!account.phoneNumberId)
            return { success: false, error: 'This WhatsApp account has no phone number configured', code: 'WA_NOT_CONFIGURED' };
        const to = (contact.whatsapp || contact.phone || contact.igsid || '').replace(/[^\d]/g, '');
        if (!to)
            return { success: false, error: 'This contact has no WhatsApp number', code: 'NO_RECIPIENT' };
        const res = await WhatsAppService.sendContent(account.phoneNumberId, to, content, token, account.catalogId);
        return { success: res.success, externalId: res.messageId, error: res.error, code: res.code };
    }
    if (platform === 'instagram' || platform === 'facebook') {
        const message = toMetaMessage(content);
        if (!message)
            return { success: false, error: `"${content.kind}" messages cannot be sent on ${platform}`, code: 'UNSUPPORTED_CONTENT' };
        if (!message.text && !message.buttons)
            return { success: false, error: 'Message is empty', code: 'EMPTY_MESSAGE' };
        const res = await MetaService.sendDirectMessage({ recipientIgsid: contact.igsid, accessToken: token, text: message.text, buttons: message.buttons, tag });
        const data = res.success ? res.data : undefined;
        return { success: res.success, externalId: data?.message_id, error: res.error, code: res.code };
    }
    return { success: false, error: `Unsupported platform "${platform}"`, code: 'UNSUPPORTED_PLATFORM' };
}
/** Window rules checked before calling the platform, so callers get a clear reason instead of a Graph error. */
function windowViolation(account, contact, content, tag) {
    const lastInboundAt = contact.lastInboundAt;
    if (account.platform === 'whatsapp') {
        if (content.kind === 'whatsapp_template' || isWithin24hWindow(lastInboundAt))
            return null;
        return {
            success: false,
            error: 'The 24-hour WhatsApp window has closed. Send an approved template message instead.',
            code: 'OUTSIDE_24H_WINDOW',
        };
    }
    if (account.platform === 'instagram' || account.platform === 'facebook') {
        if (isWithin24hWindow(lastInboundAt))
            return null;
        if (tag === 'HUMAN_AGENT' && isWithinHumanAgentWindow(lastInboundAt))
            return null;
        return {
            success: false,
            error: tag === 'HUMAN_AGENT'
                ? 'More than 7 days have passed since this person last messaged you, so Meta does not allow a reply.'
                : 'More than 24 hours have passed since this person last messaged you, so Meta does not allow an automated message.',
            code: 'OUTSIDE_24H_WINDOW',
        };
    }
    return null;
}
async function resolveConversationId(account, contact, conversationId) {
    if (conversationId) {
        const existing = await models.Conversation.findOne({ _id: conversationId, orgId: account.orgId, contactId: contact._id }, { _id: 1 }).lean();
        if (existing)
            return existing._id;
    }
    const conversation = await models.Conversation.findOneAndUpdate({ accountId: account._id, contactId: contact._id }, {
        $setOnInsert: {
            _id: newId('cnv'),
            orgId: account.orgId,
            platform: account.platform,
            status: 'open',
            isRead: true,
            lastMessageAt: new Date(),
        },
    }, { upsert: true, returnDocument: 'after', projection: { _id: 1 } }).lean();
    if (!conversation)
        throw new Error('Failed to resolve conversation');
    return conversation._id;
}
export async function sendToContact(input) {
    const { account, contact, content, tag } = input;
    const source = input.source ?? 'inbox';
    const orgId = account.orgId;
    if (!orgId || contact.orgId !== orgId || contact.accountId !== account._id) {
        return { success: false, error: 'Contact does not belong to this account', code: 'CONTACT_MISMATCH' };
    }
    if (account.status !== 'active' || account.paused) {
        return { success: false, error: 'This account is not active. Reconnect or resume it first.', code: 'ACCOUNT_INACTIVE' };
    }
    if (contact.blocked)
        return { success: false, error: 'This contact is blocked', code: 'CONTACT_BLOCKED' };
    if (contact.optedOut && (source === 'automation' || source === 'broadcast')) {
        return { success: false, error: 'This contact has opted out of automated messages', code: 'CONTACT_OPTED_OUT' };
    }
    const violation = windowViolation(account, contact, content, tag);
    if (violation)
        return violation;
    try {
        const quota = await checkQuota(orgId, 'messages_sent', 1);
        if (!quota.allowed) {
            return { success: false, error: `Monthly message limit reached (${quota.limit ?? 0}). Upgrade your plan to send more.`, code: 'PLAN_LIMIT' };
        }
        const conversationId = await resolveConversationId(account, contact, input.conversationId);
        const outcome = await dispatch(account, contact, content, tag);
        const now = new Date();
        const preview = clip(contentPreviewText(content), PREVIEW_CHARS);
        const messageId = newId('msg');
        await models.Message.create({
            _id: messageId,
            orgId,
            accountId: account._id,
            conversationId,
            contactId: contact._id,
            direction: 'out',
            type: content.kind,
            text: contentPreviewText(content) || undefined,
            payload: content,
            externalId: outcome.externalId || undefined,
            status: outcome.success ? 'sent' : 'failed',
            error: outcome.success ? undefined : outcome.error,
            errorCode: outcome.success || outcome.code === undefined ? undefined : String(outcome.code),
            sentAt: outcome.success ? now : undefined,
            sentByUserId: input.sentByUserId,
            messageTag: tag,
            aiGenerated: input.aiGenerated ?? false,
            approvalId: input.approvalId,
            source,
        });
        if (!outcome.success) {
            await recordStat(orgId, account._id, 'dms_failed');
            return { success: false, messageId, error: outcome.error ?? 'Send failed', code: outcome.code };
        }
        await Promise.all([
            models.Conversation.updateOne({ _id: conversationId, orgId }, { $set: { lastOutboundAt: now, lastMessageAt: now, lastMessagePreview: preview }, $inc: { messageCount: 1 } }),
            models.Contact.updateOne({ _id: contact._id, orgId }, { $set: { lastOutboundAt: now }, $inc: { messagesSent: 1 } }),
            recordUsage(orgId, 'messages_sent', 1, { accountId: account._id }),
            recordStat(orgId, account._id, account.platform === 'whatsapp' ? 'wa_messages_sent' : 'dms_sent'),
        ]);
        await emitEvent(orgId, 'message.sent', {
            messageId,
            externalId: outcome.externalId,
            accountId: account._id,
            platform: account.platform,
            conversationId,
            contactId: contact._id,
            type: content.kind,
            text: contentPreviewText(content),
            source,
            aiGenerated: input.aiGenerated ?? false,
            sentAt: now.toISOString(),
        });
        return { success: true, messageId, externalId: outcome.externalId };
    }
    catch (error) {
        console.error('[Outbound] sendToContact failed:', error instanceof Error ? error.message : error);
        return { success: false, error: 'Failed to send the message', code: 'INTERNAL' };
    }
}
