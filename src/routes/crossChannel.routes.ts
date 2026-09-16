import { Router } from 'express';
import * as models from '../models/index.js';

/**
 * Cross-channel contact linking.
 *
 * WhatsApp identifies people by phone number; Instagram and Facebook identify
 * them by platform-scoped user id and generally have no phone number at all —
 * unless one was captured through a lead card or an `ask` flow node, in which
 * case it sits on that contact's `phone`/`whatsapp` field already.
 *
 * "Linking" doesn't merge records (an Instagram follower and a WhatsApp
 * conversation are genuinely different threads) — it upserts a WhatsApp
 * Contact using that phone number, tagged with where it came from. That's
 * deliberate: it means every existing tool that already targets an audience —
 * campaigns, automations, the contacts list — works on these contacts
 * immediately, with zero special-casing, because as far as the rest of the
 * app is concerned they're just WhatsApp contacts with a `from_instagram` tag.
 */

const router = Router();

function resolveGraphContact(contactRaw: any, sourcePlatform: string) {
  // Prefer an explicit `whatsapp` field (someone may have given a different
  // number for WhatsApp than the one they used elsewhere); fall back to `phone`.
  const raw = contactRaw.whatsapp || contactRaw.phone || '';
  const digits = String(raw).replace(/\D/g, '');
  return { digits, sourcePlatform, valid: digits.length > 10 };
}

/** Instagram/Facebook contacts that have a phone number on file and could be reached on WhatsApp. */
router.get('/candidates', async (req, res) => {
  try {
    const accounts = await models.SocialAccount.find({ platform: { $in: ['instagram', 'facebook'] } }).lean();
    const accountById = new Map(accounts.map((a: any) => [a._id, a]));
    if (accountById.size === 0) return res.json({ ok: true, candidates: [] });

    const contacts = await models.Contact.find({
      accountId: { $in: [...accountById.keys()] },
      $or: [{ phone: { $exists: true, $ne: '' } }, { whatsapp: { $exists: true, $ne: '' } }],
    })
      .sort({ lastSeenAt: -1 })
      .limit(500)
      .lean();

    // Already-linked contacts are recorded by the id they were linked FROM,
    // stashed in the WhatsApp-side contact's `fields` blob.
    const linkedFromIds = new Set(
      (await models.Contact.find({ 'fields.linkedFromContactId': { $exists: true } }, { 'fields.linkedFromContactId': 1 }).lean()).map(
        (c: any) => c.fields?.linkedFromContactId,
      ),
    );

    const candidates = contacts.map((c: any) => {
      const account = accountById.get(c.accountId);
      const resolved = resolveGraphContact(c, account?.platform);
      return {
        id: c._id,
        username: c.username,
        name: c.name,
        avatarUrl: c.avatarUrl,
        platform: account?.platform,
        accountUsername: account?.username,
        phone: c.phone,
        whatsapp: c.whatsapp,
        normalizedPhone: resolved.valid ? resolved.digits : null,
        phoneLooksValid: resolved.valid,
        alreadyLinked: linkedFromIds.has(c._id),
        tags: c.tags || [],
        lastSeenAt: c.lastSeenAt,
      };
    });

    return res.json({ ok: true, candidates });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/** Every WhatsApp contact created by a cross-channel link, with where it came from. */
router.get('/linked', async (req, res) => {
  try {
    const { whatsappAccountId } = req.query;
    const query: Record<string, unknown> = { 'fields.linkedFromContactId': { $exists: true } };
    if (whatsappAccountId) query.accountId = whatsappAccountId;

    const linked = await models.Contact.find(query).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({
      ok: true,
      linked: linked.map((c: any) => ({
        id: c._id,
        igsid: c.igsid,
        tags: c.tags,
        fromPlatform: c.fields?.linkedFromPlatform,
        fromUsername: c.fields?.linkedFromUsername,
        createdAt: c.createdAt,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/** Upsert the selected Instagram/Facebook contacts as WhatsApp contacts, using their phone number. */
router.post('/link', async (req, res) => {
  try {
    const { contactIds, whatsappAccountId } = req.body;
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'contactIds (array) is required' });
    }
    if (!whatsappAccountId) return res.status(400).json({ error: 'whatsappAccountId is required' });

    const waAccount = await models.SocialAccount.findById(whatsappAccountId);
    if (!waAccount || waAccount.platform !== 'whatsapp') {
      return res.status(404).json({ error: 'WhatsApp account not found' });
    }

    const sourceContacts = await models.Contact.find({ _id: { $in: contactIds } }).lean();
    const accountIds = [...new Set(sourceContacts.map((c: any) => c.accountId))];
    const sourceAccounts = await models.SocialAccount.find({ _id: { $in: accountIds } }).lean();
    const accountById = new Map(sourceAccounts.map((a: any) => [a._id, a]));

    const results: { contactId: string; status: 'linked' | 'skipped'; reason?: string; waContactId?: string }[] = [];

    for (const source of sourceContacts) {
      const account = accountById.get((source as any).accountId);
      const resolved = resolveGraphContact(source, account?.platform);

      if (!resolved.valid) {
        results.push({ contactId: (source as any)._id, status: 'skipped', reason: 'No usable phone number on file' });
        continue;
      }

      const waContact = await models.Contact.findOneAndUpdate(
        { accountId: whatsappAccountId, igsid: resolved.digits },
        {
          $set: {
            username: (source as any).username,
            name: (source as any).name || (source as any).username,
            avatarUrl: (source as any).avatarUrl,
            source: 'cross_channel_link',
            [`fields.linkedFromContactId`]: (source as any)._id,
            [`fields.linkedFromPlatform`]: account?.platform,
            [`fields.linkedFromUsername`]: (source as any).username || '',
          },
          $addToSet: { tags: { $each: ['cross_channel', `from_${account?.platform}`] } },
          $setOnInsert: {
            _id: `ctc_link_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            orgId: (waAccount as any).orgId,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        },
        { upsert: true, returnDocument: 'after' },
      );

      results.push({ contactId: (source as any)._id, status: 'linked', waContactId: (waContact as any)._id });
    }

    const linkedCount = results.filter((r) => r.status === 'linked').length;
    return res.json({ ok: true, linkedCount, skippedCount: results.length - linkedCount, results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/link/:waContactId', async (req, res) => {
  try {
    const deleted = await models.Contact.findOneAndDelete({
      _id: req.params.waContactId,
      'fields.linkedFromContactId': { $exists: true },
    });
    if (!deleted) return res.status(404).json({ error: 'Linked contact not found' });
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
