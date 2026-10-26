/**
 * Workspace settings (`/api/settings`), mounted behind `requireAuth`.
 *
 * - General: workspace name, timezone, default language and industry. Every
 *   member can read them; only the owner may change them (audited).
 * - Security: the signed-in user's own sessions (list, revoke one, sign out
 *   everywhere else).
 * - Platform: Meta webhook/app configuration is platform-level (env), not
 *   per-tenant, so it is visible only to `User.isSuperAdmin`. Normal owners
 *   never receive the verify token or any app secret; super admins get a
 *   masked token and must explicitly reveal it (audited).
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import * as models from '../models/index.js';
import { env } from '../config/env.js';
import { badRequest, forbidden, notFound, sendError, unauthorized } from '../lib/http.js';
import { maskSecret } from '../lib/crypto.js';
import { authOrgId } from '../lib/scope.js';
import { parseBody, parseParams } from '../lib/validate.js';
import { destroySession, destroyUserSessions, requireOwner, requireSessionAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { audit } from '../services/audit.js';
import { jobWorkerRunning } from '../services/jobs.js';
import { AI_MODELS, isAiConfigured } from '../services/ai/client.js';

const router = Router();

/** Languages the AI features can write in; stored on `Organization.locale`. */
export const WORKSPACE_LOCALES = ['en', 'hi', 'hi-Latn', 'ta', 'te', 'mr', 'bn', 'kn', 'ml', 'gu', 'pa'] as const;

/** Meta webhook fields the app must subscribe to (shown to super admins). */
const META_WEBHOOK_FIELDS = {
  instagram: ['messages', 'messaging_postbacks', 'messaging_referral', 'message_reactions', 'comments', 'mentions', 'story_insights'],
  page: ['messages', 'messaging_postbacks', 'messaging_referrals', 'message_reactions', 'feed'],
  whatsapp_business_account: ['messages', 'message_template_status_update'],
};

