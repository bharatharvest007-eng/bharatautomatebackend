import { Router } from 'express';
import { FlowEngine } from '../services/flowEngine.js';
import { MetaService } from '../services/metaService.js';
import { WhatsAppService } from '../services/whatsappService.js';
import * as models from '../models/index.js';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

/**
 * Instagram DMs and Facebook Messenger share the exact same `messaging`/
 * `changes` envelope — only which SocialAccount field identifies the account
 * (igUserId vs pageId) and which automation trigger types apply differ, and
 * FlowEngine already knows how to handle that per `platform`.
 */
async function handleMetaEntry(e: any, platform: 'instagram' | 'facebook') {
  if (Array.isArray(e.changes)) {
    for (const change of e.changes) {
      if (change.field === 'comments' || change.field === 'live_comments') {
        const val = change.value;
        const result =
          platform === 'instagram'
            ? await FlowEngine.processComment({
                accountId: e.id,
                commentId: val.id,
                mediaId: val.media?.id,
                userIgsid: val.from?.id,
                username: val.from?.username || 'user',
                commentText: val.text || '',
              })
            : await FlowEngine.processFacebookComment({
                accountExternalId: e.id,
                commentId: val.id,
                mediaId: val.post_id || val.media?.id,
                senderId: val.from?.id,
                senderUsername: val.from?.name || val.from?.username,
                text: val.message || val.text || '',
                timestamp: new Date(),
              });
        console.log(`[Meta Webhook] ${platform} comment "${val.text || val.message}" -> ${JSON.stringify(result)}`);
      } else if (change.field === 'feed') {
        // A Facebook Page's feed field bundles post edits, reactions and
        // comments together — only a freshly added comment is actionable here.
        const val = change.value;
        if (val.item === 'comment' && val.verb === 'add') {
          const result = await FlowEngine.processFacebookComment({
            accountExternalId: e.id,
            commentId: val.comment_id,
            mediaId: val.post_id,
            senderId: val.from?.id,
            senderUsername: val.from?.name,
            text: val.message || '',
            timestamp: new Date(),
          });
          console.log(`[Meta Webhook] facebook feed comment -> ${JSON.stringify(result)}`);
        }
      }
    }
  }

  if (Array.isArray(e.messaging)) {
    for (const msg of e.messaging) {
      const senderId = msg.sender?.id;
      if (!senderId || msg.message?.is_echo) continue; // our own sent messages echo back — not inbound

      if (msg.postback?.payload) {
        const result = await FlowEngine.processPostback({
          platform,
          accountExternalId: e.id,
          senderId,
          payload: msg.postback.payload,
          timestamp: new Date(msg.timestamp || Date.now()),
        });
        console.log(`[Meta Webhook] ${platform} postback "${msg.postback.payload}" -> ${JSON.stringify(result)}`);
        continue;
      }

      if (msg.message?.text || msg.message?.attachments) {
        const result = await FlowEngine.processMessage({
          platform,
          accountExternalId: e.id,
          externalMessageId: msg.message?.mid,
          senderId,
          text: msg.message?.text || '',
          attachments: (msg.message?.attachments || []).map((a: any) => ({ type: a.type, url: a.payload?.url })),
          referral: msg.referral || msg.message?.referral,
          timestamp: new Date(msg.timestamp || Date.now()),
        });
        console.log(`[Meta Webhook] ${platform} DM "${msg.message?.text}" from ${senderId} -> ${JSON.stringify(result)}`);
      }
    }
  }
}

/**
 * WhatsApp Cloud API's webhook payload is a different shape entirely —
 * everything nests under `changes[].value`, keyed by phone_number_id rather
 * than a per-account id, and delivery/read receipts arrive as `statuses`
 * rather than a message type.
 */
