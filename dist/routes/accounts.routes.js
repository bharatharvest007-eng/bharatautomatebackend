import { Router } from 'express';
import * as models from '../models/index.js';
import { MetaService } from '../services/metaService.js';
const router = Router();
// List connected accounts (Up to 10)
router.get('/', async (req, res) => {
    try {
        const org = await models.Organization.findOne();
        const accounts = await models.SocialAccount.find(org ? { orgId: org._id } : {});
        return res.json({ ok: true, accounts });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Connect account directly with Page Access Token & Instagram Business ID
router.post('/connect', async (req, res) => {
    try {
        const { username, instagramBusinessId, accessToken, dailyDmLimit } = req.body;
        if (!username || !accessToken) {
            return res.status(400).json({ error: 'Username and Page Access Token are required' });
        }
        const org = await models.Organization.findOne();
        const orgId = org ? org._id : 'org_workspace';
        // Verify token validity with Meta Graph API
        const validation = await MetaService.validateToken(accessToken);
        const accountId = `acc_${username.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now().toString(36)}`;
        const account = await models.SocialAccount.create({
            _id: accountId,
            orgId,
            platform: 'instagram',
            username: username.replace('@', ''),
            displayName: username,
            instagramBusinessId: instagramBusinessId || validation.data?.id || `ig_${Date.now()}`,
            accessToken,
            tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
            dailyDmLimit: Number(dailyDmLimit) || 1000,
            status: 'active',
            capabilities: ['messages', 'comments', 'mentions', 'insights'],
        });
        return res.status(201).json({
            ok: true,
            account,
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
        const { limit } = req.body;
        const account = await models.SocialAccount.findByIdAndUpdate(req.params.id, { $set: { dailyDmLimit: Number(limit) } }, { returnDocument: 'after' });
        if (!account)
            return res.status(404).json({ error: 'Account not found' });
        return res.json({ ok: true, account });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Test live token validity
router.get('/:id/status', async (req, res) => {
    try {
        const account = await models.SocialAccount.findById(req.params.id);
        if (!account)
            return res.status(404).json({ error: 'Account not found' });
        const status = await MetaService.validateToken(account.accessToken);
        return res.json({ ok: true, status, accountId: account._id, username: account.username });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Disconnect account
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await models.SocialAccount.findByIdAndDelete(req.params.id);
        if (!deleted)
            return res.status(404).json({ error: 'Account not found' });
        return res.json({ ok: true, message: 'Account disconnected successfully' });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
