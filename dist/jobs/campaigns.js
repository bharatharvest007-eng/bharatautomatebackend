/**
 * Background jobs for: Broadcast sending, queueing, and scheduling.
 * Survives process restarts by recording progress per-recipient and resuming.
 */
import * as models from '../models/index.js';
import { registerJob, registerRecurring, enqueueJob } from '../services/jobs.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { MetaService } from '../services/metaService.js';
import { accountToken } from '../lib/crypto.js';
export function register() {
    // Handler for durable broadcast sending
    registerJob('campaigns.send_broadcast', async (payload) => {
        const { broadcastId } = payload;
        if (!broadcastId)
            return;
        const broadcast = await models.Broadcast.findById(broadcastId);
        if (!broadcast || broadcast.status !== 'sending')
            return;
        const account = await models.SocialAccount.findById(broadcast.accountId);
        if (!account) {
            await models.Broadcast.updateOne({ _id: broadcastId }, { $set: { status: 'failed', error: 'Social account not found' } });
            return;
        }
        const template = broadcast.templateId ? await models.WhatsAppTemplate.findById(broadcast.templateId) : null;
        const token = accountToken(account);
        // Resolve audience contacts
        const allContacts = await models.Contact.find({
            accountId: broadcast.accountId,
            optedOut: false,
            blocked: false,
        }).lean();
        const audience = (broadcast.audience || {});
        const contacts = allContacts.filter((c) => {
            if (audience.tags?.length && !audience.tags.some((t) => (c.tags || []).includes(t)))
                return false;
            return true;
        });
        // Fetch already processed recipients for this broadcast
        const alreadyProcessed = await models.BroadcastRecipient.find({ broadcastId }, { contactId: 1 }).lean();
        const processedIds = new Set(alreadyProcessed.map((r) => r.contactId));
        const remaining = contacts.filter((c) => !processedIds.has(c._id));
        const throttlePerMin = Math.max(1, Number(broadcast.throttlePerMinute) || 30);
        const intervalMs = Math.max(200, Math.floor(60_000 / throttlePerMin));
        let sent = broadcast.sentCount || 0;
        let failed = broadcast.failedCount || 0;
        let skipped = broadcast.skippedCount || 0;
        for (const contact of remaining) {
            // Re-check status in case user paused or cancelled the broadcast
            const fresh = await models.Broadcast.findById(broadcastId).select('status').lean();
            if (!fresh || fresh.status !== 'sending') {
                console.log(`[Jobs:Campaigns] Broadcast ${broadcastId} paused or cancelled mid-run`);
                return;
            }
            const recipientId = `bcr_${broadcastId}_${contact._id}`.slice(0, 60);
            let outcome = { success: false };
            try {
                if (account.platform === 'whatsapp') {
                    const rawPhone = contact.waId || contact.phone || contact.igsid;
                    const cleanPhone = String(rawPhone || '').replace(/\D/g, '');
                    if (!cleanPhone || cleanPhone.length < 8) {
                        outcome = { success: false, skipped: true, error: 'Invalid or missing phone number' };
                    }
                    else {
                        const params = interpolateParams(broadcast.templateParams || {}, contact);
                        const templateName = template?.name || 'hello_world';
                        const templateLang = template?.language || 'en_US';
                        const send = await WhatsAppService.sendTemplate(account.phoneNumberId, cleanPhone, templateName, templateLang, token, params);
                        outcome = { success: send.success, error: send.error, messageId: send.messageId };
                    }
                }
                else {
                    // Instagram / Facebook: check 24h window
                    const withinWindow = contact.lastInboundAt && Date.now() - new Date(contact.lastInboundAt).getTime() < 24 * 60 * 60 * 1000;
                    if (!withinWindow) {
                        outcome = { success: false, skipped: true, error: 'Outside 24h messaging window' };
                    }
                    else {
                        const content = broadcast.content;
                        const send = await MetaService.sendDirectMessage({
                            recipientIgsid: contact.igsid,
                            accessToken: token,
                            text: content?.kind === 'text' || content?.kind === 'buttons' ? content.text : '',
                            buttons: content?.kind === 'buttons' ? content.buttons : undefined,
                        });
                        outcome = { success: send.success, error: send.error, messageId: send.data?.recipient_id };
                    }
                }
            }
            catch (err) {
                outcome = { success: false, error: err.message };
            }
            await models.BroadcastRecipient.create({
                _id: recipientId,
                broadcastId,
                contactId: contact._id,
                status: outcome.skipped ? 'skipped' : outcome.success ? 'sent' : 'failed',
                error: outcome.error,
                sentAt: outcome.success ? new Date() : undefined,
            }).catch(() => undefined);
            if (outcome.skipped)
                skipped++;
            else if (outcome.success)
                sent++;
            else
                failed++;
            await models.Broadcast.updateOne({ _id: broadcastId }, { $set: { sentCount: sent, failedCount: failed, skippedCount: skipped } });
            // Throttled delay
            await new Promise((r) => setTimeout(r, intervalMs));
        }
        // Finished
        await models.Broadcast.updateOne({ _id: broadcastId, status: 'sending' }, { $set: { status: 'sent', finishedAt: new Date() } });
        console.log(`[Jobs:Campaigns] Broadcast ${broadcastId} completed. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}`);
    });
    // Recurring job: resume broadcasts that were interrupted by a server reboot
    registerRecurring('campaigns.resume_dangling', 2 * 60 * 1000, async () => {
        const dangling = await models.Broadcast.find({ status: 'sending' });
        for (const b of dangling) {
            console.log(`[Jobs:Campaigns] Resuming interrupted broadcast ${b._id}...`);
            await enqueueJob('campaigns.send_broadcast', { broadcastId: b._id }, { dedupeKey: `broadcast:${b._id}` });
        }
    }, { initialDelayMs: 60 * 1000 });
}
function interpolateParams(params, contact) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
        out[k] = String(v).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => key === 'first_name' ? (contact.name || contact.username || 'there').split(' ')[0] : String(contact.fields?.[key] ?? contact[key] ?? ''));
    }
    return out;
}