async function handleWhatsAppEntry(e: any) {
  for (const change of e.changes || []) {
    if (change.field !== 'messages') continue;
    const value = change.value;
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId) continue;

    for (const status of value.statuses || []) {
      const mapped = status.status === 'read' ? 'read' : status.status === 'delivered' ? 'delivered' : status.status === 'failed' ? 'failed' : 'sent';
      await models.Message.updateOne(
        { externalId: status.id },
        {
          $set: {
            status: mapped,
            ...(status.status === 'delivered' ? { deliveredAt: new Date(Number(status.timestamp) * 1000) } : {}),
            ...(status.status === 'read' ? { readAt: new Date(Number(status.timestamp) * 1000) } : {}),
          },
        },
      ).catch(() => undefined);
    }

    const nameByWaId = new Map<string, string>((value.contacts || []).map((c: any) => [c.wa_id, c.profile?.name]));
    const account = await models.SocialAccount.findOne({ phoneNumberId, platform: 'whatsapp' });

    for (const msg of value.messages || []) {
      const from = msg.from;
      const senderName = nameByWaId.get(from);

      if (msg.type === 'interactive' && (msg.interactive?.button_reply || msg.interactive?.list_reply)) {
        const reply = msg.interactive.button_reply || msg.interactive.list_reply;
        const result = await FlowEngine.processPostback({
          platform: 'whatsapp',
          accountExternalId: phoneNumberId,
          senderId: from,
          senderName,
          payload: reply.id,
          timestamp: new Date(Number(msg.timestamp) * 1000),
        });
        console.log(`[WhatsApp Webhook] interactive reply "${reply.id}" from ${from} -> ${JSON.stringify(result)}`);
        continue;
      }

      const text = msg.text?.body || msg.button?.text || (msg.type === 'location' ? '[location shared]' : '');
      if (!text) continue;

      const result = await FlowEngine.processMessage({
        platform: 'whatsapp',
        accountExternalId: phoneNumberId,
        externalMessageId: msg.id,
        senderId: from,
        senderName,
        text,
        // Meta attaches this when the conversation started from a Click-to-WhatsApp ad.
        referral: msg.referral,
        timestamp: new Date(Number(msg.timestamp) * 1000),
      });
      console.log(`[WhatsApp Webhook] message "${text}" from ${from} -> ${JSON.stringify(result)}`);

      if (account) {
        await WhatsAppService.markRead(phoneNumberId, msg.id, account.accessToken).catch(() => undefined);
      }
    }
  }
}

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
    const webhookObject = req.body?.object as string | undefined;
    await models.WebhookEvent.create({
      _id: eventId,
      platform: webhookObject === 'whatsapp_business_account' ? 'whatsapp' : webhookObject === 'page' ? 'facebook' : 'instagram',
      objectId: req.body?.entry?.[0]?.id ?? req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
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
    const object = req.body?.object as string | undefined;
    const { entry } = req.body;
    if (!Array.isArray(entry)) return;

    if (object === 'whatsapp_business_account') {
      for (const e of entry) await handleWhatsAppEntry(e);
    } else {
      // 'instagram' and 'page' (Facebook) share the same messaging/changes
      // envelope shape — only which SocialAccount field identifies the
      // account, and which trigger types apply, differ (handled inside
      // FlowEngine.resolveAccount / triggerAppliesTo).
      const platform: 'instagram' | 'facebook' = object === 'page' ? 'facebook' : 'instagram';
      for (const e of entry) await handleMetaEntry(e, platform);
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

/**
 * Register (or re-confirm) the app-level webhook subscription for a given
 * object type. This is the step that previously had to be done by hand with
 * a raw Graph API call — this endpoint does exactly that, from a button in
 * the product, for whichever channel you're turning on: 'instagram', 'page'
 * (Facebook Messenger + feed comments) or 'whatsapp_business_account'.
 */
router.post('/webhook/register', async (req, res) => {
  try {
    const object = req.body?.object as string;
    const validObjects = ['instagram', 'page', 'whatsapp_business_account'];
    if (!validObjects.includes(object)) {
      return res.status(400).json({ error: `object must be one of: ${validObjects.join(', ')}` });
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return res.status(400).json({ error: 'META_APP_ID / META_APP_SECRET are not configured' });

    const baseUrl = process.env.BASE_URL || 'https://bharatautomatebackend.onrender.com';
    const callbackUrl = `${baseUrl}/api/meta/webhook`;
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'dev-meta-webhook-verify-token-change-me';

    const defaultFields: Record<string, string> = {
      instagram: 'comments,live_comments,messages,messaging_postbacks,messaging_seen,message_reactions,messaging_referral,mentions',
      page: 'messages,messaging_postbacks,messaging_referrals,message_reactions,feed',
      whatsapp_business_account: 'messages',
    };
    const fields = req.body?.fields || defaultFields[object];

    const params = new URLSearchParams({
      object,
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields,
      access_token: `${appId}|${appSecret}`,
    });

    const response = await fetch(`https://graph.facebook.com/v21.0/${appId}/subscriptions`, {
      method: 'POST',
      body: params,
    });
    const data = (await response.json()) as { error?: { message?: string }; success?: boolean };

    if (!response.ok || data.error) {
      return res.status(502).json({ error: data.error?.message || 'Meta rejected the subscription request', data });
    }

    return res.json({ ok: true, object, callbackUrl, fields, data });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
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
