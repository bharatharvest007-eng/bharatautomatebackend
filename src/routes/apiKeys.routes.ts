/**
 * API keys (`/api/api-keys`), mounted behind `requireAuth, requireSessionAuth`.
 *
 * Keys authenticate the public REST API (`/api/v1`) and, scope-limited, the
 * private API. A key is `sk_live_` + 32 random bytes (base64url); only its
 * sha256 is stored, so the full key is returned exactly once at creation.
 * `prefix` keeps a recognizable hint (`sk_live_AbCd…wxyz`) for the list.
 * Creating keys needs the `api_access` feature (Business and above); revoked
 * keys stop working immediately because auth checks `revokedAt` per request.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import * as models from '../models/index.js';
import type { IApiKey } from '../models/index.js';
import { conflict, notFound, sendError, unauthorized } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { newId } from '../lib/ids.js';
import { authOrgId } from '../lib/scope.js';
import { parseBody, parseParams } from '../lib/validate.js';
import { requireOwner } from '../middleware/auth.js';
import { assertFeature, getEntitlements } from '../services/entitlements.js';
import { getUsage } from '../services/usage.js';
import { audit } from '../services/audit.js';

const router = Router();

const KEY_PREFIX = 'sk_live_';
const MAX_ACTIVE_KEYS = 20;

const scopesSchema = z
  .array(z.enum(['read', 'write']))
  .min(1, 'Choose at least one scope')
  .transform((scopes) => (scopes.includes('write') ? ['read', 'write'] : ['read']));

const createBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  scopes: scopesSchema.default(['read']),
});

const updateBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
});

const idParams = z.object({ id: z.string().min(1).max(100) });

function requireUserId(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw unauthorized();
  return userId;
}

function keyView(key: IApiKey, creators: Map<string, string>) {
  return {
    id: key._id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes ?? [],
    createdBy: key.createdBy ?? null,
    createdByName: key.createdBy ? (creators.get(key.createdBy) ?? null) : null,
    lastUsedAt: key.lastUsedAt ?? null,
    revokedAt: key.revokedAt ?? null,
    createdAt: key.createdAt,
  };
}

// List API keys (active first) with this month's API usage
router.get('/', async (req, res) => {
  try {
    const orgId = authOrgId(req);
    const [keys, entitlements, used] = await Promise.all([
      models.ApiKey.find({ orgId }).sort({ revokedAt: 1, createdAt: -1 }).limit(100).lean(),
      getEntitlements(orgId),
      getUsage(orgId, 'api_calls'),
    ]);
    const creatorIds = [...new Set(keys.map((key) => key.createdBy).filter((id): id is string => Boolean(id)))];
    const creators = new Map<string, string>();
    if (creatorIds.length > 0) {
      const users = await models.User.find({ _id: { $in: creatorIds } }, { name: 1, email: 1 }).lean();
      for (const user of users) creators.set(user._id, user.name || user.email);
    }
    const active = keys.filter((key) => !key.revokedAt);
    const revoked = keys.filter((key) => key.revokedAt);
    return res.json({
      ok: true,
      keys: [...active, ...revoked].map((key) => keyView(key, creators)),
      usage: { apiCalls: used, limit: entitlements.limits.api_calls },
      enabled: entitlements.features.api_access === true,
      maxActiveKeys: MAX_ACTIVE_KEYS,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// Create an API key (owner only); the full key is returned once
router.post('/', requireOwner, async (req, res) => {
  try {
    const orgId = authOrgId(req);
    const userId = requireUserId(req);
    const body = parseBody(createBody, req.body);
    await assertFeature(orgId, 'api_access');

    const activeCount = await models.ApiKey.countDocuments({ orgId, revokedAt: { $exists: false } });
    if (activeCount >= MAX_ACTIVE_KEYS) {
      throw conflict(`You can have at most ${MAX_ACTIVE_KEYS} active API keys. Revoke an unused key first.`, 'KEY_LIMIT');
    }

    const secret = `${KEY_PREFIX}${randomToken(32)}`;
    const prefix = `${secret.slice(0, KEY_PREFIX.length + 4)}…${secret.slice(-4)}`;
    const key = await models.ApiKey.create({
      _id: newId('key'),
      orgId,
      name: body.name,
      prefix,
      hash: sha256(secret),
      scopes: body.scopes,
      createdBy: userId,
    });

    audit(req, 'api_key.created', { type: 'api_key', id: key._id }, { name: body.name, scopes: body.scopes, prefix });
    const creators = new Map([[userId, req.auth?.name || req.auth?.email || '']]);
    return res.status(201).json({ ok: true, key: keyView(key.toObject(), creators), secret });
  } catch (error) {
    return sendError(res, error);
  }
});

// Rename an API key (owner only)
router.patch('/:id', requireOwner, async (req, res) => {
  try {
    const orgId = authOrgId(req);
    const { id } = parseParams(idParams, req.params);
    const body = parseBody(updateBody, req.body);
    const key = await models.ApiKey.findOneAndUpdate(
      { _id: id, orgId },
      { $set: { name: body.name } },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!key) throw notFound('API key not found');
    audit(req, 'api_key.renamed', { type: 'api_key', id }, { name: body.name });
    return res.json({ ok: true, key: keyView(key, new Map()) });
  } catch (error) {
    return sendError(res, error);
  }
});

// Revoke an API key (owner only); takes effect immediately
router.delete('/:id', requireOwner, async (req, res) => {
  try {
    const orgId = authOrgId(req);
    const { id } = parseParams(idParams, req.params);
    const key = await models.ApiKey.findOneAndUpdate(
      { _id: id, orgId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean();
    if (!key) {
      const exists = await models.ApiKey.exists({ _id: id, orgId });
      throw exists ? conflict('This key is already revoked', 'ALREADY_REVOKED') : notFound('API key not found');
    }
    audit(req, 'api_key.revoked', { type: 'api_key', id }, { name: key.name, prefix: key.prefix });
    return res.json({ ok: true, key: keyView(key, new Map()) });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
