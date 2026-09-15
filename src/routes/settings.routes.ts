import { Router } from 'express';
import * as models from '../models/index.js';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// Get workspace settings
router.get('/', async (req, res) => {
  try {
    const org = await models.Organization.findOne();
    const port = process.env.PORT || '5000';
    const baseUrl =
      process.env.BASE_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://bharatautomatebackend.onrender.com'
        : `http://localhost:${port}`);

    return res.json({
      ok: true,
      settings: {
        workspaceName: org?.name || 'My Workspace',
        plan: org?.plan || 'unlimited',
        timezone: org?.timezone || 'UTC',
        webhookCallbackUrl: `${baseUrl}/api/meta/webhook`,
        webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || 'dev-meta-webhook-verify-token-change-me',
        metaAppId: process.env.META_APP_ID || '',
        hasAppSecret: Boolean(process.env.META_APP_SECRET),
        hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-dummy')),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update workspace settings
router.put('/', async (req, res) => {
  try {
    const { workspaceName, timezone } = req.body;
    const org = await models.Organization.findOneAndUpdate(
      {},
      {
        $set: {
          ...(workspaceName && { name: workspaceName }),
          ...(timezone && { timezone }),
        },
      },
      { returnDocument: 'after' }
    );

    return res.json({ ok: true, org });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
