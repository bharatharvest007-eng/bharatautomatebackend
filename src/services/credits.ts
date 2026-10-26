/**
 * AI credit wallet.
 *
 * 1 credit = AI_CREDIT_USD of raw model cost; credits are decimals rounded to
 * 2 places. Each plan includes a monthly allowance (`limits.ai_credits`); the
 * month's total consumption is the UsageCounter 'ai_credits'. Consumption
 * draws from the allowance first and overflows into purchased credits
 * (`Organization.creditBalance`), which never expire. Every movement of
 * purchased credits is written to `CreditLedger`; grants are idempotent per
 * (kind, refId) so a replayed payment webhook cannot credit twice.
 */
import * as models from '../models/index.js';
import type { CreditLedgerKind } from '../models/index.js';
import type { CreditBalance } from '../config/plans.js';
import { badRequest, notFound, paymentRequired } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { currentPeriod, getUsage, recordUsageAndGet } from './usage.js';
import { getEntitlements } from './entitlements.js';
import { notify } from './notify.js';

/** Smallest amount a successful AI call costs, and the default pre-call requirement. */
export const MIN_CREDIT_CHARGE = 0.01;

export type CreditGrantKind = Extract<CreditLedgerKind, 'purchase' | 'grant' | 'adjust' | 'refund'>;

