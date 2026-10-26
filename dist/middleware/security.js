import { env } from '../config/env.js';
import { sendError, tooManyRequests } from '../lib/http.js';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With';
const PREFLIGHT_MAX_AGE_SECONDS = '600';
/** Paths whose responses may be embedded in third-party pages. */
const FRAMEABLE_PREFIXES = ['/api/widget', '/api/bio/p/'];
export const securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!FRAMEABLE_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
        res.setHeader('X-Frame-Options', 'DENY');
    }
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (env.isProd) {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
};
function normalizeOrigin(origin) {
    return origin.trim().replace(/\/+$/, '').toLowerCase();
}
/** Dashboard origins allowed to make credentialed requests (re-read from env so changes apply without code edits). */
export function allowedOrigins() {
    return new Set([env.FRONTEND_URL, ...env.CORS_ORIGINS, 'http://localhost:3000', 'http://127.0.0.1:3000']
        .filter(Boolean)
        .map(normalizeOrigin));
}
export function isAllowedOrigin(origin) {
    return allowedOrigins().has(normalizeOrigin(origin));
}
/**
 * Credentialed CORS for the dashboard. Unknown origins get no CORS headers, so
 * browsers block them; non-browser clients (no Origin header) are unaffected.
 */
export const corsAllowlist = (req, res, next) => {
    const origin = req.headers.origin;
    // A public CORS policy already applied (widget / public API) takes precedence.
    if (!origin || res.getHeader('Access-Control-Allow-Origin'))
        return next();
    res.append('Vary', 'Origin');
    if (!isAllowedOrigin(origin)) {
        if (req.method === 'OPTIONS')
            return res.status(204).end();
        return next();
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
        res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
        res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
        return res.status(204).end();
    }
    return next();
};
/** Open CORS without credentials, for the embeddable widget and the API-key REST API. */
export const publicCors = (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
        res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
        res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
        return res.status(204).end();
    }
    return next();
};
const limiterStores = new Map();
const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const store of limiterStores.values()) {
        for (const [key, bucket] of store) {
            if (bucket.resetAt <= now)
                store.delete(key);
        }
    }
}, 60_000);
sweepTimer.unref();
export function clientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}
/**
 * Fixed-window, in-memory limiter. Good enough for a single process; counters
 * reset on restart and are not shared between replicas.
 */
export function rateLimit(options) {
    const { name, windowMs, max } = options;
    const keyOf = options.key ?? clientIp;
    let store = limiterStores.get(name);
    if (!store) {
        store = new Map();
        limiterStores.set(name, store);
    }
    const buckets = store;
    return (req, res, next) => {
        const now = Date.now();
        const key = keyOf(req) || 'unknown';
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;
        const remaining = Math.max(0, max - bucket.count);
        const resetSeconds = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(remaining));
        res.setHeader('RateLimit-Reset', String(resetSeconds));
        if (bucket.count > max) {
            res.setHeader('Retry-After', String(resetSeconds));
            const error = tooManyRequests(options.message);
            error.details = { retryAfter: resetSeconds };
            return sendError(res, error);
        }
        return next();
    };
}
