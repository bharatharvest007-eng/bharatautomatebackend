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
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Connect an Instagram account directly with a Page Access Token & Instagram Business ID.
// Field names below match the SocialAccount schema exactly — Mongoose strict
// mode silently drops anything that doesn't, which is how this route used to
// "succeed" while saving an account that could never actually send a DM.
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
    const cleanUsername = username.replace('@', '');
    const igUserId = instagramBusinessId || validation.data?.id || `ig_${Date.now()}`;

    const accountId = `acc_${cleanUsername.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now().toString(36)}`;

    const account = await models.SocialAccount.findOneAndUpdate(
      { orgId, igUserId },
      {
        $set: {
          platform: 'instagram',
          username: cleanUsername,
          name: cleanUsername,
          igUserId,
          loginMode: 'facebook', // manual Page Access Token, not Instagram Login
          accessToken,
          tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
          dailyDmLimit: Number(dailyDmLimit) || 1000,
          status: 'active',
        },
        $setOnInsert: { _id: accountId, connectedAt: new Date() },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );

    return res.status(201).json({
      ok: true,
      account,
      metaValidation: validation,
      message: 'Instagram account connected successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update custom DM limit
router.patch('/:id/limit', async (req, res) => {
  try {
    const { limit } = req.body;
    const account = await models.SocialAccount.findByIdAndUpdate(
      req.params.id,
      { $set: { dailyDmLimit: Number(limit) } },
      { returnDocument: 'after' }
    );
    if (!account) return res.status(404).json({ error: 'Account not found' });
    return res.json({ ok: true, account });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Test live token validity
router.get('/:id/status', async (req, res) => {
  try {
    const account = await models.SocialAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const status = await MetaService.validateToken(account.accessToken);
    return res.json({ ok: true, status, accountId: account._id, username: account.username });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Disconnect account
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await models.SocialAccount.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Account not found' });
    return res.json({ ok: true, message: 'Account disconnected successfully' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
