import { Router } from 'express';
import * as models from '../models/index.js';
import { MetaService } from '../services/metaService.js';
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
/** Step 1: given a Facebook user access token, list the Pages it can manage. */
router.post('/discover', async (req, res) => {
    try {
        const { userAccessToken } = req.body;
        if (!userAccessToken)
            return res.status(400).json({ error: 'userAccessToken is required' });
        const result = await MetaService.discoverFacebookPages(userAccessToken);
        if (!result.success)
            return res.status(400).json({ error: result.error });
        return res.json({ ok: true, pages: result.pages });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
/** Step 2: connect one of the discovered Pages (or one pasted in directly). */
router.post('/connect', async (req, res) => {
    try {
        const { pageId, pageName, pageAccessToken, dailyDmLimit } = req.body;
        if (!pageId || !pageAccessToken) {
            return res.status(400).json({ error: 'pageId and pageAccessToken are required' });
        }
        const orgId = authOrgId(req);
        const validation = await MetaService.validateToken(pageAccessToken);
        const accountId = `acc_fb_${pageId}`;
        const account = await models.SocialAccount.findOneAndUpdate({ orgId, pageId, platform: 'facebook' }, {
            $set: {
                platform: 'facebook',
                username: pageName || `page_${pageId}`,
                name: pageName,
                pageId,
                pageName,
                loginMode: 'facebook',
                accessToken: encryptSecret(pageAccessToken),
                tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
                dailyDmLimit: Number(dailyDmLimit) || 1000,
                status: 'active',
                lastRefreshedAt: new Date(),
            },
            $setOnInsert: { _id: accountId, connectedAt: new Date() },
        }, { upsert: true, returnDocument: 'after', runValidators: true });
        const sub = await MetaService.subscribePageWebhooks(pageId, pageAccessToken);
        if (sub.success)
            await models.SocialAccount.updateOne({ _id: account._id }, { $set: { webhookSubscribed: true } });
        return res.status(201).json({
            ok: true,
            account: sanitizeAccount(account),
            metaValidation: validation,
            webhookSubscribed: sub.success,
            webhookWarning: sub.success ? undefined : `Webhook subscription failed: ${sub.error}`,
            message: 'Facebook Page connected successfully',
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.get('/', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const accounts = await models.SocialAccount.find({ platform: 'facebook', orgId }).sort({ connectedAt: -1 });
        return res.json({ ok: true, accounts: accounts.map(sanitizeAccount) });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.get('/:id/posts', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const account = await models.SocialAccount.findOne({ _id: req.params.id, orgId });
        if (!account || account.platform !== 'facebook')
            return res.status(404).json({ error: 'Facebook Page not found' });
        const token = accountToken(account);
        const result = await MetaService.fetchPagePosts(account.pageId, token);
        return res.json({ ok: result.success, posts: result.posts, error: result.error });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const deleted = await models.SocialAccount.findOneAndDelete({ _id: req.params.id, orgId, platform: 'facebook' });
        if (!deleted)
            return res.status(404).json({ error: 'Facebook Page not found' });
        return res.json({ ok: true, message: 'Facebook Page disconnected' });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
