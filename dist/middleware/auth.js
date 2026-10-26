import { env } from '../config/env.js';
import * as models from '../models/index.js';
import { forbidden, sendError, unauthorized } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { newId } from '../lib/ids.js';
import { isAllowedOrigin } from './security.js';
export const SESSION_COOKIE = 'sma_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const API_KEY_PREFIX = 'sk_';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const API_KEY_TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_TRACKED_SESSIONS = 10_000;
/** Legacy stored roles: 'admin' → owner, 'viewer' → member. */
export function normalizeRole(role) {
    return role === 'owner' || role === 'admin' ? 'owner' : 'member';
}
/**
 * CSRF guard for cookie credentials. Browsers attach the session cookie to
 * cross-site form posts when COOKIE_SAMESITE=none (split-domain deployments),
 * so a state-changing request authenticated only by the cookie must come from
 * an allowlisted Origin. Bearer tokens are not sent automatically and need no check.
 */
function cookieUsableFor(req) {
    if (SAFE_METHODS.has(req.method))
        return true;
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin === '' || origin === 'null') {
        // No Origin: a non-browser client (it had to obtain the cookie deliberately). 'null' origins come from sandboxed/opaque contexts.
        return origin !== 'null';
    }
    return isAllowedOrigin(origin);
}
/** Bearer token from the Authorization header, falling back to the session cookie. */
export function extractToken(req) {
    const header = req.headers.authorization;
    if (typeof header === 'string') {
        const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
        if (match)
            return match[1];
    }
    if (!cookieUsableFor(req))
        return null;
    const cookies = req.cookies;
    const cookieToken = cookies?.[SESSION_COOKIE];
    return typeof cookieToken === 'string' && cookieToken.length > 0 ? cookieToken : null;
}
function bearerToken(req) {
    const header = req.headers.authorization;
    if (typeof header !== 'string')
        return null;
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
    return match ? match[1] : null;
}
export function hasScope(auth, scope) {
    if (auth.via !== 'api_key')
        return true;
    const scopes = auth.scopes ?? [];
    return scopes.includes(scope) || (scope === 'read' && scopes.includes('write'));
}
// --- Activity tracking (throttled, fire-and-forget) ----------------------------
const sessionTouchedAt = new Map();
function touchSession(sessionId, userId) {
    const now = Date.now();
    const last = sessionTouchedAt.get(sessionId);
    if (last !== undefined && now - last < SESSION_TOUCH_INTERVAL_MS)
        return;
    if (sessionTouchedAt.size >= MAX_TRACKED_SESSIONS)
        sessionTouchedAt.clear();
    sessionTouchedAt.set(sessionId, now);
    const at = new Date(now);
    Promise.all([
        models.Session.updateOne({ _id: sessionId }, { $set: { lastSeenAt: at } }),
        models.User.updateOne({ _id: userId }, { $set: { lastSeenAt: at } }),
    ]).catch((error) => {
        console.error('[Auth] Failed to record session activity:', error instanceof Error ? error.message : error);
    });
}
function touchApiKey(apiKeyId, lastUsedAt) {
    const now = Date.now();
    if (lastUsedAt && now - new Date(lastUsedAt).getTime() < API_KEY_TOUCH_INTERVAL_MS)
        return;
    models.ApiKey.updateOne({ _id: apiKeyId }, { $set: { lastUsedAt: new Date(now) } }).catch((error) => {
        console.error('[Auth] Failed to record API key usage:', error instanceof Error ? error.message : error);
    });
}
let apiKeyGuard = null;
/**
 * Lets a higher layer veto API-key requests (e.g. the entitlements service
 * rejecting keys of a workspace whose plan lost `api_access`) without this
 * module importing it. The guard throws an HttpError to reject.
 */
export function setApiKeyGuard(guard) {
    apiKeyGuard = guard;
}
async function authenticateSessionToken(token) {
    const session = await models.Session.findOne({ token: sha256(token), expiresAt: { $gt: new Date() } }).lean();
    if (!session)
        return null;
    const user = await models.User.findById(session.userId).lean();
    if (!user)
        return null;
    const memberships = user.memberships ?? [];
    const membership = session.orgId ? memberships.find((m) => m.orgId === session.orgId) : memberships[0];
    // The user was removed from the workspace this session was issued for.
    if (!membership)
        return null;
    touchSession(session._id, user._id);
    return {
        userId: user._id,
        orgId: membership.orgId,
        role: normalizeRole(membership.role),
        via: 'session',
        sessionId: session._id,
        email: user.email,
        name: user.name,
    };
}
async function authenticateApiKeyToken(token, req) {
    const key = await models.ApiKey.findOne({ hash: sha256(token) }).lean();
    if (!key || key.revokedAt)
        return null;
    touchApiKey(key._id, key.lastUsedAt);
    const auth = {
        userId: key.createdBy ?? `apikey:${key._id}`,
        orgId: key.orgId,
        role: 'member',
        via: 'api_key',
        apiKeyId: key._id,
        scopes: key.scopes ?? [],
        email: '',
        name: key.name,
    };
    if (apiKeyGuard)
        await apiKeyGuard(auth, req);
    return auth;
}
/** Resolves the request's credentials to an AuthContext, or null when absent/invalid. */
export async function authenticateRequest(req) {
    const token = extractToken(req);
    if (!token)
        return null;
    return token.startsWith(API_KEY_PREFIX) ? authenticateApiKeyToken(token, req) : authenticateSessionToken(token);
}
async function ensureAuth(req) {
    if (req.auth)
        return req.auth;
    const auth = await authenticateRequest(req);
    if (auth)
        req.auth = auth;
    return auth;
}
function scopeError(scope) {
    return forbidden(`This API key does not have the '${scope}' scope`, 'INSUFFICIENT_SCOPE');
}
// --- Middleware ----------------------------------------------------------------
/** 401 unless a valid session or API key is presented. API keys are scope-checked by HTTP method. */
export const requireAuth = async (req, res, next) => {
    try {
        const auth = await ensureAuth(req);
        if (!auth)
            return sendError(res, unauthorized());
        if (auth.via === 'api_key') {
            const needed = SAFE_METHODS.has(req.method) ? 'read' : 'write';
            if (!hasScope(auth, needed))
                return sendError(res, scopeError(needed));
        }
        return next();
    }
    catch (error) {
        return sendError(res, error);
    }
};
/** Sets `req.auth` when valid credentials are present; never rejects. */
export const optionalAuth = async (req, _res, next) => {
    try {
        await ensureAuth(req);
    }
    catch (error) {
        console.error('[Auth] optionalAuth failed:', error instanceof Error ? error.message : error);
    }
    return next();
};
/** Only the workspace owner (session or API key holders are never owners). */
export const requireOwner = async (req, res, next) => {
    try {
        const auth = await ensureAuth(req);
        if (!auth)
            return sendError(res, unauthorized());
        if (auth.role !== 'owner' || auth.via !== 'session') {
            return sendError(res, forbidden('Only the workspace owner can do this', 'OWNER_ONLY'));
        }
        return next();
    }
    catch (error) {
        return sendError(res, error);
    }
};
/**
 * Platform operator only: a signed-in user with `isSuperAdmin` (set by
 * `npm run db:init`). For settings that affect every workspace at once — the
 * Meta app's webhook subscription and the raw webhook log. A workspace owner
 * is not enough: anyone who signs up owns their own workspace.
 */
