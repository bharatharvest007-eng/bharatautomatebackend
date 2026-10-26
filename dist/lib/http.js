import { env } from '../config/env.js';
export class HttpError extends Error {
    status;
    code;
    details;
    constructor(status, message, code, details) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
export function isHttpError(error) {
    return error instanceof HttpError;
}
export const badRequest = (message, details) => new HttpError(400, message, 'BAD_REQUEST', details);
export const unauthorized = (message = 'Not authenticated') => new HttpError(401, message, 'UNAUTHENTICATED');
export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') => new HttpError(403, message, code);
export const notFound = (message = 'Not found') => new HttpError(404, message, 'NOT_FOUND');
export const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
export const paymentRequired = (message, code, details) => new HttpError(402, message, code, details);
export const tooManyRequests = (message = 'Too many requests') => new HttpError(429, message, 'RATE_LIMITED');
export const serviceUnavailable = (message, code = 'UNAVAILABLE') => new HttpError(503, message, code);
/** Duck-typed so errors from both `zod` (v3 API) and `zod/v4` (used by the AI SDK helpers) are recognized. */
function isZodError(error) {
    return (error instanceof Error &&
        error.name === 'ZodError' &&
        Array.isArray(error.issues));
}
export function formatZodIssues(issues) {
    return issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        message: issue.message,
    }));
}
function errorField(error, field) {
    if (error && typeof error === 'object' && field in error) {
        return error[field];
    }
    return undefined;
}
/** Writes the standard error response for any thrown value. */
export function sendError(res, error) {
    if (res.headersSent) {
        console.error('[API Error] Error after response was sent:', error instanceof Error ? error.message : error);
        return res;
    }
    if (error instanceof HttpError) {
        return res.status(error.status).json({ ...(error.details ?? {}), error: error.message, ...(error.code ? { code: error.code } : {}) });
    }
    if (isZodError(error)) {
        return res.status(400).json({ error: 'Validation failed', code: 'VALIDATION', issues: formatZodIssues(error.issues) });
    }
    const name = errorField(error, 'name');
    const mongoCode = errorField(error, 'code');
    if (mongoCode === 11000 || mongoCode === 11001) {
        return res.status(409).json({ error: 'Already exists', code: 'DUPLICATE' });
    }
    if (name === 'CastError') {
        return res.status(400).json({ error: 'Invalid identifier or value', code: 'BAD_REQUEST' });
    }
    if (name === 'ValidationError') {
        const fieldErrors = errorField(error, 'errors') ?? {};
        const issues = Object.entries(fieldErrors).map(([path, detail]) => ({
            path,
            message: detail?.message ?? 'Invalid value',
        }));
        return res.status(400).json({ error: 'Validation failed', code: 'VALIDATION', issues });
    }
    // body-parser errors (malformed JSON, oversized bodies) carry a `type` and an exposable status.
    const bodyParserType = errorField(error, 'type');
    if (bodyParserType === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Malformed JSON body', code: 'BAD_JSON' });
    }
    if (bodyParserType === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API Error]', error instanceof Error ? (error.stack ?? message) : message);
    return res.status(500).json({ error: env.isProd ? 'Internal server error' : message || 'Internal server error', code: 'INTERNAL' });
}
