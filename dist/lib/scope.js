import * as models from '../models/index.js';
import { badRequest, notFound, unauthorized } from './http.js';
/** The authenticated workspace id. Throws 401 when the request is not authenticated. */
export function authOrgId(req) {
    const orgId = req.auth?.orgId;
    if (!orgId)
        throw unauthorized();
    return orgId;
}
/** Loads a document by id only if it belongs to `orgId`; otherwise 404 (never 403, to avoid leaking existence). */
export async function findOwned(model, id, orgId, notFoundMessage = 'Not found') {
    if (!id || typeof id !== 'string')
        throw notFound(notFoundMessage);
    const doc = await model.findOne({ _id: id, orgId });
    if (!doc)
        throw notFound(notFoundMessage);
    return doc;
}
/**
 * Picks the connected account an action applies to: the given id (which must
 * belong to the org), otherwise the most recently connected active account of
 * `platform` — Instagram first, then Facebook, when no platform is given.
 */
export async function resolveAccount(orgId, accountId, platform) {
    if (accountId) {
        const account = await models.SocialAccount.findOne({ _id: accountId, orgId });
        if (!account)
            throw notFound('Account not found');
        if (platform && account.platform !== platform)
            throw badRequest(`This is not a ${platform} account`);
        return account;
    }
    const platforms = platform ? [platform] : ['instagram', 'facebook'];
    for (const candidate of platforms) {
        const account = await models.SocialAccount.findOne({ orgId, platform: candidate, status: 'active' }).sort({ connectedAt: -1 });
        if (account)
            return account;
    }
    throw notFound('Connect an account first');
}
export function escapeRegex(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Spreadsheet apps execute cells starting with these characters as formulas.
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);
function csvCell(value) {
    if (value === null || value === undefined)
        return '';
    let text = typeof value === 'string' ? value : String(value);
    if (typeof value === 'string' && text.length > 0 && FORMULA_TRIGGERS.has(text[0])) {
        text = `'${text}`;
    }
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
/** RFC 4180 CSV with CRLF line endings and a formula-injection guard on string cells. */
export function toCsv(rows) {
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
export function paginate(query, maxLimit = 100) {
    const rawPage = Number(query.page);
    const rawLimit = Number(query.limit);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const defaultLimit = Math.min(25, maxLimit);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.floor(rawLimit), maxLimit) : defaultLimit;
    return { skip: (page - 1) * limit, limit, page };
}