export const requirePlatformAdmin = async (req, res, next) => {
    try {
        const auth = await ensureAuth(req);
        if (!auth)
            return sendError(res, unauthorized());
        if (auth.via !== 'session')
            return sendError(res, forbidden('This needs a signed-in platform admin', 'PLATFORM_ADMIN_ONLY'));
        const user = await models.User.findById(auth.userId).select('isSuperAdmin').lean();
        if (!user?.isSuperAdmin)
            return sendError(res, forbidden('Only the platform admin can do this', 'PLATFORM_ADMIN_ONLY'));
        return next();
    }
    catch (error) {
        return sendError(res, error);
    }
};
/** Rejects API-key credentials (team management, key management, billing…). */
export const requireSessionAuth = async (req, res, next) => {
    try {
        const auth = await ensureAuth(req);
        if (!auth)
            return sendError(res, unauthorized());
        if (auth.via !== 'session') {
            return sendError(res, forbidden('This endpoint requires a signed-in user; API keys are not accepted', 'SESSION_REQUIRED'));
        }
        return next();
    }
    catch (error) {
        return sendError(res, error);
    }
};
/**
 * Public REST API guard: requires an `sk_` key in the Authorization header.
 * Without an explicit scope the HTTP method decides ('read' for safe methods).
 */
export function requireApiKey(scope) {
    return async (req, res, next) => {
        try {
            let auth = req.auth?.via === 'api_key' ? req.auth : null;
            if (!auth) {
                const token = bearerToken(req);
                if (!token)
                    return sendError(res, unauthorized('Missing API key. Send "Authorization: Bearer sk_..."'));
                if (!token.startsWith(API_KEY_PREFIX))
                    return sendError(res, unauthorized('A valid API key (sk_...) is required'));
                auth = await authenticateApiKeyToken(token, req);
                if (!auth)
                    return sendError(res, unauthorized('Invalid or revoked API key'));
                req.auth = auth;
            }
            const needed = scope ?? (SAFE_METHODS.has(req.method) ? 'read' : 'write');
            if (!hasScope(auth, needed))
                return sendError(res, scopeError(needed));
            return next();
        }
        catch (error) {
            return sendError(res, error);
        }
    };
}
// --- Session lifecycle -----------------------------------------------------------
export function sessionCookieOptions() {
    const sameSite = env.COOKIE_SAMESITE;
    return {
        httpOnly: true,
        sameSite,
        secure: sameSite === 'none' ? true : env.COOKIE_SECURE,
        path: '/',
        maxAge: SESSION_TTL_MS,
    };
}
/** Creates a session, sets the `sma_session` cookie and returns the raw token (for Bearer use). */
export async function issueSession(res, req, userId, orgId) {
    const token = randomToken(32);
    const now = Date.now();
    await models.Session.create({
        _id: newId('ses'),
        userId,
        orgId,
        token: sha256(token),
        userAgent: req.get('user-agent')?.slice(0, 300),
        ip: req.ip,
        expiresAt: new Date(now + SESSION_TTL_MS),
        lastSeenAt: new Date(now),
    });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return token;
}
/** Deletes the current session (if any) and clears the cookie. */
export async function destroySession(req, res) {
    const token = extractToken(req);
    if (req.auth?.sessionId) {
        sessionTouchedAt.delete(req.auth.sessionId);
        await models.Session.deleteOne({ _id: req.auth.sessionId });
    }
    else if (token && !token.startsWith(API_KEY_PREFIX)) {
        await models.Session.deleteOne({ token: sha256(token) });
    }
    // `maxAge` must not be passed to clearCookie: Express 4 lets it override the expiry and the cookie survives.
    const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions();
    res.clearCookie(SESSION_COOKIE, clearOptions);
}
/** Deletes all sessions of a user (e.g. after a password change or removal), optionally keeping one. */
export async function destroyUserSessions(userId, exceptSessionId) {
    const filter = exceptSessionId ? { userId, _id: { $ne: exceptSessionId } } : { userId };
    const result = await models.Session.deleteMany(filter);
    return result.deletedCount ?? 0;
}
