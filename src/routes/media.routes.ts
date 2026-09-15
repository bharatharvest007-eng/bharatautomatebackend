import { Router } from 'express';
import axios from 'axios';
import * as models from '../models/index.js';

/**
 * Posts & Reels.
 *
 * Instagram is the source of truth for content, so we mirror it into IgMedia
 * rather than trying to keep our own copy authoritative. The mirror exists so
 * the dashboard can attach automations to a specific post and still render a
 * grid instantly without hitting the Graph API on every page load.
 */

const router = Router();
const IG_BASE = 'https://graph.instagram.com/v21.0';
const FB_BASE = 'https://graph.facebook.com/v21.0';

const graphBase = (token?: string) => (token?.startsWith('IG') ? IG_BASE : FB_BASE);

const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

async function resolveAccount(accountId?: string) {
  if (accountId) {
    const byId = await models.SocialAccount.findById(accountId);
    if (byId) return byId;
    const byIg = await models.SocialAccount.findOne({ igUserId: String(accountId) });
    if (byIg) return byIg;
  }
  return models.SocialAccount.findOne({ status: 'active' }) ?? models.SocialAccount.findOne();
}

/**
 * Pull the account's posts from Instagram into IgMedia.
 * Safe to call repeatedly — it upserts and never deletes local setup state.
 */
router.post('/sync', async (req, res) => {
  try {
    const account = await resolveAccount(req.body?.accountId);
    if (!account) return res.status(400).json({ error: 'No Instagram account connected' });
    if (!account.igUserId) {
      return res.status(400).json({
        error: 'This account is missing its Instagram user id. Reconnect the account to repair it.',
      });
    }

    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';

    const response = await axios.get(`${graphBase(account.accessToken)}/${account.igUserId}/media`, {
      params: { fields: MEDIA_FIELDS, access_token: account.accessToken, limit: 50 },
    });

    const items: any[] = response.data?.data ?? [];
    let created = 0;
    let updated = 0;

    for (const m of items) {
      const existing = await models.IgMedia.findOne({ accountId: account._id, mediaId: m.id });

      await models.IgMedia.findOneAndUpdate(
        { accountId: account._id, mediaId: m.id },
        {
          $set: {
            orgId,
            accountId: account._id,
            mediaId: m.id,
            mediaType: m.media_type,
            mediaProductType: m.media_product_type,
            caption: m.caption,
            permalink: m.permalink,
            mediaUrl: m.media_url,
            thumbnailUrl: m.thumbnail_url || m.media_url,
            timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
            likeCount: m.like_count ?? 0,
            commentCount: m.comments_count ?? 0,
            lastSyncedAt: new Date(),
          },
          $setOnInsert: {
            _id: `med_${m.id}`,
            discoveredVia: 'sync',
            setupState: 'ready',
          },
        },
        { upsert: true },
      );

      if (existing) updated += 1;
      else created += 1;
    }

    await models.SocialAccount.updateOne(
      { _id: account._id },
      { $set: { lastSyncAt: new Date(), mediaCount: items.length } },
    );

    return res.json({
      ok: true,
      synced: items.length,
      created,
      updated,
      account: { id: account._id, username: account.username },
    });
  } catch (error: any) {
    const metaError = error.response?.data?.error;
    console.error('[Media Sync] failed:', metaError || error.message);
    return res.status(500).json({ error: metaError?.message || error.message });
  }
});

