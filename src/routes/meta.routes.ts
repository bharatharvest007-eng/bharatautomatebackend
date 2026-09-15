import { Router } from 'express';
import { FlowEngine } from '../services/flowEngine.js';
import { MetaService } from '../services/metaService.js';
import * as models from '../models/index.js';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// Meta Webhook Challenge Verification (GET)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken =
    process.env.META_WEBHOOK_VERIFY_TOKEN || 'dev-meta-webhook-verify-token-change-me';

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('[Meta Webhook] Successfully verified by Meta challenge!');
    return res.status(200).send(challenge);
  }

  console.warn('[Meta Webhook] Challenge verification failed. Verify tokens mismatch.');
  return res.status(403).send('Forbidden');
});

// Meta Webhook Event Ingestion (POST)
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = process.env.META_APP_SECRET;

  if (appSecret && signature) {
    const rawBody = JSON.stringify(req.body);
    const valid = MetaService.verifySignature(rawBody, signature, appSecret);
    if (!valid && process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  // Acknowledge Meta immediately with 200 OK
  res.status(200).send('EVENT_RECEIVED');

  // Persist the raw delivery before doing anything with it. Without this there
  // is no way to tell "Meta never delivered" apart from "we mishandled it",
  // which is the difference between a Meta config problem and a code problem.
  const rawPayload = JSON.stringify(req.body);
  let eventId: string | null = null;
  try {
    eventId = `wh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await models.WebhookEvent.create({
      _id: eventId,
      platform: 'instagram',
      objectId: req.body?.entry?.[0]?.id,
      field: req.body?.entry?.[0]?.changes?.[0]?.field ?? (req.body?.entry?.[0]?.messaging ? 'messaging' : undefined),
      // Signature is unique-indexed, so a Meta redelivery collapses onto one row.
      signature: signature || `nosig_${eventId}`,
      payload: rawPayload,
      status: 'processing',
      attempts: 1,
    });
  } catch (e: any) {
    if (e?.code === 11000) {
      console.log('[Meta Webhook] Duplicate delivery ignored');
      return;
    }
    console.error('[Meta Webhook] Could not persist event:', e.message);
  }

  try {
    const { entry } = req.body;
    if (!Array.isArray(entry)) return;

    for (const e of entry) {
      // Check for Instagram comment changes
      if (Array.isArray(e.changes)) {
        for (const change of e.changes) {
          if (change.field === 'comments') {
            const val = change.value;
            const result = await FlowEngine.processComment({
              accountId: e.id,
              commentId: val.id,
              mediaId: val.media?.id,
              userIgsid: val.from?.id,
              username: val.from?.username || 'user',
              commentText: val.text || '',
            });
            console.log(
              `[Meta Webhook] Comment "${val.text}" from @${val.from?.username} -> ${JSON.stringify(result)}`
            );
          }
        }
      }

      // Check for messaging / DMs
      if (Array.isArray(e.messaging)) {
        for (const msg of e.messaging) {
          const senderIgsid = msg.sender?.id;
          const text = msg.message?.text;
          console.log(`[Meta Webhook] Incoming DM from ${senderIgsid}: "${text}"`);
        }
      }
    }

    if (eventId) {
      await models.WebhookEvent.updateOne(
        { _id: eventId },
        { $set: { status: 'done', processedAt: new Date() } }
      );
    }
  } catch (error: any) {
    console.error('[Meta Webhook] Error processing event in background:', error);
    if (eventId) {
      await models.WebhookEvent.updateOne(
        { _id: eventId },
        { $set: { status: 'failed', error: String(error?.message || error), processedAt: new Date() } }
      ).catch(() => undefined);
    }
  }
});

/** Recent webhook deliveries — the fastest way to tell whether Meta is calling us. */
router.get('/webhook/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const events = await models.WebhookEvent.find({})
    .sort({ receivedAt: -1 })
    .limit(limit)
    .lean();

  return res.json({
    ok: true,
    count: events.length,
    events: events.map((e: any) => ({
      id: e._id,
      field: e.field,
      objectId: e.objectId,
      status: e.status,
      error: e.error,
      receivedAt: e.receivedAt,
      payload: (() => {
        try {
          return JSON.parse(e.payload);
        } catch {
          return e.payload;
        }
      })(),
    })),
  });
});

// Test Webhook Simulator (Test any comment against live flows from the dashboard)
router.post('/test-webhook', async (req, res) => {
  try {
    const { commentText, username = 'test_user', accountId } = req.body;
    if (!commentText) return res.status(400).json({ error: 'Comment text is required' });

    let targetAccountId = accountId;
    if (!targetAccountId) {
      const acc = await models.SocialAccount.findOne();
      targetAccountId = acc ? acc._id : 'acc_default';
    }

    const result = await FlowEngine.processComment({
      accountId: targetAccountId,
      commentId: `cmt_test_${Date.now()}`,
      mediaId: `med_test_${Date.now()}`,
      userIgsid: `usr_test_${Date.now()}`,
      username,
      commentText,
    });

    return res.json({ ok: true, result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Direct Instagram Login OAuth URL Builder
// Ref: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
router.get('/oauth/url', (req, res) => {
  // Instagram Business Login authenticates against the *Instagram* app id, which
  // is issued by the Instagram product and is a different number from the
  // Facebook App ID on App settings > Basic. Sending the Facebook App ID here is
  // what makes instagram.com answer "Sorry, this page isn't available".
  const instagramAppId = process.env.INSTAGRAM_APP_ID;
  const facebookAppId = process.env.META_APP_ID;
  const appId = instagramAppId || facebookAppId;

  const redirectUri =
    process.env.META_REDIRECT_URI || 'https://bharatautomatebackend.onrender.com/api/meta/oauth/callback';

  if (!appId) {
    return res.json({
      ok: false,
      configured: false,
      message:
        'Instagram App ID is not configured yet. Add INSTAGRAM_APP_ID (App Dashboard > Instagram > API setup with Instagram business login), or paste a Page Access Token to connect manually.',
    });
  }

  const usingFacebookAppId = !instagramAppId;
  if (usingFacebookAppId) {
    console.warn(
      '[Instagram Login] INSTAGRAM_APP_ID is not set — falling back to META_APP_ID (%s). ' +
        'Instagram Business Login usually rejects the Facebook App ID with "this page isn\'t available".',
      facebookAppId
    );
  }

  const scopes = (process.env.INSTAGRAM_SCOPES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const instagramLoginUrl = MetaService.buildInstagramLoginUrl({
    appId,
    redirectUri,
    state: `sma_${Date.now().toString(36)}`,
    scopes,
  });

  return res.json({
    ok: true,
    configured: true,
    type: 'instagram_login',
    url: instagramLoginUrl,
    // Surfaced so the dashboard can warn before the user hits a dead Instagram page.
    usingFacebookAppId,
    appId,
    redirectUri,
    scopes: scopes.length ? scopes : MetaService.DEFAULT_INSTAGRAM_SCOPES,
    ...(usingFacebookAppId
      ? {
          warning:
            'Using the Facebook App ID for Instagram Business Login. Set INSTAGRAM_APP_ID to the Instagram app ID, and register this exact redirect URI under Instagram > API setup with Instagram business login > Business login settings.',
        }
      : {}),
  });
});

// Instagram OAuth Callback Handler
router.get('/oauth/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;
  const errorReason = req.query.error_reason as string | undefined;
  const errorDescription = req.query.error_description as string | undefined;

  const frontendUrl =
    process.env.FRONTEND_URL || 'https://bharatautomatefrontend.vercel.app';

  if (error || !code) {
    console.error('[Instagram Login] Authorization rejected or failed:', error, errorDescription);
    return res.redirect(
      `${frontendUrl}/accounts?error=${encodeURIComponent(errorDescription || error || 'Authorization cancelled')}`
    );
  }

  try {
    // Must be the same credential pair used to build the authorize URL, or
    // Instagram rejects the code exchange with "Invalid platform app".
    const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || '';
    const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || '';
    const redirectUri =
      process.env.META_REDIRECT_URI || 'https://bharatautomatebackend.onrender.com/api/meta/oauth/callback';

    const exchange = await MetaService.exchangeInstagramCode({
      code: code.replace(/#_$/, ''), // Instagram appends #_ to auth codes
      appId,
      appSecret,
      redirectUri,
    });

    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';

    const accountId = `acc_${exchange.username.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now().toString(36)}`;

    // Upsert social account.
    // Field names must match the SocialAccount schema exactly: Mongoose runs in
    // strict mode and silently DROPS unknown keys, so a typo here stores nothing
    // and fails later at send time instead of here.
    const scopes = (process.env.INSTAGRAM_SCOPES || MetaService.DEFAULT_INSTAGRAM_SCOPES.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const account = await models.SocialAccount.findOneAndUpdate(
      { orgId, igUserId: exchange.instagramUserId },
      {
        $set: {
          platform: 'instagram',
          username: exchange.username,
          name: exchange.displayName,
          igUserId: exchange.instagramUserId,
          avatarUrl: exchange.avatarUrl,
          accountType: exchange.accountType,
          followersCount: exchange.followersCount,
          followsCount: exchange.followsCount,
          mediaCount: exchange.mediaCount,
          biography: exchange.biography,
          website: exchange.website,
          loginMode: 'instagram',
          accessToken: exchange.accessToken,
          tokenExpiresAt: new Date(Date.now() + exchange.expiresIn * 1000),
          lastRefreshedAt: new Date(),
          scopes,
          status: 'active',
          statusReason: null,
        },
        $setOnInsert: {
          _id: accountId,
          dailyDmLimit: 2500,
          connectedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    // Subscribe to webhooks immediately — without this the account is connected
    // but completely inert: no comment or DM ever reaches the automations.
    const sub = await MetaService.subscribeWebhooks(exchange.instagramUserId, exchange.accessToken);
    if (sub.success) {
      await models.SocialAccount.updateOne(
        { _id: account?._id ?? accountId },
        { $set: { webhookSubscribed: true, lastSyncAt: new Date() } }
      );
      console.log(`[Instagram Login] Webhooks subscribed for @${exchange.username}`);
    } else {
      console.warn(`[Instagram Login] Webhook subscribe failed for @${exchange.username}:`, sub.error);
    }

    console.log(`[Instagram Login] Successfully authorized and connected: @${exchange.username}`);

    // If opened via popup, return script to notify opener and close; otherwise redirect
    const htmlResponse = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Instagram Connected</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #090d16; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background: #0f172a; padding: 2rem; border-radius: 1.5rem; border: 1px solid #1e293b; max-width: 400px; }
            h2 { color: #f43f5e; margin-bottom: 0.5rem; }
            p { color: #94a3b8; font-size: 0.9rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Connected Successfully! 🎉</h2>
            <p>Your Instagram account <strong>@${exchange.username}</strong> has been linked.</p>
            <p>Redirecting to dashboard...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'INSTAGRAM_CONNECTED', account: ${JSON.stringify(account)} }, '*');
              setTimeout(() => window.close(), 1200);
            } else {
              window.location.href = "${frontendUrl}/accounts?connected=true&username=${encodeURIComponent(exchange.username)}";
            }
          </script>
        </body>
      </html>
    `;

    return res.status(200).send(htmlResponse);
  } catch (err: any) {
    console.error('[Instagram Login] Token exchange failed:', err.response?.data || err.message);
    const errMessage = err.response?.data?.error_message || err.message;
    return res.redirect(`${frontendUrl}/accounts?error=${encodeURIComponent(errMessage)}`);
  }
});

// Update Meta App Credentials on the fly
router.post('/config', (req, res) => {
  const { appId, appSecret, redirectUri, instagramAppId, instagramAppSecret } = req.body;
  if (appId) process.env.META_APP_ID = appId;
  if (appSecret) process.env.META_APP_SECRET = appSecret;
  if (redirectUri) process.env.META_REDIRECT_URI = redirectUri;
  // Instagram Business Login uses its own app id/secret pair.
  if (instagramAppId) process.env.INSTAGRAM_APP_ID = instagramAppId;
  if (instagramAppSecret) process.env.INSTAGRAM_APP_SECRET = instagramAppSecret;

  const igId = process.env.INSTAGRAM_APP_ID || '';
  return res.json({
    ok: true,
    configured: Boolean((igId || process.env.META_APP_ID) && (process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET)),
    appId: process.env.META_APP_ID || '',
    instagramAppId: igId,
    instagramLoginReady: Boolean(igId && process.env.INSTAGRAM_APP_SECRET),
  });
});

export default router;
