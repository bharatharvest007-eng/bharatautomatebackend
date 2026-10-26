/**
 * Monthly usage metering (plan quotas) backed by `UsageCounter`.
 *
 * One counter row per (org, metric, UTC month). The workspace-wide row uses
 * accountId '_org' and is the only row quota checks read; when the caller
 * knows the account, a second per-account row is kept for breakdowns. Writes
 * are atomic `$inc` upserts, so concurrent senders never lose increments.
 *
 * Gauge metrics (accounts, contacts, …) are not stored here — the
 * entitlements service counts them live.
 */
import * as models from '../models/index.js';
import { newId } from '../lib/ids.js';
import { MONTHLY_METRICS } from '../config/plans.js';
/** accountId of the workspace-wide counter row. */
export const ORG_SCOPE = '_org';
/** 'YYYY-MM' of `date` in UTC. */
export function currentPeriod(date = new Date()) {
    return date.toISOString().slice(0, 7);
}
/** True for a well-formed 'YYYY-MM' period string. */
export function isPeriod(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function isDuplicateKeyError(error) {
    return error?.code === 11000;
}
/**
 * Atomically adds `qty` to one counter row and returns the new value. Two
 * first-ever increments can race on the upsert insert; the loser retries as a
 * plain update.
 */
async function incrementCounter(orgId, accountId, metric, period, qty) {
    const filter = { orgId, accountId, metric, period };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const row = await models.UsageCounter.findOneAndUpdate(filter, { $inc: { value: qty }, $setOnInsert: { _id: newId('usg') } }, { upsert: true, returnDocument: 'after' }).lean();
            return row?.value ?? qty;
        }
        catch (error) {
            if (!isDuplicateKeyError(error) || attempt > 0)
                throw error;
        }
    }
    return qty;
}
/**
 * Adds `qty` (default 1) to a monthly metric and returns the workspace total
 * for the period after the increment. Zero or negative quantities are ignored
 * (returns the current total).
 */
export async function recordUsageAndGet(orgId, metric, qty = 1, opts = {}) {
    const period = currentPeriod(opts.at);
    if (!Number.isFinite(qty) || qty <= 0)
        return getUsage(orgId, metric, period);
    const total = await incrementCounter(orgId, ORG_SCOPE, metric, period, qty);
    if (opts.accountId && opts.accountId !== ORG_SCOPE) {
        await incrementCounter(orgId, opts.accountId, metric, period, qty);
    }
    return total;
}
/** Adds `qty` (default 1) to a monthly metric for the org (and the account, when given). */
export async function recordUsage(orgId, metric, qty = 1, opts = {}) {
    await recordUsageAndGet(orgId, metric, qty, opts);
}
/** Workspace total of a monthly metric for `period` (default: current month). */
export async function getUsage(orgId, metric, period = currentPeriod()) {
    const row = await models.UsageCounter.findOne({ orgId, accountId: ORG_SCOPE, metric, period }).lean();
    return row?.value ?? 0;
}
/** All monthly metrics for `period` in one query (missing metrics are 0). */
export async function getMonthlyUsage(orgId, period = currentPeriod()) {
    const rows = await models.UsageCounter.find({ orgId, accountId: ORG_SCOPE, period, metric: { $in: MONTHLY_METRICS } }).lean();
    const usage = Object.fromEntries(MONTHLY_METRICS.map((metric) => [metric, 0]));
    for (const row of rows) {
        usage[row.metric] = row.value ?? 0;
    }
    return usage;
}
/** Per-account totals of a monthly metric for `period` (accounts without usage are omitted). */
export async function getAccountUsage(orgId, metric, period = currentPeriod()) {
    const rows = await models.UsageCounter.find({ orgId, metric, period, accountId: { $ne: ORG_SCOPE } }).lean();
    return Object.fromEntries(rows.map((row) => [row.accountId ?? ORG_SCOPE, row.value ?? 0]));
}
