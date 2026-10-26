import * as models from '../models/index.js';
import { MetaService } from './metaService.js';
import { WhatsAppService } from './whatsappService.js';
import { AiService } from './aiService.js';
import { accountToken } from '../lib/crypto.js';
import { captureLead } from './leads.js';
const CONTINUE = { action: 'continue' };
const END = { action: 'end' };
const WAIT = { action: 'wait' };
const instagramAdapter = {
    canSendFreeform: () => true, // gated by the 24h/private-reply rules inside sendDirectMessage itself
    async sendContent(account, recipientId, content, opts) {
        const buttons = contentToButtons(content);
        const res = await MetaService.sendDirectMessage({
            recipientIgsid: recipientId,
            accessToken: accountToken(account),
            commentId: opts?.commentId,
            text: contentToText(content),
            buttons,
        });
        return { success: res.success, messageId: res.data?.recipient_id, error: res.error };
    },
    async replyToComment(account, commentId, text) {
        const res = await MetaService.replyToComment(commentId, text, accountToken(account));
        return { success: res.success, messageId: res.data?.id, error: res.error };
    },
    async moderateComment(account, commentId, action) {
        if (action === 'delete')
            await MetaService.hideOrDeleteComment(commentId, 'delete', accountToken(account));
        else
            await MetaService.hideOrDeleteComment(commentId, 'hide', accountToken(account));
    },
    async checkFollows(account, senderId) {
        return MetaService.checkFollowerStatus(account.igUserId, senderId, accountToken(account));
    },
};
const facebookAdapter = {
    canSendFreeform: () => true,
    async sendContent(account, recipientId, content, opts) {
        // Facebook Pages ride the exact same Send API as Instagram — MetaService
        // already resolves graph.facebook.com for a Page ("EAA…") token.
        const buttons = contentToButtons(content);
        const res = await MetaService.sendDirectMessage({
            recipientIgsid: recipientId,
            accessToken: accountToken(account),
            commentId: opts?.commentId,
            text: contentToText(content),
            buttons,
        });
        return { success: res.success, messageId: res.data?.recipient_id, error: res.error };
    },
    async replyToComment(account, commentId, text) {
        const res = await MetaService.replyToComment(commentId, text, accountToken(account));
        return { success: res.success, messageId: res.data?.id, error: res.error };
    },
    async moderateComment(account, commentId, action) {
        if (action === 'delete')
            await MetaService.hideOrDeleteComment(commentId, 'delete', accountToken(account));
        else
            await MetaService.hideOrDeleteComment(commentId, 'hide', accountToken(account));
    },
    // Facebook Pages have no "follows a Page" concept comparable to Instagram's
    // follower graph — there is no equivalent check to run.
};
const whatsappAdapter = {
    // WhatsApp enforces this for real: outside the 24h customer-service window,
    // only an approved template will actually deliver. `lastInboundAt` is the
    // clock that window runs on.
    canSendFreeform(contact) {
        if (!contact?.lastInboundAt)
            return false;
        return Date.now() - new Date(contact.lastInboundAt).getTime() < 24 * 60 * 60 * 1000;
    },
    async sendContent(account, recipientId, content) {
        if (!account.phoneNumberId)
            return { success: false, error: 'This WhatsApp account has no phone number configured' };
        const res = await WhatsAppService.sendContent(account.phoneNumberId, recipientId, content, accountToken(account), account.catalogId);
        return { success: res.success, messageId: res.messageId, error: res.error };
    },
    // No comment concept, no follower concept on WhatsApp.
};
const widgetAdapter = {
    canSendFreeform: () => true,
    async sendContent(_account, _recipientId, content) {
        // The widget has no outbound push channel of its own — replies are queued
        // as Messages and the visitor's browser polls for them. See widget.routes.ts.
        return { success: true, messageId: undefined, error: undefined };
    },
};
function adapterFor(platform) {
    switch (platform) {
        case 'instagram':
            return instagramAdapter;
        case 'facebook':
            return facebookAdapter;
        case 'whatsapp':
            return whatsappAdapter;
        case 'widget':
            return widgetAdapter;
    }
}
function contentToText(content) {
    switch (content.kind) {
        case 'text':
            return content.text;
        case 'buttons':
            return content.text;
        case 'whatsapp_template':
            return `[template: ${content.templateName}]`;
        default:
            return '';
    }
}
function contentToButtons(content) {
    if (content.kind === 'buttons')
        return content.buttons;
    if (content.kind === 'cards')
        return content.cards[0]?.buttons;
    return undefined;
}
// ---------------------------------------------------------------------------
// Flow normalization — legacy flat steps and graph shapes both become a graph
// ---------------------------------------------------------------------------
const LEGACY_TYPE_ALIASES = {
    send_dm: 'send',
    ask_for_follow: 'ask_follow',
};
function normalizeFlow(flow) {
    const rawNodes = flow?.nodes ?? [];
    if (rawNodes.length === 0)
        return { entry: 'start', nodes: [{ id: 'start', type: 'start' }] };
    const hasIds = rawNodes.every((n) => typeof n.id === 'string');
    const chain = hasIds
        ? rawNodes
        : rawNodes.map((n, i) => ({ ...n, id: `n${i}`, next: i < rawNodes.length - 1 ? `n${i + 1}` : undefined }));
    const nodes = chain.map((n) => {
        const type = LEGACY_TYPE_ALIASES[n.type] ?? n.type;
        if (type === 'send' && n.kind === undefined && !n.content) {
            // Legacy `send_dm` shape: { text, buttons } instead of a MessageContent.
            const content = n.buttons?.length
                ? { kind: 'buttons', text: n.text || '', buttons: n.buttons }
                : { kind: 'text', text: n.text || '' };
            return { ...n, type: 'send', content };
        }
        if (type === 'comment_reply' && n.variants && !n.text) {
            return { ...n, type: 'comment_reply', text: n.variants };
        }
        return { ...n, type };
    });
    const entry = flow?.entry && nodes.some((n) => n.id === flow.entry) ? flow.entry : nodes[0].id;
    return { entry, nodes };
}
function findNode(nodes, id) {
    return nodes.find((n) => n.id === id);
}
// ---------------------------------------------------------------------------
// Keyword / audience matching
// ---------------------------------------------------------------------------
function matchesKeyword(text, trigger) {
    const keywords = trigger.keywords || trigger.keyword?.keywords || [];
    const matchMode = trigger.matchMode || trigger.keyword?.matchMode || 'contains';
    const negative = trigger.keyword?.negativeKeywords || [];
    const lower = text.toLowerCase().trim();
    if (negative.some((kw) => lower.includes(kw.toLowerCase().trim())))
        return false;
    if (matchMode === 'any')
        return true;
    if (keywords.length === 0)
        return true;
    return keywords.some((kw) => {
        const k = kw.toLowerCase().trim();
        switch (matchMode) {
            case 'exact':
                return lower === k;
            case 'starts_with':
                return lower.startsWith(k);
            case 'ends_with':
                return lower.endsWith(k);
            case 'word':
                return new RegExp(`(^|\\W)${escapeRegex(k)}(\\W|$)`, 'i').test(lower);
            case 'contains':
            default:
                return lower.includes(k);
        }
    });
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Exported so broadcasts.routes.ts can resolve the same AudienceFilter shape without duplicating this logic. */
export function matchesAudience(audience, contact) {
    if (!audience)
        return true;
    const tags = contact?.tags ?? [];
    if (audience.hasAllTags?.length && !audience.hasAllTags.every((t) => tags.includes(t)))
        return false;
    if (audience.hasAnyTags?.length && !audience.hasAnyTags.some((t) => tags.includes(t)))
        return false;
    if (audience.excludeTags?.length && audience.excludeTags.some((t) => tags.includes(t)))
        return false;
    if (audience.excludeUsernames?.length && contact?.username && audience.excludeUsernames.includes(contact.username))
        return false;
    if (audience.onlyNewContacts && (contact?.messagesReceived ?? 0) > 1)
        return false;
    if (audience.onlyReturningContacts && (contact?.messagesReceived ?? 0) <= 1)
        return false;
    return true;
}
function interpolate(text, vars) {
    return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
        const v = vars[key];
        return v === undefined || v === null ? '' : String(v);
    });
}
// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------
const ACCOUNT_FIELD_BY_PLATFORM = {
    instagram: 'igUserId',
    facebook: 'pageId',
    whatsapp: 'phoneNumberId',
    widget: '_id',
};
export class FlowEngine {
    // -------------------------------------------------------------------
    // Public entry points
    // -------------------------------------------------------------------
    /** Backward-compatible wrapper — the existing comment webhook call site. */
    static async processComment(event) {
        return this.processInboundEvent({
            platform: 'instagram',
            accountExternalId: event.accountId,
            kind: 'comment',
            commentId: event.commentId,
            mediaId: event.mediaId,
            senderId: event.userIgsid,
            senderUsername: event.username,
            text: event.commentText,
            timestamp: new Date(),
        });
    }
    /** Any inbound message — Instagram DM, Facebook Messenger, WhatsApp, or the widget. */
    static async processMessage(event) {
        return this.processInboundEvent({ ...event, kind: 'message' });
    }
    /** A Facebook feed comment — mirrors processComment but for a different platform/field. */
    static async processFacebookComment(event) {
        return this.processInboundEvent({ ...event, platform: 'facebook', kind: 'comment' });
    }
    /**
     * A button tap (postback / quick reply / ice breaker / main menu / an
     * `ask_follow` confirmation). These don't carry free text, so they get their
     * own entry point rather than being squeezed through `processMessage`.
     */
    static async processPostback(event) {
        const account = await this.resolveAccount(event.platform, event.accountExternalId);
        if (!account)
            return { matched: false, reason: 'Account not found' };
        const contact = await models.Contact.findOne({ accountId: account._id, igsid: event.senderId });
        // The one case that needs special handling: resuming a run parked on
        // `ask_follow`, waiting for exactly this "I Am Following" tap.
        if (contact && event.payload.startsWith('VERIFY_FOLLOW:')) {
            const automationId = event.payload.split(':')[1];
            const run = await models.AutomationRun.findOne({
                accountId: account._id,
                contactId: contact._id,
                automationId,
                status: 'waiting',
                waitingForKind: 'postback',
            }).sort({ startedAt: -1 });
            if (run?.currentNode) {
                const automation = await models.Automation.findById(automationId);
                if (automation) {
                    const { nodes } = normalizeFlow(automation.flow);
                    const node = findNode(nodes, run.currentNode);
                    const conversation = await models.Conversation.findOne({ accountId: account._id, contactId: contact._id });
                    if (node && node.type === 'ask_follow' && conversation) {
                        await models.Contact.updateOne({ _id: contact._id }, { $set: { followConfirmedAt: new Date(), isFollower: true } });
                        const messageEvent = { ...event, kind: 'message', text: '[followed]' };
                        if (node.next) {
                            await this.executeFrom(run, automation, account, contact, conversation, messageEvent, node.next, {});
                        }
                        else {
                            await models.AutomationRun.updateOne({ _id: run._id }, { $set: { status: 'completed', finishedAt: new Date() } });
                        }
                        return { matched: true, resumed: true, automationId };
                    }
                }
            }
        }
        // Not resuming a wait — treat the tap like an inbound message so
        // `type: 'postback'` automations (ice breakers, main-menu taps) can match
        // on the payload the same way a keyword trigger matches on typed text.
        return this.processInboundEvent({ ...event, kind: 'message', text: event.payload });
    }
    // -------------------------------------------------------------------
    // Core pipeline
    // -------------------------------------------------------------------
    static async processInboundEvent(event) {
        const account = await this.resolveAccount(event.platform, event.accountExternalId);
        if (!account) {
            console.warn(`[FlowEngine] No connected ${event.platform} account matches "${event.accountExternalId}"`);
            return { matched: false, reason: 'Account not found' };
        }
        if (account.paused || account.status !== 'active') {
            return { matched: false, reason: 'Account is paused or inactive' };
        }
        // Comments get spam-checked before anything else touches them.
        if (event.kind === 'comment') {
            const spamCheck = await AiService.classifySpam(event.text);
            if (spamCheck.isSpam && event.commentId) {
                console.log(`[FlowEngine] Spam detected (${spamCheck.score}%): "${event.text}". Auto-hiding.`);
                const adapter = adapterFor(event.platform);
                await adapter.moderateComment?.(account, event.commentId, 'hide');
                await this.logComment(account, event, { verdict: 'spam', action: 'hide' });
                return { matched: false, reason: 'Spam comment auto-hidden' };
            }
            await this.logComment(account, event, { verdict: 'genuine', action: 'none' });
        }
        // Persist the inbound side of the conversation before any automation runs,
        // so every message is in the inbox even when nothing matches.
        const { contact, conversation } = await this.persistInbound(account, event);
        // A run already parked on an `ask` node absorbs this message as the answer
        // to its question, rather than being re-evaluated as a fresh trigger.
        if (event.kind === 'message') {
            const resumed = await this.tryResumeWaitingRun(account, contact, conversation, event);
            if (resumed)
                return { matched: true, resumed: true, automationId: resumed.automationId };
        }
        if (conversation.humanHandover) {
            return { matched: false, reason: 'Conversation is handed over to a human' };
        }
        const automation = await this.findMatchingAutomation(account, event, contact);
        if (!automation)
            return { matched: false, reason: 'No matching automation' };
        // Guardrails: cooldown / once-per-contact, enforced against run history.
        if (await this.isOnCooldown(automation, contact)) {
            return { matched: false, reason: 'Contact is on cooldown for this automation' };
        }
        console.log(`[FlowEngine] Automation "${automation.name}" triggered by ${event.platform} ${event.kind}: "${event.text}"`);
        const run = await this.startRun(account, automation, contact, conversation, event);
        await this.executeFrom(run, automation, account, contact, conversation, event, normalizeFlow(automation.flow).entry, {
            commentId: event.commentId,
        });
        await models.Automation.updateOne({ _id: automation._id }, { $inc: { triggeredCount: 1 }, $set: { lastTriggeredAt: new Date() } });
        return { matched: true, automationId: automation._id, runId: run._id };
    }
    // -------------------------------------------------------------------
    // Account / contact / conversation resolution
    // -------------------------------------------------------------------
    static async resolveAccount(platform, externalId) {
        const field = ACCOUNT_FIELD_BY_PLATFORM[platform];
        const query = { [field]: externalId };
        if (platform !== 'instagram')
            query.platform = platform; // igUserId alone is unambiguous; others share id shapes
        return models.SocialAccount.findOne(query);
    }
    static async persistInbound(account, event) {
        const isWhatsApp = event.platform === 'whatsapp';
        const waPhone = isWhatsApp ? event.senderId : undefined;
        // Detect email or phone in message text
        const emailMatch = event.text ? event.text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] : undefined;
        const phoneMatch = event.text ? event.text.match(/(\+?91[\-\s]?)?[6-9]\d{9}/)?.[0] : undefined;
        const contact = await models.Contact.findOneAndUpdate({ accountId: account._id, igsid: event.senderId }, {
            $set: {
                username: event.senderUsername,
                name: event.senderName || event.senderUsername,
                lastSeenAt: new Date(),
                lastInboundAt: new Date(),
                ...(waPhone ? { phone: waPhone, waId: waPhone } : {}),
                ...(emailMatch ? { email: emailMatch } : {}),
                ...(!waPhone && phoneMatch ? { phone: phoneMatch } : {}),
                ...(event.referral ? { referral: event.referral, source: 'ctwa_ad' } : {}),
            },
            $setOnInsert: {
                _id: `ctc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                orgId: account.orgId,
                accountId: account._id,
                igsid: event.senderId,
                firstSeenAt: new Date(),
            },
            $inc: { messagesReceived: 1 },
        }, { upsert: true, new: true });
        // Auto-capture lead if contact details detected or if WhatsApp inbound
        if (emailMatch || phoneMatch || (isWhatsApp && event.kind === 'message')) {
            captureLead({
                orgId: account.orgId,
                accountId: account._id,
                contactId: contact._id,
                source: 'dm',
                email: emailMatch || contact.email,
                phone: waPhone || phoneMatch || contact.phone,
                name: event.senderName || event.senderUsername || contact.name,
                data: { initialMessage: event.text, platform: event.platform },
            }).catch(() => undefined);
        }
        const conversation = await models.Conversation.findOneAndUpdate({ accountId: account._id, contactId: contact._id }, {
            $set: {
                orgId: account.orgId,
                platform: account.platform,
                lastInboundAt: new Date(),
                lastMessageAt: new Date(),
                lastMessagePreview: event.text.slice(0, 120),
                isRead: false,
            },
            $setOnInsert: {
                _id: `cnv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                status: 'open',
            },
            $inc: { unreadCount: 1, messageCount: 1 },
        }, { upsert: true, new: true });
        if (event.kind === 'message') {
            await models.Message.create({
                _id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                orgId: account.orgId,
                accountId: account._id,
                conversationId: conversation._id,
                contactId: contact._id,
                direction: 'in',
                type: 'text',
                text: event.text,
                attachments: event.attachments ?? [],
                externalId: event.externalMessageId,
                sentAt: event.timestamp,
            }).catch((e) => {
                // A duplicate externalId means Meta redelivered the same webhook — harmless.
                if (e?.code !== 11000)
                    console.error('[FlowEngine] Failed to persist inbound message:', e.message);
            });
        }
        return { contact, conversation };
    }
    static async logComment(account, event, outcome) {
        if (!event.commentId)
            return;
        await models.CommentLog.updateOne({ accountId: account._id, commentId: event.commentId }, {
            $set: {
                orgId: account.orgId,
                mediaId: event.mediaId,
                fromIgsid: event.senderId,
                username: event.senderUsername,
                text: event.text,
                verdict: outcome.verdict,
                action: outcome.action,
                hidden: outcome.action === 'hide',
                deleted: outcome.action === 'delete',
            },
            $setOnInsert: { _id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` },
        }, { upsert: true }).catch(() => undefined);
    }
    // -------------------------------------------------------------------
    // Matching
    // -------------------------------------------------------------------
    static async findMatchingAutomation(account, event, contact) {
        const found = await models.Automation.find({ accountId: account._id, status: 'live' }).lean();
        const candidates = found
            .filter((a) => this.triggerAppliesTo(a.trigger, event))
            .filter((a) => {
            const targeted = a.mediaIds ?? [];
            if (event.kind !== 'comment' || targeted.length === 0)
                return true;
            return event.mediaId ? targeted.includes(event.mediaId) : true;
        })
            .filter((a) => matchesAudience(a.trigger?.audience, contact))
            .filter((a) => {
            const keywordsPresent = (a.trigger?.keywords?.length ?? 0) > 0;
            return keywordsPresent ? matchesKeyword(event.text, a.trigger) : true;
        });
        // Post-specific beats account-wide; then priority; then most recently updated.
        candidates.sort((a, b) => {
            const aSpecific = a.mediaIds?.length ? 1 : 0;
            const bSpecific = b.mediaIds?.length ? 1 : 0;
            if (aSpecific !== bSpecific)
                return bSpecific - aSpecific;
            if ((b.priority ?? 0) !== (a.priority ?? 0))
                return (b.priority ?? 0) - (a.priority ?? 0);
            return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
        });
        return candidates[0] ?? null;
    }
    /** Does this automation's trigger type apply to the channel+kind this event arrived on? */
    static triggerAppliesTo(trigger, event) {
        const type = trigger?.type;
        if (!type)
            return false;
        if (event.kind === 'comment') {
            if (event.platform === 'instagram')
                return ['comment', 'comment_any_reel', 'trial_reel_comment', 'live_comment'].includes(type);
            if (event.platform === 'facebook')
                return type === 'facebook_comment';
            return false;
        }
        switch (event.platform) {
            case 'instagram':
                return ['dm', 'dm_welcome', 'postback', 'referral'].includes(type);
            case 'facebook':
                return type === 'facebook_message';
            case 'whatsapp':
                return type === 'whatsapp_message' || type === 'whatsapp_welcome';
            case 'widget':
                return type === 'widget_message';
            default:
                return false;
        }
    }
    static async isOnCooldown(automation, contact) {
        if (automation.oncePerContact) {
            const priorRun = await models.AutomationRun.findOne({
                automationId: automation._id,
                contactId: contact._id,
                status: { $in: ['completed', 'waiting'] },
            });
            if (priorRun)
                return true;
        }
        if (automation.cooldownHours) {
            const since = new Date(Date.now() - automation.cooldownHours * 60 * 60 * 1000);
            const recentRun = await models.AutomationRun.findOne({
                automationId: automation._id,
                contactId: contact._id,
                startedAt: { $gte: since },
            });
            if (recentRun)
                return true;
        }
        return false;
    }
    // -------------------------------------------------------------------
    // Run lifecycle
    // -------------------------------------------------------------------
    static async startRun(account, automation, contact, conversation, event) {
        return models.AutomationRun.create({
            _id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            orgId: account.orgId,
            accountId: account._id,
            automationId: automation._id,
            contactId: contact._id,
            conversationId: conversation._id,
            trigger: { platform: event.platform, kind: event.kind, commentId: event.commentId, text: event.text },
            status: 'running',
            context: { vars: this.seedVars(contact, event), visited: [] },
            trace: [],
        });
    }
    static seedVars(contact, event) {
        return {
            first_name: (contact.name || contact.username || '').split(' ')[0] || 'there',
            username: contact.username || '',
            name: contact.name || contact.username || '',
            message: event.text,
            ...Object.fromEntries(Object.entries(contact.fields ?? {})),
        };
    }
    /**
     * Resume a run parked on an `ask` node — the reply just arrived as a normal
     * inbound message. Validates it against `expect`, saves it, and continues
     * walking the graph from wherever the `ask` node points next.
     */
    static async tryResumeWaitingRun(account, contact, conversation, event) {
        const run = await models.AutomationRun.findOne({
            accountId: account._id,
            contactId: contact._id,
            status: 'waiting',
        }).sort({ startedAt: -1 });
        if (!run || !run.currentNode)
            return null;
        const automation = await models.Automation.findById(run.automationId);
        if (!automation || automation.status !== 'live') {
            await models.AutomationRun.updateOne({ _id: run._id }, { $set: { status: 'cancelled', finishedAt: new Date() } });
            return null;
        }
        const { nodes } = normalizeFlow(automation.flow);
        const node = findNode(nodes, run.currentNode);
        if (!node) {
            // The flow was edited out from under a run in flight — nothing sane to resume.
            await models.AutomationRun.updateOne({ _id: run._id }, { $set: { status: 'failed', error: 'Waiting node vanished', finishedAt: new Date() } });
            return null;
        }
        if (node.type !== 'ask') {
            // Parked on `ask_follow`, which waits for a button tap (postback), not
            // free text. A text message here isn't an answer to anything — leave the
            // run parked and let this message flow through normal automation
            // matching instead of misreading it as a reply.
            return null;
        }
        const askNode = node;
        const valid = this.validateExpected(event.text, askNode.expect);
        if (!valid) {
            const retries = run.context.vars.__retries ?? 0;
            if (askNode.maxRetries && retries >= askNode.maxRetries) {
                // Give up gracefully rather than trap the contact in a loop forever.
                await models.AutomationRun.updateOne({ _id: run._id }, { $set: { status: 'failed', error: 'Max retries exceeded', finishedAt: new Date() } });
                return null;
            }
            const adapter = adapterFor(event.platform);
            const retryContent = {
                kind: 'text',
                text: askNode.retryMessage || `That doesn't look right — could you try again?`,
            };
            const result = await adapter.sendContent(account, event.senderId, retryContent);
            // Recorded the same way any other outbound send is, or the retry prompt
            // is invisible to anyone polling the conversation (the widget, the inbox).
            await this.recordOutbound(account, contact, conversation, automation, run, retryContent, result);
            await models.AutomationRun.updateOne({ _id: run._id }, { $set: { 'context.vars.__retries': retries + 1 } });
            return { automationId: automation._id };
        }
        // Save the answer onto both the run's working vars and the contact's own record.
        run.context.vars[askNode.saveTo] = event.text;
        delete run.context.vars.__retries;
        await models.Contact.updateOne({ _id: contact._id }, { $set: { [`fields.${askNode.saveTo}`]: event.text } });
        // Auto-capture lead if ask node captured contact details or order preferences
        const isContactField = ['email', 'phone', 'name', 'address', 'order', 'box'].includes(askNode.saveTo.toLowerCase()) ||
            askNode.expect === 'email' || askNode.expect === 'phone';
        if (isContactField) {
            const allVars = { ...(run.context.vars || {}), [askNode.saveTo]: event.text };
            const emailVal = typeof allVars.email === 'string' ? allVars.email : (askNode.expect === 'email' ? event.text : undefined);
            const phoneVal = typeof allVars.phone === 'string' ? allVars.phone : (askNode.expect === 'phone' ? event.text : undefined);
            const nameVal = typeof allVars.name === 'string' ? allVars.name : (contact.name || contact.username);
            captureLead({
                orgId: account.orgId,
                accountId: account._id,
                contactId: contact._id,
                source: 'ask_node',
                automationId: automation._id,
                email: emailVal,
                phone: phoneVal,
                name: nameVal,
                data: allVars,
            }).catch((e) => console.warn('[FlowEngine] Lead capture from ask node failed:', e.message));
        }
        const nextId = askNode.next;
        if (!nextId) {
            await models.AutomationRun.updateOne({ _id: run._id }, { $set: { status: 'completed', finishedAt: new Date(), context: run.context } });
            return { automationId: automation._id };
        }
        await this.executeFrom(run, automation, account, contact, conversation, event, nextId, {});
        return { automationId: automation._id };
    }
    static validateExpected(text, expect) {
        const trimmed = text.trim();
        switch (expect) {
            case 'email':
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
            case 'phone':
                return /^[+\d][\d\s-]{6,}$/.test(trimmed);
            case 'number':
                return /^-?\d+(\.\d+)?$/.test(trimmed);
            case 'url':
                return /^https?:\/\/\S+$/.test(trimmed);
            default:
                return trimmed.length > 0;
        }
    }
    // -------------------------------------------------------------------
    // Graph execution
    // -------------------------------------------------------------------
    static async executeFrom(run, automation, account, contact, conversation, event, startNodeId, ctx) {
        const { nodes } = normalizeFlow(automation.flow);
        const adapter = adapterFor(event.platform);
        let currentId = startNodeId;
        let steps = 0;
        const MAX_STEPS = 50; // guards against a cyclic `goto` graph
        while (currentId && steps < MAX_STEPS) {
            steps += 1;
            const node = findNode(nodes, currentId);
            if (!node)
                break;
            run.context.visited.push(node.id);
            run.trace.push({ nodeId: node.id, type: node.type, at: new Date().toISOString() });
            const result = await this.executeNode(node, { run, automation, account, contact, conversation, event, adapter, ctx });
            if (result.action === 'wait' || result.action === 'end') {
                run.currentNode = result.action === 'wait' ? node.id : undefined;
                await run.save();
                if (result.action === 'end') {
                    run.status = 'completed';
                    run.finishedAt = new Date();
                    run.durationMs = run.finishedAt.getTime() - new Date(run.startedAt).getTime();
                    await run.save();
                }
                return;
            }
            currentId =
                result.action === 'goto'
                    ? result.target
                    : result.action === 'branch'
                        ? (node.type === 'condition' ? (result.value === 'true' ? node.whenTrue : node.whenFalse) : undefined)
                        : 'next' in node
                            ? node.next
                            : undefined;
        }
        run.status = 'completed';
        run.finishedAt = new Date();
        run.durationMs = run.finishedAt.getTime() - new Date(run.startedAt).getTime();
        run.currentNode = undefined;
        await run.save();
    }
    static async executeNode(node, env) {
        const { run, automation, account, contact, conversation, event, adapter, ctx } = env;
        const vars = run.context.vars;
        switch (node.type) {
            case 'start':
                return CONTINUE;
            case 'send': {
                const content = this.interpolateContent(node.content, vars);
                const result = await adapter.sendContent(account, event.senderId, content, { commentId: ctx.commentId });
                await this.recordOutbound(account, contact, conversation, automation, run, content, result);
                return CONTINUE;
            }
            case 'ask': {
                const content = this.interpolateContent(node.content, vars);
                const result = await adapter.sendContent(account, event.senderId, content, { commentId: ctx.commentId });
                await this.recordOutbound(account, contact, conversation, automation, run, content, result);
                run.status = 'waiting';
                run.waitingForKind = 'reply';
                run.waitingUntil = new Date(Date.now() + (node.timeoutHours ?? 24) * 60 * 60 * 1000);
                run.context.waitingFor = { nodeId: node.id, kind: 'reply', expiresAt: run.waitingUntil.toISOString() };
                return WAIT;
            }
            case 'comment_reply': {
                if (!ctx.commentId || !adapter.replyToComment)
                    return CONTINUE;
                const variants = Array.isArray(node.text) ? node.text : [node.text];
                const text = interpolate(variants[Math.floor(Math.random() * variants.length)], vars);
                const result = await adapter.replyToComment(account, ctx.commentId, text);
                if (!result.success)
                    console.error(`[FlowEngine] comment reply failed: ${result.error}`);
                return CONTINUE;
            }
            case 'comment_action': {
                if (!ctx.commentId || !adapter.moderateComment)
                    return CONTINUE;
                if (node.action === 'hide' || node.action === 'unhide' || node.action === 'delete') {
                    await adapter.moderateComment(account, ctx.commentId, node.action);
                }
                return CONTINUE;
            }
            case 'ask_follow': {
                if (!adapter.checkFollows)
                    return CONTINUE; // no follow concept on this channel
                const isFollowing = await adapter.checkFollows(account, event.senderId);
                if (isFollowing)
                    return CONTINUE;
                const content = {
                    kind: 'buttons',
                    text: interpolate(node.message, vars),
                    buttons: [
                        { type: 'url', title: node.followButtonTitle, url: node.profileUrl || `https://instagram.com/${account.username}` },
                        { type: 'postback', title: node.confirmButtonTitle, payload: `VERIFY_FOLLOW:${env.automation._id}` },
                    ],
                };
                const result = await adapter.sendContent(account, event.senderId, content, { commentId: ctx.commentId });
                await this.recordOutbound(account, contact, conversation, automation, run, content, result);
                run.waitingForKind = 'postback';
                run.waitingUntil = new Date(Date.now() + (node.reminderDelayMinutes ?? 60 * 24) * 60 * 1000);
                run.context.waitingFor = { nodeId: node.id, kind: 'postback' };
                return WAIT; // parks here; a follow-verification button tap or postback resumes it
            }
            case 'condition': {
                const passed = this.evaluateCondition(node.condition, { contact, vars, event });
                return { action: 'branch', value: passed ? 'true' : 'false' };
            }
            case 'delay': {
                // Short delays are safe to await inline — the webhook that triggered
                // this run already returned 200 to Meta before background processing
                // began. Longer delays need a real job scheduler, which this platform
                // does not yet have; we log that limitation rather than block a
                // worker thread for minutes.
                if (node.ms <= 15_000) {
                    await new Promise((r) => setTimeout(r, node.ms));
                }
                else {
                    console.warn(`[FlowEngine] delay node requested ${node.ms}ms — long delays need a job scheduler (not yet built); continuing immediately`);
                }
                return CONTINUE;
            }
            case 'split': {
                const total = node.branches.reduce((s, b) => s + b.weight, 0) || 1;
                let roll = Math.random() * total;
                for (const b of node.branches) {
                    roll -= b.weight;
                    if (roll <= 0) {
                        run.context.splitChoices = { ...(run.context.splitChoices ?? {}), [node.id]: b.key };
                        return b.next ? { action: 'goto', target: b.next } : CONTINUE;
                    }
                }
                return CONTINUE;
            }
            case 'tag': {
                const update = {};
                if (node.add?.length)
                    update.$addToSet = { tags: { $each: node.add } };
                if (node.remove?.length)
                    update.$pull = { tags: { $in: node.remove } };
                if (Object.keys(update).length)
                    await models.Contact.updateOne({ _id: contact._id }, update);
                return CONTINUE;
            }
            case 'set_field': {
                const value = interpolate(node.value, vars);
                vars[node.field] = value;
                await models.Contact.updateOne({ _id: contact._id }, { $set: { [`fields.${node.field}`]: value } });
                return CONTINUE;
            }
            case 'ai_reply': {
                const brandVoiceDoc = await models.BrandVoice.findOne({ accountId: account._id }).lean().catch(() => null);
                const brandVoice = brandVoiceDoc
                    ? { tone: brandVoiceDoc.tone, rules: brandVoiceDoc.rules, sampleReplies: brandVoiceDoc.examples }
                    : {};
                const reply = await AiService.generateCommentReply(event.text, '', brandVoice, node.instruction).catch(() => null);
                const text = reply?.reply || node.fallbackText || 'Thanks for reaching out — someone will follow up shortly!';
                const content = { kind: 'text', text };
                const result = await adapter.sendContent(account, event.senderId, content, { commentId: ctx.commentId });
                await this.recordOutbound(account, contact, conversation, automation, run, content, result);
                return CONTINUE;
            }
            case 'notify': {
                if (node.channel === 'webhook' && node.target) {
                    await this.postWebhook(node.target, {
                        automation: automation.name,
                        contact: { id: contact._id, username: contact.username },
                        message: node.message || event.text,
                        event,
                    });
                }
                else {
                    console.log(`[FlowEngine] notify(email) node reached — no SMTP configured, skipping: ${node.message}`);
                }
                return CONTINUE;
            }
            case 'http': {
                try {
                    const res = await fetch(node.url, {
                        method: node.method,
                        headers: { 'content-type': 'application/json', ...(node.headers || {}) },
                        body: node.method === 'GET' ? undefined : node.body ? interpolate(node.body, vars) : undefined,
                    });
                    const body = await res.text();
                    if (node.saveResponseTo) {
                        try {
                            vars[node.saveResponseTo] = JSON.parse(body);
                        }
                        catch {
                            vars[node.saveResponseTo] = body;
                        }
                    }
                }
                catch (e) {
                    console.error(`[FlowEngine] http node failed: ${e.message}`);
                }
                return CONTINUE;
            }
            case 'assign': {
                await models.Conversation.updateOne({ _id: conversation._id }, { $set: { assignedTo: node.userId || undefined } });
                return CONTINUE;
            }
            case 'handover': {
                await models.Conversation.updateOne({ _id: conversation._id }, { $set: { humanHandover: true, handoverAt: new Date(), note: node.note } });
                return END;
            }
            case 'lead_card': {
                // The lead card itself is rendered by the client (in-DM UI); here we
                // just record that this run reached it, for funnel analytics.
                await models.Automation.updateOne({ _id: automation._id }, { $inc: { leadCount: 1 } });
                return CONTINUE;
            }
            case 'subscribe':
            case 'unsubscribe':
                console.warn(`[FlowEngine] "${node.type}" node reached — drip sequences are not implemented yet, skipping`);
                return CONTINUE;
            case 'goto':
                return { action: 'goto', target: node.target };
            case 'end':
                return END;
            default:
                console.warn(`[FlowEngine] Unknown node type, stopping: ${node.type}`);
                return END;
        }
    }
    static evaluateCondition(group, env) {
        const results = group.clauses.map((clause) => this.evaluateClause(clause, env));
        return group.mode === 'and' ? results.every(Boolean) : results.some(Boolean);
    }
    static evaluateClause(clause, env) {
        const { contact, vars, event } = env;
        let actual;
        if (clause.subject === 'tag')
            actual = contact.tags ?? [];
        else if (clause.subject === 'follows')
            actual = contact.isFollower;
        else if (clause.subject === 'has_email')
            actual = Boolean(contact.email);
        else if (clause.subject === 'has_phone')
            actual = Boolean(contact.phone);
        else if (clause.subject === 'message')
            actual = event.text;
        else if (clause.subject === 'hour')
            actual = new Date().getHours();
        else if (clause.subject.startsWith('field:'))
            actual = contact.fields?.[clause.subject.slice(6)];
        else
            actual = vars[clause.subject];
        switch (clause.op) {
            case 'exists':
                return actual !== undefined && actual !== null && actual !== '';
            case 'not_exists':
                return actual === undefined || actual === null || actual === '';
            case 'eq':
                return String(actual) === String(clause.value);
            case 'neq':
                return String(actual) !== String(clause.value);
            case 'contains':
                return Array.isArray(actual) ? actual.includes(clause.value) : String(actual ?? '').includes(String(clause.value ?? ''));
            case 'not_contains':
                return Array.isArray(actual) ? !actual.includes(clause.value) : !String(actual ?? '').includes(String(clause.value ?? ''));
            case 'gt':
                return Number(actual) > Number(clause.value);
            case 'lt':
                return Number(actual) < Number(clause.value);
            case 'in':
                return Array.isArray(clause.value) && clause.value.map(String).includes(String(actual));
            case 'not_in':
                return Array.isArray(clause.value) && !clause.value.map(String).includes(String(actual));
            default:
                return false;
        }
    }
    static interpolateContent(content, vars) {
        if (content.kind === 'text')
            return { ...content, text: interpolate(content.text, vars) };
        if (content.kind === 'buttons')
            return { ...content, text: interpolate(content.text, vars) };
        if (content.kind === 'whatsapp_template' && content.params) {
            return { ...content, params: Object.fromEntries(Object.entries(content.params).map(([k, v]) => [k, interpolate(v, vars)])) };
        }
        return content;
    }
    static async recordOutbound(account, contact, conversation, automation, run, content, result) {
        await models.Message.create({
            _id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            orgId: account.orgId,
            accountId: account._id,
            conversationId: conversation._id,
            contactId: contact._id,
            direction: 'out',
            type: content.kind,
            text: contentToText(content) || undefined,
            payload: content,
            status: result.success ? 'sent' : 'failed',
            error: result.success ? undefined : result.error,
            externalId: result.messageId,
            automationId: automation._id,
            runId: run._id,
            sentAt: new Date(),
        }).catch(() => undefined);
        await models.Conversation.updateOne({ _id: conversation._id }, { $set: { lastOutboundAt: new Date(), lastMessageAt: new Date() } });
        if (result.success) {
            await models.Contact.updateOne({ _id: contact._id }, { $inc: { messagesSent: 1 }, $set: { lastOutboundAt: new Date() } });
            await models.Automation.updateOne({ _id: automation._id }, { $inc: { sentCount: 1 } });
        }
        else {
            await models.Automation.updateOne({ _id: automation._id }, { $inc: { failedCount: 1 } });
            console.error(`[FlowEngine] send failed for automation "${automation.name}": ${result.error}`);
        }
    }
    static async postWebhook(url, body) {
        try {
            await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        }
        catch (e) {
            console.error(`[FlowEngine] notify webhook failed: ${e.message}`);
        }
    }
}
