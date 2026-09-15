import { Router } from 'express';
import * as models from '../models/index.js';
import { MetaService } from '../services/metaService.js';

/**
 * Facebook Page connection.
 *
 * A Page has no OAuth flow of its own — you authorize with a Facebook *user*
 * token (Facebook Login for Business), then that user's Pages are listed and
 * one is chosen; the Page's own long-lived token (returned in that same list
 * call) is what gets stored and used for every future send. This mirrors the
 * two-step "discover then pick" shape Instagram's Facebook-Login path uses.
 */

const router = Router();

/** Step 1: given a Facebook user access token, list the Pages it can manage. */
router.post('/discover', async (req, res) => {
  try {
    const { userAccessToken } = req.body;
    if (!userAccessToken) return res.status(400).json({ error: 'userAccessToken is required' });

    const result = await MetaService.discoverFacebookPages(userAccessToken);
    if (!result.success) return res.status(400).json({ error: result.error });

    return res.json({ ok: true, pages: result.pages });
  } catch (error: any) {
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

    const validation = await MetaService.validateToken(pageAccessToken);
    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';
    const accountId = `acc_fb_${pageId}`;

    const account = await models.SocialAccount.findOneAndUpdate(
      { orgId, pageId, platform: 'facebook' },
      {
        $set: {
          platform: 'facebook',
          username: pageName || `page_${pageId}`,
          name: pageName,
          pageId,
          pageName,
          loginMode: 'facebook',
          accessToken: pageAccessToken,
          dailyDmLimit: Number(dailyDmLimit) || 1000,
          status: 'active',
        },
        $setOnInsert: { _id: accountId, connectedAt: new Date() },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );

    const sub = await MetaService.subscribePageWebhooks(pageId, pageAccessToken);
    if (sub.success) await models.SocialAccount.updateOne({ _id: account._id }, { $set: { webhookSubscribed: true } });

    return res.status(201).json({
      ok: true,
      account,
      metaValidation: validation,
      webhookSubscribed: sub.success,
      webhookWarning: sub.success ? undefined : `Webhook subscription failed: ${sub.error}`,
      message: 'Facebook Page connected successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/', async (_req, res) => {
  try {
    const org = await models.Organization.findOne();
    const accounts = await models.SocialAccount.find({ platform: 'facebook', ...(org ? { orgId: org._id } : {}) });
    return res.json({ ok: true, accounts });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/posts', async (req, res) => {
  try {
    const account = await models.SocialAccount.findById(req.params.id);
    if (!account || account.platform !== 'facebook') return res.status(404).json({ error: 'Facebook Page not found' });

    const result = await MetaService.fetchPagePosts(account.pageId!, account.accessToken);
    return res.json({ ok: result.success, posts: result.posts, error: result.error });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await models.SocialAccount.findOneAndDelete({ _id: req.params.id, platform: 'facebook' });
    if (!deleted) return res.status(404).json({ error: 'Facebook Page not found' });
    return res.json({ ok: true, message: 'Facebook Page disconnected' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