/** List mirrored posts, each annotated with the automations attached to it. */
router.get('/', async (req, res) => {
  try {
    const account = await resolveAccount(req.query.accountId as string | undefined);
    if (!account) return res.json({ ok: true, media: [], account: null });

    const media = await models.IgMedia.find({ accountId: account._id })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    // An automation targets a post when its mediaIds contains that id; an
    // automation with an empty mediaIds list applies to every post.
    const automations = await models.Automation.find({ accountId: account._id }).lean();

    const globalAutomations = automations.filter((a: any) => !a.mediaIds?.length);

    const withTriggers = media.map((m: any) => {
      const specific = automations.filter((a: any) => a.mediaIds?.includes(m.mediaId));
      return {
        ...m,
        automations: [...specific, ...globalAutomations].map((a: any) => ({
          id: a._id,
          name: a.name,
          status: a.status,
          keywords: a.trigger?.keywords ?? a.keywords ?? [],
          scope: a.mediaIds?.includes(m.mediaId) ? 'this_post' : 'all_posts',
        })),
        triggerCount: specific.length + globalAutomations.length,
      };
    });

    return res.json({
      ok: true,
      account: { id: account._id, username: account.username, lastSyncAt: account.lastSyncAt },
      media: withTriggers,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/** Comments on one post — used by the per-post detail view and by Rewind. */
router.get('/:mediaId/comments', async (req, res) => {
  try {
    const account = await resolveAccount(req.query.accountId as string | undefined);
    if (!account) return res.status(400).json({ error: 'No Instagram account connected' });

    const response = await axios.get(
      `${graphBase(account.accessToken)}/${req.params.mediaId}/comments`,
      {
        params: {
          fields: 'id,text,username,timestamp,like_count,parent_id',
          access_token: account.accessToken,
          limit: 50,
        },
      },
    );

    return res.json({ ok: true, comments: response.data?.data ?? [] });
  } catch (error: any) {
    const metaError = error.response?.data?.error;
    return res.status(500).json({ error: metaError?.message || error.message });
  }
});

/** Attach an automation to this specific post. */
router.post('/:mediaId/attach', async (req, res) => {
  try {
    const { automationId } = req.body;
    if (!automationId) return res.status(400).json({ error: 'automationId is required' });

    const automation = await models.Automation.findById(automationId);
    if (!automation) return res.status(404).json({ error: 'Automation not found' });

    await models.Automation.updateOne(
      { _id: automationId },
      { $addToSet: { mediaIds: req.params.mediaId } },
    );
    await models.IgMedia.updateOne(
      { mediaId: req.params.mediaId },
      { $set: { setupState: 'active' } },
    );

    return res.json({ ok: true, mediaId: req.params.mediaId, automationId });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/** Detach an automation from this post. */
router.post('/:mediaId/detach', async (req, res) => {
  try {
    const { automationId } = req.body;
    await models.Automation.updateOne(
      { _id: automationId },
      { $pull: { mediaIds: req.params.mediaId } },
    );

    const stillAttached = await models.Automation.countDocuments({ mediaIds: req.params.mediaId });
    if (stillAttached === 0) {
      await models.IgMedia.updateOne(
        { mediaId: req.params.mediaId },
        { $set: { setupState: 'ready' } },
      );
    }

    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Create a comment-to-DM automation bound to one post, in a single call.
 * This is the flow the Posts board uses: pick a post, type a keyword and the
 * reply, done — no separate trip to the automation builder.
 */
router.post('/:mediaId/quick-trigger', async (req, res) => {
  try {
    const { keyword, dmText, commentReply, name } = req.body;
    if (!keyword || !dmText) {
      return res.status(400).json({ error: 'keyword and dmText are required' });
    }

    const account = await resolveAccount(req.body?.accountId);
    if (!account) return res.status(400).json({ error: 'No Instagram account connected' });

    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';
    const media = await models.IgMedia.findOne({ mediaId: req.params.mediaId });

    const keywords = String(keyword)
      .split(',')
      .map((k: string) => k.trim())
      .filter(Boolean);

    const nodes: any[] = [];
    if (commentReply) nodes.push({ type: 'comment_reply', variants: [commentReply] });
    nodes.push({ type: 'send_dm', text: dmText });

    const automation = await models.Automation.create({
      _id: `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      orgId,
      accountId: account._id,
      name: name || `${keywords[0]} → DM`,
      type: 'comment',
      status: 'live',
      trigger: { type: 'comment', keywords, matchMode: 'contains' },
      keywords,
      // Scoping to this one post is what makes it a per-post trigger.
      mediaIds: [req.params.mediaId],
      flow: { version: 1, entry: 'start', nodes },
    });

    if (media) {
      await models.IgMedia.updateOne({ _id: media._id }, { $set: { setupState: 'active' } });
    }

    return res.json({ ok: true, automation });
  } catch (error: any) {
    console.error('[Media QuickTrigger] failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/** Hide a post from the setup board without deleting anything. */
router.post('/:mediaId/skip', async (req, res) => {
  try {
    await models.IgMedia.updateOne(
      { mediaId: req.params.mediaId },
      { $set: { setupState: req.body?.undo ? 'ready' : 'skipped' } },
    );
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
