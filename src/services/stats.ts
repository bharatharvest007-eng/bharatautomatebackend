/**
 * Daily analytics counters backed by `DailyStat`.
 *
 * Each event increments exactly one row: (org, account or '_org', UTC day,
 * metric). Workspace totals are the sum over all of an org's rows, so a stat
 * recorded against an account is never double counted at the org level.
 * Analytics reads these instead of scanning raw messages/comments.
 */
import * as models from '../models/index.js';
import { newId } from '../lib/ids.js';
import type { StatMetric } from '../config/plans.js';

const ORG_SCOPE = '_org';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Upper bound on a series request, to keep responses and aggregations small. */
export const MAX_STAT_RANGE_DAYS = 400;

/** 'YYYY-MM-DD' of `date` in UTC. */
export function statDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

/** Adds `qty` (default 1) to a daily metric. Never throws: analytics must not break the caller's flow. */
export async function recordStat(orgId: string, accountId: string | undefined | null, metric: StatMetric, qty = 1, at: Date = new Date()): Promise<void> {
  if (!orgId || !Number.isFinite(qty) || qty === 0) return;
  const filter = { orgId, accountId: accountId || ORG_SCOPE, day: statDay(at), metric };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await models.DailyStat.updateOne(filter, { $inc: { value: qty }, $setOnInsert: { _id: newId('dst') } }, { upsert: true });
      return;
    } catch (error) {
      if (isDuplicateKeyError(error) && attempt === 0) continue;
      console.error(`[Stats] Failed to record ${metric}:`, error instanceof Error ? error.message : error);
      return;
    }
  }
}

/** Every UTC day from `from` to `to` inclusive (capped at MAX_STAT_RANGE_DAYS, keeping the most recent days). */
export function daysBetween(from: Date, to: Date): string[] {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  if (end < start) return [];
  const first = Math.max(start, end - (MAX_STAT_RANGE_DAYS - 1) * DAY_MS);
  const days: string[] = [];
  for (let t = first; t <= end; t += DAY_MS) days.push(statDay(new Date(t)));
  return days;
}

function emptyValues(metrics: StatMetric[]): Record<StatMetric, number> {
  return Object.fromEntries(metrics.map((metric) => [metric, 0])) as Record<StatMetric, number>;
}

/**
 * Per-day values for `metrics` between `from` and `to` (inclusive, UTC days),
 * with zero-filled gaps. Without `accountId` the values are workspace totals.
 */
export async function getStatSeries(
  orgId: string,
  metrics: StatMetric[],
  from: Date,
  to: Date,
  accountId?: string,
): Promise<{ day: string; values: Record<StatMetric, number> }[]> {
  const days = daysBetween(from, to);
  if (days.length === 0 || metrics.length === 0) return days.map((day) => ({ day, values: emptyValues(metrics) }));

  const match: Record<string, unknown> = { orgId, metric: { $in: metrics }, day: { $gte: days[0], $lte: days[days.length - 1] } };
  if (accountId) match.accountId = accountId;

  const rows = await models.DailyStat.aggregate<{ _id: { day: string; metric: StatMetric }; value: number }>([
    { $match: match },
    { $group: { _id: { day: '$day', metric: '$metric' }, value: { $sum: '$value' } } },
  ]);

  const byDay = new Map<string, Record<StatMetric, number>>(days.map((day) => [day, emptyValues(metrics)]));
  for (const row of rows) {
    const values = byDay.get(row._id.day);
    if (values) values[row._id.metric] = row.value;
  }
  return days.map((day) => ({ day, values: byDay.get(day) ?? emptyValues(metrics) }));
}

/** Sum of each metric between `from` and `to` (inclusive, UTC days). */
export async function getStatTotals(orgId: string, metrics: StatMetric[], from: Date, to: Date, accountId?: string): Promise<Record<StatMetric, number>> {
  const totals = emptyValues(metrics);
  const days = daysBetween(from, to);
  if (days.length === 0 || metrics.length === 0) return totals;

  const match: Record<string, unknown> = { orgId, metric: { $in: metrics }, day: { $gte: days[0], $lte: days[days.length - 1] } };
  if (accountId) match.accountId = accountId;

  const rows = await models.DailyStat.aggregate<{ _id: StatMetric; value: number }>([
    { $match: match },
    { $group: { _id: '$metric', value: { $sum: '$value' } } },
  ]);
  for (const row of rows) totals[row._id] = row.value;
  return totals;
}
