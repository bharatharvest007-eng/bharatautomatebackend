/**
 * zod helpers for request validation. Failures throw an `HttpError` 400
 * `VALIDATION` carrying `issues: [{ path, message }]`, so routes can simply
 * `parseBody(schema, req.body)` inside their try/catch and let `sendError`
 * respond.
 */
import { z } from 'zod';
import { HttpError, formatZodIssues } from './http.js';
function parseWith(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new HttpError(400, 'Validation failed', 'VALIDATION', { issues: formatZodIssues(result.error.issues) });
    }
    return result.data;
}
export function parseBody(schema, body) {
    return parseWith(schema, body ?? {});
}
export function parseQuery(schema, query) {
    return parseWith(schema, query ?? {});
}
export function parseParams(schema, params) {
    return parseWith(schema, params ?? {});
}
/** Query-string boolean: accepts true/false/1/0/yes/no (query values arrive as strings). */
export const zBoolish = z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
    .transform((value) => value === true || value === 'true' || value === '1' || value === 'yes');
/** Shared `?page&limit` schema (coerced from strings). */
export const paginationQuery = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
});
