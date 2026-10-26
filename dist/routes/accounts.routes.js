import { Router } from 'express';
import * as models from '../models/index.js';
import { MetaService } from '../services/metaService.js';
import { authOrgId } from '../lib/scope.js';
import { accountToken, encryptSecret, maskSecret } from '../lib/crypto.js';
const router = Router();
/** Sanitizes social accounts so sensitive tokens are never sent in plaintext over API */
function sanitizeAccount(acc) {
    const obj = typeof acc.toObject === 'function' ? acc.toObject() : { ...acc };
    const rawToken = accountToken(obj);
    obj.hasAccessToken = Boolean(rawToken);
    obj.maskedToken = rawToken ? maskSecret(rawToken) : null;
    delete obj.accessToken;
    return obj;
}
// List connected accounts for current workspace
router.get('/', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const accounts = await models.SocialAccount.find({ orgId }).sort({ connectedAt: -1 });
        return res.json({ ok: true, accounts: accounts.map(sanitizeAccount) });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Connect an Instagram account directly with a Page Access Token & Instagram Business ID.
router.post('/connect', async (req, res) => {
    try {
        const { username, instagramBusinessId, accessToken, dailyDmLimit } = req.body;
        if (!username || !accessToken) {
            return res.status(400).json({ error: 'Username and Page Access Token are required' });
        }
        const orgId = authOrgId(req);
        // Verify token validity with Meta Graph API
        const validation = await MetaService.validateToken(accessToken);
        const cleanUsername = username.replace('@', '');
        const igUserId = instagramBusinessId || validation.data?.id || `ig_${Date.now()}`;
        const accountId = `acc_${cleanUsername.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now().toString(36)}`;
        const account = await models.SocialAccount.findOneAndUpdate({ orgId, igUserId }, {
            $set: {
                platform: 'instagram',
                username: cleanUsername,
                name: cleanUsername,
                igUserId,
                loginMode: 'facebook', // manual Page Access Token, not Instagram Login
                accessToken: encryptSecret(accessToken),
                tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
                dailyDmLimit: Number(dailyDmLimit) || 1000,
                status: 'active',
                lastRefreshedAt: new Date(),
            },
            $setOnInsert: { _id: accountId, connectedAt: new Date() },
        }, { upsert: true, returnDocument: 'after', runValidators: true });
        return res.status(201).json({
            ok: true,
            account: sanitizeAccount(account),
            metaValidation: validation,
            message: 'Instagram account connected successfully',
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Update custom DM limit
router.patch('/:id/limit', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const { limit } = req.body;
        const account = await models.SocialAccount.findOneAndUpdate({ _id: req.params.id, orgId }, { $set: { dailyDmLimit: Number(limit) } }, { returnDocument: 'after' });
        if (!account)
            return res.status(404).json({ error: 'Account not found' });
        return res.json({ ok: true, account: sanitizeAccount(account) });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Test live token validity
router.get('/:id/status', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const account = await models.SocialAccount.findOne({ _id: req.params.id, orgId });
        if (!account)
            return res.status(404).json({ error: 'Account not found' });
        const token = accountToken(account);
        const status = await MetaService.validateToken(token);
        return res.json({ ok: true, status, accountId: account._id, username: account.username });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Disconnect account
router.delete('/:id', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const deleted = await models.SocialAccount.findOneAndDelete({ _id: req.params.id, orgId });
        if (!deleted)
            return res.status(404).json({ error: 'Account not found' });
        return res.json({ ok: true, message: 'Account disconnected successfully' });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
