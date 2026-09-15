import { Router } from 'express';
import * as models from '../models/index.js';
import { MetaService } from '../services/metaService.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { matchesAudience } from '../services/flowEngine.js';
import type { MessageContent } from '../types/index.js';

/**
 * Campaigns — a one-time send to a tagged segment.
 *
 * WhatsApp broadcasts must reference an approved template: Meta rejects free
 * text to anyone who hasn't messaged in the last 24h, and a cold broadcast
 * list is exactly that. Instagram/Facebook broadcasts send `content` directly,
 * and only actually reach contacts whose messaging window is still open —
 * `send` records everyone else as `skipped`, not `failed`, since nothing
 * about the send was wrong.
 *
 * There's no job queue in this codebase, so `send` processes the whole
 * recipient list in a rate-limited loop in the background after responding —
 * the same "ack immediately, work after" shape the webhook handler already
 * uses. A broadcast to a very large list will hold the process open for a
 * while; that's an acceptable v1 trade-off given the throttle exists to
 * protect the platform's own rate limits, not the other way around.
 */

const router = Router();

router.get('/', async (req, res) => {
  try {
    const org = await models.Organization.findOne();
    const query: Record<string, unknown> = org ? { orgId: org._id } : {};
    if (req.query.accountId) query.accountId = req.query.accountId;
    const broadcasts = await models.Broadcast.find(query).sort({ updatedAt: -1 });
    return res.json({ ok: true, broadcasts });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const broadcast = await models.Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    const recipients = await models.BroadcastRecipient.find({ broadcastId: broadcast._id }).limit(500);
    return res.json({ ok: true, broadcast, recipients });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { accountId, name, content, templateId, templateParams, audience, throttlePerMinute } = req.body;
    if (!accountId || !name) return res.status(400).json({ error: 'accountId and name are required' });

    const account = await models.SocialAccount.findById(accountId);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    if (account.platform === 'whatsapp' && !templateId) {
      return res.status(400).json({ error: 'WhatsApp broadcasts must reference an approved template — pass templateId' });
    }

    const broadcastId = `bct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const broadcast = await models.Broadcast.create({
      _id: broadcastId,
      orgId: account.orgId,
      accountId,
      platform: account.platform,
      name,
      content: content as MessageContent | undefined,
      templateId,
      templateParams: templateParams || {},
      audience: audience || {},
      throttlePerMinute: Number(throttlePerMinute) || 30,
      status: 'draft',
    });

    return res.status(201).json({ ok: true, broadcast });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/** Resolve the audience now — used by the UI to show "this will reach N people" before sending. */
router.get('/:id/preview', async (req, res) => {
  try {
    const broadcast = await models.Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });

    const contacts = await resolveAudience(broadcast);
    return res.json({ ok: true, count: contacts.length, sample: contacts.slice(0, 10).map((c) => c.username || c.igsid) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    const broadcast = await models.Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    if (broadcast.status === 'sending' || broadcast.status === 'sent') {
      return res.status(409).json({ error: `Broadcast is already ${broadcast.status}` });
    }

    const account = await models.SocialAccount.findById(broadcast.accountId);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const contacts = await resolveAudience(broadcast);
    if (contacts.length === 0) return res.status(400).json({ error: 'No contacts match this audience — nothing to send' });

    let template: any = null;
    if (broadcast.templateId) {
      template = await models.WhatsAppTemplate.findById(broadcast.templateId);
      if (!template) return res.status(400).json({ error: 'Referenced template was not found' });
      if (template.status !== 'APPROVED') {
        return res.status(400).json({ error: `Template "${template.name}" is not approved yet (status: ${template.status})` });
      }
    }

    await models.Broadcast.updateOne(
      { _id: broadcast._id },
      { $set: { status: 'sending', startedAt: new Date(), totalCount: contacts.length } },
    );

    // Respond immediately — Render's default request timeout would otherwise
    // cut off a broadcast to any meaningfully sized list.
    res.status(202).json({ ok: true, started: true, totalCount: contacts.length });

    void runBroadcast(broadcast, account, template, contacts);
  } catch (error: any) {
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

router.post('/:id/pause', async (req, res) => {
  try {
    await models.Broadcast.updateOne({ _id: req.params.id, status: 'sending' }, { $set: { status: 'paused' } });
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await models.Broadcast.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Broadcast not found' });
    await models.BroadcastRecipient.deleteMany({ broadcastId: req.params.id });
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function resolveAudience(broadcast: any) {
  const all = await models.Contact.find({ accountId: broadcast.accountId, optedOut: false, blocked: false }).lean();
  return all.filter((c) => matchesAudience(broadcast.audience, c));
}

async function runBroadcast(broadcast: any, account: any, template: any, contacts: any[]) {
  const intervalMs = Math.max(200, Math.floor(60_000 / Math.max(1, broadcast.throttlePerMinute)));
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const contact of contacts) {
    // A pause between calls checks in on cancellation without needing a job queue.
    const fresh = await models.Broadcast.findById(broadcast._id).select('status').lean();
    if (!fresh || fresh.status !== 'sending') break; // paused or deleted mid-run

    const recipientId = `bcr_${broadcast._id}_${contact._id}`.slice(0, 60);
    const already = await models.BroadcastRecipient.findOne({ broadcastId: broadcast._id, contactId: contact._id });
    if (already) continue;

    let outcome: { success: boolean; error?: string; messageId?: string; skipped?: boolean } = { success: false };

    try {
      if (account.platform === 'whatsapp') {
        const params = interpolateParams(broadcast.templateParams, contact);
        const send = await WhatsAppService.sendTemplate(
          account.phoneNumberId,
          contact.igsid,
          template.name,
          template.language,
          account.accessToken,
          params,
        );
        outcome = { success: send.success, error: send.error, messageId: send.messageId };
      } else {
        // Instagram / Facebook: only reachable if their own messaging window is
        // still open — Meta will reject a cold broadcast the same way a human
        // sender would be blocked from DMing a stranger.
        const withinWindow = contact.lastInboundAt && Date.now() - new Date(contact.lastInboundAt).getTime() < 24 * 60 * 60 * 1000;
        if (!withinWindow) {
          outcome = { success: false, skipped: true, error: 'Outside the 24h messaging window' };
        } else {
          const content = broadcast.content as MessageContent;
          const send = await MetaService.sendDirectMessage({
            recipientIgsid: contact.igsid,
            accessToken: account.accessToken,
            text: content?.kind === 'text' || content?.kind === 'buttons' ? content.text : '',
            buttons: content?.kind === 'buttons' ? content.buttons : undefined,
          });
          outcome = { success: send.success, error: send.error, messageId: send.data?.recipient_id };
        }
      }
    } catch (e: any) {
      outcome = { success: false, error: e.message };
    }

    await models.BroadcastRecipient.create({
      _id: recipientId,
      broadcastId: broadcast._id,
      contactId: contact._id,
      status: outcome.skipped ? 'skipped' : outcome.success ? 'sent' : 'failed',
      error: outcome.error,
      sentAt: outcome.success ? new Date() : undefined,
    }).catch(() => undefined);

    if (outcome.skipped) skipped += 1;
    else if (outcome.success) sent += 1;
    else failed += 1;

    await models.Broadcast.updateOne(
      { _id: broadcast._id },
      { $set: { sentCount: sent, failedCount: failed, skippedCount: skipped } },
    );

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  await models.Broadcast.updateOne(
    { _id: broadcast._id, status: 'sending' },
    { $set: { status: 'sent', finishedAt: new Date() } },
  );
}

function interpolateParams(params: Record<string, string> | undefined, contact: any): Record<string, string> {
  if (!params) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = v.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
      key === 'first_name' ? (contact.name || contact.username || 'there').split(' ')[0] : String(contact.fields?.[key] ?? contact[key] ?? ''),
    );
  }
  return out;
}

export default router;
