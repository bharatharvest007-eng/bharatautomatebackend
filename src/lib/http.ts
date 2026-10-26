/**
 * HTTP error model shared by every route, middleware and service.
 *
 * Throw an `HttpError` (usually via the helpers below) anywhere in a request's
 * call stack and let the route's `catch` hand it to `sendError`, which maps it —
 * and validation, Mongo and unknown errors — to the standard
 * `{ error, code, ...details }` JSON shape. Unknown errors never leak their
 * message in production.
 */
import type { Response } from 'express';
import { env } from '../config/env.js';

export type PaymentRequiredCode = 'PLAN_LIMIT' | 'FEATURE_LOCKED' | 'AI_CREDITS_EXHAUSTED' | 'SUBSCRIPTION_INACTIVE';

export class HttpError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

export const badRequest = (message: string, details?: Record<string, unknown>): HttpError =>
  new HttpError(400, message, 'BAD_REQUEST', details);

export const unauthorized = (message = 'Not authenticated'): HttpError => new HttpError(401, message, 'UNAUTHENTICATED');

export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN'): HttpError => new HttpError(403, message, code);

export const notFound = (message = 'Not found'): HttpError => new HttpError(404, message, 'NOT_FOUND');

export const conflict = (message: string, code = 'CONFLICT'): HttpError => new HttpError(409, message, code);

export const paymentRequired = (message: string, code: PaymentRequiredCode, details?: Record<string, unknown>): HttpError =>
  new HttpError(402, message, code, details);

export const tooManyRequests = (message = 'Too many requests'): HttpError => new HttpError(429, message, 'RATE_LIMITED');

export const serviceUnavailable = (message: string, code = 'UNAVAILABLE'): HttpError => new HttpError(503, message, code);

export interface ValidationIssue {
  path: string;
  message: string;
}

interface ZodLikeIssue {
  path: PropertyKey[];
  message: string;
}

/** Duck-typed so errors from both `zod` (v3 API) and `zod/v4` (used by the AI SDK helpers) are recognized. */
function isZodError(error: unknown): error is Error & { issues: ZodLikeIssue[] } {
  return (
    error instanceof Error &&
    error.name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

export function formatZodIssues(issues: ZodLikeIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }));
}

function errorField<T>(error: unknown, field: string): T | undefined {
  if (error && typeof error === 'object' && field in error) {
    return (error as Record<string, unknown>)[field] as T;
  }
  return undefined;
}

/** Writes the standard error response for any thrown value. */
export function sendError(res: Response, error: unknown): Response {
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

  const name = errorField<string>(error, 'name');
  const mongoCode = errorField<number>(error, 'code');

  if (mongoCode === 11000 || mongoCode === 11001) {
    return res.status(409).json({ error: 'Already exists', code: 'DUPLICATE' });
  }

  if (name === 'CastError') {
    return res.status(400).json({ error: 'Invalid identifier or value', code: 'BAD_REQUEST' });
  }

  if (name === 'ValidationError') {
    const fieldErrors = errorField<Record<string, { message?: string }>>(error, 'errors') ?? {};
    const issues: ValidationIssue[] = Object.entries(fieldErrors).map(([path, detail]) => ({
      path,
      message: detail?.message ?? 'Invalid value',
    }));
    return res.status(400).json({ error: 'Validation failed', code: 'VALIDATION', issues });
  }

  // body-parser errors (malformed JSON, oversized bodies) carry a `type` and an exposable status.
  const bodyParserType = errorField<string>(error, 'type');
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
