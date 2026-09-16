import { Router } from 'express';
import * as models from '../models/index.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { classifyTemplate } from '../models/WhatsAppTemplate.js';

/**
 * WhatsApp Business Cloud API connection + template management.
 *
 * Connecting is a manual-token flow (paste the Phone Number ID, WABA ID and a
 * System User access token generated in Meta Business Manager) rather than an
 * OAuth redirect — WhatsApp's polished "Continue with Facebook" Embedded
 * Signup needs the WhatsApp product added to the Meta app first, the same
 * class of one-time setup step Instagram Business Login needed. This route
 * works the moment those three values exist, with no App Review wait.
 */

const router = Router();

// ---------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------

router.post('/connect', async (req, res) => {
  try {
    const { phoneNumberId, wabaId, accessToken, businessId, dailyDmLimit } = req.body;

    if (!phoneNumberId || !wabaId || !accessToken) {
      return res.status(400).json({
        error: 'phoneNumberId, wabaId and accessToken are all required',
      });
    }

    const validation = await WhatsAppService.validatePhoneNumber(phoneNumberId, accessToken);
    if (!validation.valid) {
      return res.status(400).json({ error: `Could not verify this number with Meta: ${validation.error}` });
    }

    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';
    const profile = validation.data;
    const accountId = `acc_wa_${phoneNumberId}`;

    const account = await models.SocialAccount.findOneAndUpdate(
      { orgId, phoneNumberId },
      {
        $set: {
          platform: 'whatsapp',
          // loginMode defaults to 'instagram' on the schema (that field only
          // ever meant something for Instagram accounts); set it explicitly
          // so a WhatsApp record doesn't carry a misleading leftover value.
          loginMode: 'whatsapp',
          username: profile.display_phone_number,
          name: profile.verified_name,
          phoneNumberId,
          wabaId,
          businessId,
          phoneNumber: profile.display_phone_number,
          displayNameStatus: profile.name_status,
          qualityRating: profile.quality_rating,
          messagingLimitTier: profile.messaging_limit_tier,
          accessToken,
          dailyDmLimit: Number(dailyDmLimit) || 1000,
          status: 'active',
        },
        $setOnInsert: { _id: accountId, connectedAt: new Date() },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );

    // Subscribe this WABA to the app right away — matches the Instagram
    // connect flow, and means a customer's very first message actually
    // reaches an automation instead of vanishing.
    const sub = await WhatsAppService.subscribeApp(wabaId, accessToken);
    if (sub.success) {
      await models.SocialAccount.updateOne({ _id: account._id }, { $set: { webhookSubscribed: true } });
      account.webhookSubscribed = true; // keep the object we're about to return in sync with what we just persisted
    }

    return res.status(201).json({
      ok: true,
      account,
      webhookSubscribed: sub.success,
      webhookWarning: sub.success ? undefined : `Webhook subscription failed: ${sub.error}. Comment automations won't fire until this is fixed.`,
      message: 'WhatsApp number connected successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/', async (_req, res) => {
  try {
    const org = await models.Organization.findOne();
    const accounts = await models.SocialAccount.find({
      platform: 'whatsapp',
      ...(org ? { orgId: org._id } : {}),
    });
    return res.json({ ok: true, accounts });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const account = await models.SocialAccount.findById(req.params.id);
    if (!account || account.platform !== 'whatsapp') return res.status(404).json({ error: 'WhatsApp account not found' });

    const validation = await WhatsAppService.validatePhoneNumber(account.phoneNumberId!, account.accessToken);
    if (validation.valid) {
      await models.SocialAccount.updateOne(
        { _id: account._id },
        { $set: { qualityRating: validation.data.quality_rating, messagingLimitTier: validation.data.messaging_limit_tier, lastSyncAt: new Date() } },
      );
    }
    return res.json({ ok: true, valid: validation.valid, data: validation.data, error: validation.error });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await models.SocialAccount.findOneAndDelete({ _id: req.params.id, platform: 'whatsapp' });
    if (!deleted) return res.status(404).json({ error: 'WhatsApp account not found' });
    return res.json({ ok: true, message: 'WhatsApp number disconnected' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------
// Templates (HSMs) — required for the first message and anything outside 24h
// ---------------------------------------------------------------------

/** Pull the current template list + statuses from Meta into our local mirror. */
router.post('/:accountId/templates/sync', async (req, res) => {
  try {
    const account = await models.SocialAccount.findById(req.params.accountId);
    if (!account || account.platform !== 'whatsapp') return res.status(404).json({ error: 'WhatsApp account not found' });
    if (!account.wabaId) return res.status(400).json({ error: 'This account has no WABA id on file' });

    const result = await WhatsAppService.listTemplates(account.wabaId, account.accessToken);
    if (!result.success) return res.status(502).json({ error: result.error });

    let synced = 0;
    const byKind: Record<string, number> = {};

    for (const t of result.templates) {
      const components = t.components || [];
      // Meta nests a carousel's cards inside its CAROUSEL component; we hoist
      // them to a top-level field so the template picker can render/filter
      // carousels without digging through the component tree every time.
      const carouselComponent = components.find((c: any) => c.type === 'CAROUSEL');
      const cards = carouselComponent?.cards || [];

      const { kind, headerFormat, buttonTypes, variableCount } = classifyTemplate(t.category, components);
      byKind[kind] = (byKind[kind] || 0) + 1;

      await models.WhatsAppTemplate.findOneAndUpdate(
        { accountId: account._id, name: t.name, language: t.language },
        {
          $set: {
            orgId: account.orgId,
            accountId: account._id,
            metaTemplateId: t.id,
            name: t.name,
            language: t.language,
            category: t.category,
            kind,
            status: t.status,
            components,
            cards,
            variableCount,
            headerFormat,
            buttonTypes,
            rejectedReason: t.rejected_reason,
            lastSyncedAt: new Date(),
          },
          $setOnInsert: { _id: `wat_${t.id || Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` },
        },
        { upsert: true },
      );
      synced += 1;
    }

    return res.json({ ok: true, synced, byKind });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:accountId/templates', async (req, res) => {
  try {
    const templates = await models.WhatsAppTemplate.find({ accountId: req.params.accountId }).sort({ updatedAt: -1 });
    return res.json({ ok: true, templates });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------
// Test send — the fastest way to confirm the connection actually works
// ---------------------------------------------------------------------

router.post('/:accountId/send-test', async (req, res) => {
  try {
    const { to: rawTo, templateName, language } = req.body;
    if (!rawTo) return res.status(400).json({ error: '"to" (a phone number, digits only, country code first) is required' });

    // Meta matches the recipient against its own allow-list (for test
    // numbers) and its own account record byte-for-byte on the digit string —
    // "9390438443" and "919390438443" are different values to that check even
    // though a human reads them as the same number. Strip everything but
    // digits so spaces/dashes/parens/a leading "+" never cause a false
    // mismatch, then catch the single most common real mistake — forgetting
    // the country code — with an error that says so, instead of letting it
    // travel to Meta and come back as an opaque "not in allowed list".
    const to = String(rawTo).replace(/\D/g, '');
    if (to.length <= 10) {
      return res.status(400).json({
        error: `"${rawTo}" looks like it's missing a country code — WhatsApp needs the full number (e.g. 91 + 9390438443 for India → 919390438443), with no + or spaces. This must also match exactly how the number is registered as a test recipient in Meta's console.`,
      });
    }

    const account = await models.SocialAccount.findById(req.params.accountId);
    if (!account || account.platform !== 'whatsapp') return res.status(404).json({ error: 'WhatsApp account not found' });

    // A test send is always the first message in the conversation as far as
    // WhatsApp is concerned, so it must be a template — free text would be
    // silently rejected outside the 24h window, which is every fresh contact.
    const result = templateName
      ? await WhatsAppService.sendTemplate(account.phoneNumberId!, to, templateName, language || 'en_US', account.accessToken)
      : await WhatsAppService.sendTemplate(account.phoneNumberId!, to, 'hello_world', 'en_US', account.accessToken);

    return res.json({ ok: result.success, result, normalizedTo: to });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
