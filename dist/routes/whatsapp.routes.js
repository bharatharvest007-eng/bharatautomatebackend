import { Router } from 'express';
import * as models from '../models/index.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { classifyTemplate } from '../models/WhatsAppTemplate.js';
import { authOrgId } from '../lib/scope.js';
import { accountToken, encryptSecret, maskSecret } from '../lib/crypto.js';
const router = Router();
function sanitizeAccount(acc) {
    const obj = typeof acc.toObject === 'function' ? acc.toObject() : { ...acc };
    const rawToken = accountToken(obj);
    obj.hasAccessToken = Boolean(rawToken);
    obj.maskedToken = rawToken ? maskSecret(rawToken) : null;
    delete obj.accessToken;
    return obj;
}
// ---------------------------------------------------------------------
// Connect WhatsApp Number
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
        const orgId = authOrgId(req);
        const profile = validation.data;
        const accountId = `acc_wa_${phoneNumberId}`;
        const account = await models.SocialAccount.findOneAndUpdate({ orgId, phoneNumberId }, {
            $set: {
                platform: 'whatsapp',
                loginMode: 'whatsapp',
                username: profile.display_phone_number,
                name: profile.verified_name || profile.display_phone_number,
                phoneNumberId,
                wabaId,
                businessId,
                phoneNumber: profile.display_phone_number,
                displayNameStatus: profile.name_status,
                qualityRating: profile.quality_rating,
                messagingLimitTier: profile.messaging_limit_tier,
                accessToken: encryptSecret(accessToken),
                dailyDmLimit: Number(dailyDmLimit) || 1000,
                status: 'active',
                lastRefreshedAt: new Date(),
            },
            $setOnInsert: { _id: accountId, connectedAt: new Date() },
        }, { upsert: true, returnDocument: 'after', runValidators: true });
        const sub = await WhatsAppService.subscribeApp(wabaId, accessToken);
        if (sub.success) {
            await models.SocialAccount.updateOne({ _id: account._id }, { $set: { webhookSubscribed: true } });
            account.webhookSubscribed = true;
        }
        return res.status(201).json({
            ok: true,
            account: sanitizeAccount(account),
            webhookSubscribed: sub.success,
            webhookWarning: sub.success ? undefined : `Webhook subscription failed: ${sub.error}`,
            message: 'WhatsApp number connected successfully',
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.get('/', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const accounts = await models.SocialAccount.find({
            platform: 'whatsapp',
            orgId,
        }).sort({ connectedAt: -1 });
        return res.json({ ok: true, accounts: accounts.map(sanitizeAccount) });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.get('/:id/status', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const account = await models.SocialAccount.findOne({ _id: req.params.id, orgId });
        if (!account || account.platform !== 'whatsapp')
            return res.status(404).json({ error: 'WhatsApp account not found' });
        const token = accountToken(account);
        const validation = await WhatsAppService.validatePhoneNumber(account.phoneNumberId, token);
        if (validation.valid) {
            await models.SocialAccount.updateOne({ _id: account._id }, { $set: { qualityRating: validation.data.quality_rating, messagingLimitTier: validation.data.messaging_limit_tier, lastSyncAt: new Date() } });
        }
        return res.json({ ok: true, valid: validation.valid, data: validation.data, error: validation.error });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const deleted = await models.SocialAccount.findOneAndDelete({ _id: req.params.id, orgId, platform: 'whatsapp' });
        if (!deleted)
            return res.status(404).json({ error: 'WhatsApp account not found' });
        return res.json({ ok: true, message: 'WhatsApp number disconnected' });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// ---------------------------------------------------------------------
// Templates (HSMs)
// ---------------------------------------------------------------------
router.post('/:accountId/templates/sync', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const account = await models.SocialAccount.findOne({ _id: req.params.accountId, orgId });
        if (!account || account.platform !== 'whatsapp')
            return res.status(404).json({ error: 'WhatsApp account not found' });
        if (!account.wabaId)
            return res.status(400).json({ error: 'This account has no WABA id on file' });
        const token = accountToken(account);
        const result = await WhatsAppService.listTemplates(account.wabaId, token);
        if (!result.success)
            return res.status(502).json({ error: result.error });
        let synced = 0;
        const byKind = {};
        for (const t of result.templates) {
            const components = t.components || [];
            const carouselComponent = components.find((c) => c.type === 'CAROUSEL');
            const cards = carouselComponent?.cards || [];
            const { kind, headerFormat, buttonTypes, variableCount } = classifyTemplate(t.category, components);
            byKind[kind] = (byKind[kind] || 0) + 1;
            await models.WhatsAppTemplate.findOneAndUpdate({ accountId: account._id, name: t.name, language: t.language }, {
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
            }, { upsert: true });
            synced += 1;
        }
        return res.json({ ok: true, synced, byKind });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.get('/:accountId/templates', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const account = await models.SocialAccount.findOne({ _id: req.params.accountId, orgId });
        if (!account)
            return res.status(404).json({ error: 'Account not found' });
        const templates = await models.WhatsAppTemplate.find({ accountId: account._id }).sort({ updatedAt: -1 });
        return res.json({ ok: true, templates });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// ---------------------------------------------------------------------
// Test send
// ---------------------------------------------------------------------
router.post('/:accountId/send-test', async (req, res) => {
    try {
        const { to: rawTo, templateName, language } = req.body;
        if (!rawTo)
            return res.status(400).json({ error: '"to" (phone number) is required' });
        const to = String(rawTo).replace(/\D/g, '');
        if (to.length <= 10) {
            return res.status(400).json({
                error: `"${rawTo}" is missing country code — WhatsApp needs the full international number (e.g. 919390438443 for India).`,
            });
        }
        const orgId = authOrgId(req);
        const account = await models.SocialAccount.findOne({ _id: req.params.accountId, orgId });
        if (!account || account.platform !== 'whatsapp')
            return res.status(404).json({ error: 'WhatsApp account not found' });
        const token = accountToken(account);
        const result = templateName
            ? await WhatsAppService.sendTemplate(account.phoneNumberId, to, templateName, language || 'en_US', token)
            : await WhatsAppService.sendTemplate(account.phoneNumberId, to, 'hello_world', 'en_US', token);
        return res.json({ ok: result.success, result, normalizedTo: to });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