const revealLimit = rateLimit({ name: 'settings-platform-reveal', windowMs: 60_000, max: 5 });

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const updateBody = z
  .object({
    name: z.string().trim().min(1, 'Workspace name is required').max(80),
    timezone: z.string().trim().max(64).refine(isValidTimezone, 'Unknown timezone'),
    locale: z.enum(WORKSPACE_LOCALES),
    industry: z.union([z.string().trim().max(60), z.null()]),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

const sessionParams = z.object({ id: z.string().min(1).max(100) });

function requireUserId(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw unauthorized();
  return userId;
}

async function isSuperAdmin(userId: string): Promise<boolean> {
  const user = await models.User.findById(userId, { isSuperAdmin: 1 }).lean();
  return Boolean(user?.isSuperAdmin);
}

async function assertSuperAdmin(req: Request): Promise<void> {
  if (!(await isSuperAdmin(requireUserId(req)))) throw forbidden('Only platform administrators can see this', 'SUPER_ADMIN_ONLY');
}

/** Platform-level Meta/AI/billing configuration (super admins only). Secrets are never returned. */
function platformInfo() {
  const verifyToken = env.META_WEBHOOK_VERIFY_TOKEN;
  return {
    webhookCallbackUrl: `${env.BASE_URL}/api/meta/webhook`,
    oauthRedirectUri: env.META_REDIRECT_URI || `${env.BASE_URL}/api/meta/oauth/callback`,
    verifyTokenConfigured: Boolean(verifyToken),
    verifyTokenMasked: verifyToken ? maskSecret(verifyToken) : null,
    metaAppId: env.META_APP_ID || null,
    metaAppSecretConfigured: Boolean(env.META_APP_SECRET),
    instagramAppId: env.INSTAGRAM_APP_ID || null,
    instagramAppSecretConfigured: Boolean(env.INSTAGRAM_APP_SECRET),
    webhookFields: META_WEBHOOK_FIELDS,
    aiConfigured: isAiConfigured(),
    aiModels: { default: AI_MODELS.default, fast: AI_MODELS.fast },
    billingMode: env.BILLING_MODE,
    jobsRunning: jobWorkerRunning(),
    frontendUrl: env.FRONTEND_URL,
    apiBaseUrl: `${env.BASE_URL}/api`,
  };
}

function workspaceView(org: models.IOrganization) {
  return {
    id: org._id,
    name: org.name,
    slug: org.slug,
    timezone: org.timezone ?? 'UTC',
    locale: org.locale ?? 'en',
    industry: org.industry ?? null,
    ownerId: org.ownerId ?? null,
    createdAt: org.createdAt,
  };
}

// Get workspace settings (+ platform section for super admins)
router.get('/', requireSessionAuth, async (req, res) => {
  try {
    const orgId = authOrgId(req);
    const userId = requireUserId(req);
    const [org, superAdmin] = await Promise.all([models.Organization.findById(orgId).lean(), isSuperAdmin(userId)]);
    if (!org) throw notFound('Workspace not found');
    return res.json({
      ok: true,
      settings: {
        workspace: workspaceView(org),
        locales: WORKSPACE_LOCALES,
        canEdit: req.auth?.role === 'owner',
        isSuperAdmin: superAdmin,
        platform: superAdmin ? platformInfo() : null,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// Update workspace profile (owner only)
router.put('/', requireOwner, async (req, res) => {
  try {
    const orgId = authOrgId(req);
    const body = parseBody(updateBody, req.body);
    const before = await models.Organization.findById(orgId).lean();
    if (!before) throw notFound('Workspace not found');

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.timezone !== undefined) set.timezone = body.timezone;
    if (body.locale !== undefined) set.locale = body.locale;
    if (body.industry !== undefined) {
      if (body.industry === null || body.industry === '') unset.industry = 1;
      else set.industry = body.industry;
    }

    const org = await models.Organization.findOneAndUpdate(
      { _id: orgId },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!org) throw notFound('Workspace not found');

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of ['name', 'timezone', 'locale', 'industry'] as const) {
      const from = before[key] ?? null;
      const to = org[key] ?? null;
      if (from !== to) changes[key] = { from, to };
    }
    if (Object.keys(changes).length > 0) audit(req, 'workspace.updated', { type: 'workspace', id: orgId }, { changes });

    return res.json({ ok: true, workspace: workspaceView(org) });
  } catch (error) {
    return sendError(res, error);
  }
});

// Reveal the full Meta webhook verify token (super admins only; audited)
router.post('/platform/reveal-verify-token', requireSessionAuth, revealLimit, async (req, res) => {
  try {
    await assertSuperAdmin(req);
    const token = env.META_WEBHOOK_VERIFY_TOKEN;
    if (!token) throw badRequest('META_WEBHOOK_VERIFY_TOKEN is not configured on the server');
    audit(req, 'platform.verify_token_revealed', { type: 'platform' });
    return res.json({ ok: true, verifyToken: token });
  } catch (error) {
    return sendError(res, error);
  }
});

// List the signed-in user's active sessions
router.get('/sessions', requireSessionAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const sessions = await models.Session.find({ userId, expiresAt: { $gt: new Date() } }, { token: 0 })
      .sort({ lastSeenAt: -1, createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({
      ok: true,
      sessions: sessions.map((session) => ({
        id: session._id,
        userAgent: session.userAgent ?? null,
        ip: session.ip ?? null,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt ?? session.createdAt,
        expiresAt: session.expiresAt,
        current: session._id === req.auth?.sessionId,
      })),
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// Sign out every other session of the signed-in user
router.post('/sessions/revoke-others', requireSessionAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const sessionId = req.auth?.sessionId;
    if (!sessionId) throw unauthorized();
    const revoked = await destroyUserSessions(userId, sessionId);
    audit(req, 'auth.sessions_revoked', { type: 'user', id: userId }, { revoked });
    return res.json({ ok: true, revoked });
  } catch (error) {
    return sendError(res, error);
  }
});

// Sign out one session of the signed-in user (the current one logs this browser out)
router.delete('/sessions/:id', requireSessionAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const { id } = parseParams(sessionParams, req.params);
    if (id === req.auth?.sessionId) {
      await destroySession(req, res);
      audit(req, 'auth.session_revoked', { type: 'session', id }, { current: true });
      return res.json({ ok: true, current: true });
    }
    const result = await models.Session.deleteOne({ _id: id, userId });
    if (result.deletedCount === 0) throw notFound('Session not found');
    audit(req, 'auth.session_revoked', { type: 'session', id });
    return res.json({ ok: true, current: false });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