export function roundCredits(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

async function purchasedBalance(orgId: string): Promise<number> {
  const org = await models.Organization.findById(orgId, { creditBalance: 1 }).lean();
  if (!org) throw notFound('Workspace not found');
  return roundCredits(Math.max(0, org.creditBalance ?? 0));
}

export async function getCreditBalance(orgId: string): Promise<CreditBalance> {
  const period = currentPeriod();
  const [entitlements, used, purchased] = await Promise.all([getEntitlements(orgId), getUsage(orgId, 'ai_credits', period), purchasedBalance(orgId)]);
  const limit = entitlements.limits.ai_credits;

  if (limit === null) {
    return {
      period,
      included: 0,
      includedUsed: roundCredits(used),
      includedRemaining: 0,
      purchased,
      available: purchased,
      unlimited: true,
    };
  }

  const includedRemaining = roundCredits(Math.max(0, limit - used));
  return {
    period,
    included: limit,
    includedUsed: roundCredits(Math.min(used, limit)),
    includedRemaining,
    purchased,
    available: roundCredits(includedRemaining + purchased),
  };
}

function notifyCreditsExhausted(orgId: string): void {
  void notify(orgId, {
    type: 'quota',
    severity: 'warning',
    title: 'AI credits used up',
    body: 'Your workspace has used all of its AI credits for this month. AI replies and tools are paused until you buy a credit pack, upgrade, or the next month starts.',
    link: '/billing',
    dedupeKey: `quota:ai_credits:${currentPeriod()}`,
  });
}

/** 402 AI_CREDITS_EXHAUSTED { needed, available } when fewer than `needed` credits remain. */
export async function assertCredits(orgId: string, needed = MIN_CREDIT_CHARGE): Promise<void> {
  const balance = await getCreditBalance(orgId);
  if (balance.unlimited || balance.available >= needed) return;
  notifyCreditsExhausted(orgId);
  throw paymentRequired(
    'Your workspace has run out of AI credits for this month. Buy a credit pack or upgrade your plan to keep using AI features.',
    'AI_CREDITS_EXHAUSTED',
    { needed: roundCredits(needed), available: balance.available, included: balance.included, purchased: balance.purchased },
  );
}

async function writeLedger(entry: {
  orgId: string;
  kind: CreditLedgerKind;
  credits: number;
  balanceAfter?: number;
  feature?: string;
  refType?: string;
  refId?: string;
  userId?: string;
  note?: string;
}): Promise<void> {
  try {
    await models.CreditLedger.create({ _id: newId('crl'), ...entry });
  } catch (error) {
    // refId is unique per (org, kind); for consumption it is informational only, so keep it in the note instead.
    if (!isDuplicateKeyError(error) || !entry.refId) throw error;
    const { refId, ...rest } = entry;
    await models.CreditLedger.create({ _id: newId('crl'), ...rest, note: [rest.note, `ref:${refId}`].filter(Boolean).join(' ') });
  }
}

/**
 * Charges `credits` for an AI call: the monthly allowance first, the overflow
 * from purchased credits. The call has already happened, so this never refuses;
 * the purchased balance is floored at 0.
 */
export async function consumeCredits(orgId: string, credits: number, meta: { feature: string; refId?: string; userId?: string }): Promise<void> {
  const amount = roundCredits(credits);
  if (amount <= 0) return;

  const [entitlements, totalAfter] = await Promise.all([getEntitlements(orgId), recordUsageAndGet(orgId, 'ai_credits', amount)]);
  const included = entitlements.limits.ai_credits;
  if (included === null) return;

  const totalBefore = totalAfter - amount;
  const fromIncluded = Math.min(amount, Math.max(0, included - totalBefore));
  const overflow = roundCredits(amount - fromIncluded);
  let purchasedAfter: number | null = null;

  if (overflow > 0) {
    const org = await models.Organization.findOneAndUpdate(
      { _id: orgId },
      [{ $set: { creditBalance: { $max: [0, { $round: [{ $subtract: [{ $ifNull: ['$creditBalance', 0] }, overflow] }, 2] }] } } }],
      { returnDocument: 'after', projection: { creditBalance: 1 } },
    ).lean();
    purchasedAfter = roundCredits(org?.creditBalance ?? 0);
    await writeLedger({
      orgId,
      kind: 'consume',
      credits: -overflow,
      balanceAfter: purchasedAfter,
      feature: meta.feature,
      refType: 'ai_usage',
      refId: meta.refId,
      userId: meta.userId,
    });
  }

  const includedLeft = Math.max(0, included - totalAfter);
  if (includedLeft < MIN_CREDIT_CHARGE) {
    const purchased = purchasedAfter ?? (await purchasedBalance(orgId));
    if (purchased < MIN_CREDIT_CHARGE) notifyCreditsExhausted(orgId);
  }
}

/**
 * Adds (or, for 'adjust'/'refund', optionally removes) purchased credits.
 * Idempotent on (kind, meta.refId): a repeat returns the current balance
 * without changing it. Returns the purchased balance after the grant.
 */
export async function grantCredits(
  orgId: string,
  credits: number,
  kind: CreditGrantKind,
  meta: { refType?: string; refId?: string; note?: string; userId?: string } = {},
): Promise<number> {
  const amount = roundCredits(credits);
  if (amount === 0) throw badRequest('Credit amount must be non-zero');
  if ((kind === 'purchase' || kind === 'grant') && amount < 0) throw badRequest(`A ${kind} must add credits`);
  if (!(await models.Organization.exists({ _id: orgId }))) throw notFound('Workspace not found');

  // Ledger first: the unique (orgId, kind, refId) index is the idempotency lock.
  const ledgerId = newId('crl');
  try {
    await models.CreditLedger.create({
      _id: ledgerId,
      orgId,
      kind,
      credits: amount,
      refType: meta.refType,
      refId: meta.refId,
      note: meta.note,
      userId: meta.userId,
    });
  } catch (error) {
    if (isDuplicateKeyError(error) && meta.refId) return purchasedBalance(orgId);
    throw error;
  }

  const org = await models.Organization.findOneAndUpdate(
    { _id: orgId },
    [{ $set: { creditBalance: { $max: [0, { $round: [{ $add: [{ $ifNull: ['$creditBalance', 0] }, amount] }, 2] }] } } }],
    { returnDocument: 'after', projection: { creditBalance: 1 } },
  ).lean();
  if (!org) {
    await models.CreditLedger.deleteOne({ _id: ledgerId });
    throw notFound('Workspace not found');
  }

  const balance = roundCredits(org.creditBalance ?? 0);
  await models.CreditLedger.updateOne({ _id: ledgerId }, { $set: { balanceAfter: balance } });
  return balance;
}
