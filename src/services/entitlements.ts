/**
 * Entitlements: what a workspace may use right now.
 *
 * Combines the stored plan (`Organization.plan`), the subscription state
 * (`Organization.billing`) and per-org overrides (`Organization.limits`) with
 * the plan catalog. Results are cached in-process for 30s per org because
 * nearly every request and automation run checks them; billing code must call
 * `invalidateEntitlements(orgId)` after changing plan or billing state.
 *
 * Quotas: monthly metrics come from usage counters, gauge metrics are counted
 * live. Denials surface as 402 errors carrying the cheapest plan that would
 * allow the action (`requiredPlan`), which the dashboard's upgrade modal shows.
 */
import * as models from '../models/index.js';
import type { IOrganization, IOrganizationBilling } from '../models/index.js';
import {
  FEATURE_LABELS,
  GAUGE_METRICS,
  METRIC_LABELS,
  TRIAL_PLAN,
  effectiveLimits,
  featureMap,
  getPlan,
  isGaugeMetric,
  isPlanId,
  normalizePlanId,
  requiredPlanForFeature,
  requiredPlanForMetric,
  withinLimit,
  type Entitlements,
  type FeatureKey,
  type GaugeMetric,
  type PlanId,
  type QuotaMetric,
  type SubscriptionStatus,
  type UsageSummary,
} from '../config/plans.js';
import { notFound, paymentRequired } from '../lib/http.js';
import { setApiKeyGuard } from '../middleware/auth.js';
import { currentPeriod, getMonthlyUsage, getUsage, recordUsage } from './usage.js';
import { getCreditBalance } from './credits.js';
import { notify } from './notify.js';

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 5_000;
/** How long a past_due subscription keeps its paid plan after the period ended. */
export const PAST_DUE_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Subscription statuses whose plan the workspace is currently entitled to. */
const PAID_ACCESS_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(['active', 'trialing', 'past_due', 'cancelled']);

type OrgPlanFields = Pick<IOrganization, 'plan'> & { billing?: Partial<IOrganizationBilling> | null };
type OrgEntitlementFields = OrgPlanFields & Pick<IOrganization, '_id'> & { limits?: Record<string, unknown> | null };

function time(value?: Date | string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function higherPlan(a: PlanId, b: PlanId): PlanId {
  return getPlan(a).rank >= getPlan(b).rank ? a : b;
}

/**
 * The plan a workspace is entitled to and its effective subscription status.
 *
 * - legacy `plan: 'unlimited'` → enterprise / active (pre-billing workspaces keep working);
 * - trialing → the trial plan (or a higher paid plan) until `trialEndsAt`, then the stored plan with status 'expired';
 * - active → the subscribed plan, unless it was set to cancel and the period is over;
 * - past_due → keeps the paid plan for PAST_DUE_GRACE_DAYS after the period end, then free;
 * - cancelled → keeps the paid plan until the period end, then free;
 * - halted / expired → free.
 */
export function resolvePlan(org: OrgPlanFields, now: Date = new Date()): { planId: PlanId; status: SubscriptionStatus } {
  if (typeof org.plan === 'string' && org.plan.toLowerCase() === 'unlimited') {
    return { planId: 'enterprise', status: 'active' };
  }

  const billing = org.billing ?? {};
  const status: SubscriptionStatus = billing.status ?? 'free';
  const storedPlan = normalizePlanId(org.plan);
  const paidPlan = isPlanId(billing.planId) ? billing.planId : storedPlan;
  const nowMs = now.getTime();
  const periodEnd = time(billing.currentPeriodEnd);

  switch (status) {
    case 'trialing': {
      const trialEnd = time(billing.trialEndsAt);
      if (trialEnd !== null && nowMs < trialEnd) {
        const trialPlan = isPlanId(billing.trialPlan) ? billing.trialPlan : TRIAL_PLAN;
        return { planId: higherPlan(trialPlan, storedPlan), status: 'trialing' };
      }
      return { planId: storedPlan, status: storedPlan === 'free' ? 'expired' : 'active' };
    }
    case 'active':
      if (billing.cancelAtPeriodEnd && periodEnd !== null && nowMs >= periodEnd) {
        return { planId: 'free', status: 'cancelled' };
      }
      return { planId: paidPlan, status: 'active' };
    case 'past_due':
      if (periodEnd === null || nowMs < periodEnd + PAST_DUE_GRACE_DAYS * DAY_MS) {
        return { planId: paidPlan, status: 'past_due' };
      }
      return { planId: 'free', status: 'past_due' };
    case 'cancelled':
      if (periodEnd !== null && nowMs < periodEnd) return { planId: paidPlan, status: 'cancelled' };
      return { planId: 'free', status: 'cancelled' };
    case 'halted':
    case 'expired':
      return { planId: 'free', status };
    case 'free':
    default:
      // A paid plan with status 'free' only comes from manual admin edits; honor it.
      return { planId: storedPlan, status: 'free' };
  }
}

/** True when the resolved status still grants the plan's paid features (vs. having fallen back to free). */
export function hasPaidAccess(status: SubscriptionStatus): boolean {
  return PAID_ACCESS_STATUSES.has(status);
}

/** Builds the Entitlements shape (spec 6.3) for an organization document. */
export function buildEntitlements(org: OrgEntitlementFields, now: Date = new Date()): Entitlements {
  const { planId, status } = resolvePlan(org, now);
  const billing = org.billing ?? {};
  const plan = getPlan(planId);
  const entitlements: Entitlements = {
    plan: planId,
    planName: plan.name,
    status,
    features: featureMap(planId),
    limits: effectiveLimits(planId, org.limits ?? null),
  };
  if (status === 'trialing' && billing.trialEndsAt) entitlements.trialEndsAt = new Date(billing.trialEndsAt).toISOString();
  if (billing.currentPeriodEnd) entitlements.currentPeriodEnd = new Date(billing.currentPeriodEnd).toISOString();
  if (billing.cancelAtPeriodEnd) entitlements.cancelAtPeriodEnd = true;
  return entitlements;
}

// --- Cache ---------------------------------------------------------------------------

const cache = new Map<string, { value: Entitlements; expiresAt: number }>();
const inflight = new Map<string, Promise<Entitlements>>();

/** Drops cached entitlements for one org (after a billing change), or for all orgs. */
export function invalidateEntitlements(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

async function loadEntitlements(orgId: string): Promise<Entitlements> {
  const org = await models.Organization.findById(orgId, { plan: 1, billing: 1, limits: 1 }).lean();
  if (!org) throw notFound('Workspace not found');
  const value = buildEntitlements(org);
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(orgId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Current entitlements (cached for 30s). Throws 404 when the workspace does not exist. */
export async function getEntitlements(orgId: string): Promise<Entitlements> {
  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  // Collapse concurrent misses (e.g. a webhook burst) into one query.
  const pending = inflight.get(orgId);
  if (pending) return pending;
  const load = loadEntitlements(orgId).finally(() => inflight.delete(orgId));
  inflight.set(orgId, load);
  return load;
}

// --- Features ----------------------------------------------------------------------------

export async function hasFeature(orgId: string, feature: FeatureKey): Promise<boolean> {
  const entitlements = await getEntitlements(orgId);
  return entitlements.features[feature] === true;
}

/** 402 FEATURE_LOCKED { feature, requiredPlan, currentPlan } unless the plan includes `feature`. */
export async function assertFeature(orgId: string, feature: FeatureKey): Promise<void> {
  const entitlements = await getEntitlements(orgId);
  if (entitlements.features[feature]) return;
  const requiredPlan = requiredPlanForFeature(feature);
  const requiredName = requiredPlan ? getPlan(requiredPlan).name : 'a higher';
  throw paymentRequired(
    `${FEATURE_LABELS[feature]} is not included in your ${entitlements.planName} plan. Upgrade to ${requiredName} to unlock it.`,
    'FEATURE_LOCKED',
    { feature, requiredPlan, currentPlan: entitlements.plan },
  );
}

// --- Quotas ------------------------------------------------------------------------------

/** Live count of a gauge metric. */
export async function countGauge(orgId: string, metric: GaugeMetric): Promise<number> {
  switch (metric) {
    case 'social_accounts':
      // The website widget is modelled as a pseudo-account and is not a connected channel.
      return models.SocialAccount.countDocuments({
        orgId,
        platform: { $ne: 'widget' },
        status: { $nin: ['disconnected', 'revoked'] },
      });
    case 'members':
      return models.User.countDocuments({ 'memberships.orgId': orgId });
    case 'contacts':
      return models.Contact.countDocuments({ orgId });
    case 'live_automations':
      return models.Automation.countDocuments({ orgId, status: 'live' });
    case 'knowledge_docs':
      return models.KnowledgeDoc.countDocuments({ orgId });
    case 'competitors':
      return models.Competitor.countDocuments({ orgId });
    case 'lead_forms':
      return models.LeadCard.countDocuments({ orgId });
    default: {
      const exhaustive: never = metric;
      throw new Error(`Unknown gauge metric ${String(exhaustive)}`);
    }
  }
}

/** Current usage of any quota metric (monthly counter or live gauge). */
export async function getQuotaUsage(orgId: string, metric: QuotaMetric): Promise<number> {
  return isGaugeMetric(metric) ? countGauge(orgId, metric) : getUsage(orgId, metric);
}

function notifyQuotaReached(orgId: string, metric: QuotaMetric, limit: number, planName: string): void {
  const label = METRIC_LABELS[metric];
  void notify(orgId, {
    type: 'quota',
    severity: 'warning',
    title: `${label} limit reached`,
    body: `Your ${planName} plan allows ${limit.toLocaleString('en-IN')} ${label.toLowerCase()}${isGaugeMetric(metric) ? '' : ' per month'}. Upgrade to keep going without interruptions.`,
    link: '/billing',
    dedupeKey: `quota:${metric}:${currentPeriod()}`,
  });
}

/**
 * Whether `increment` more of `metric` fits the plan. Never throws for quota
 * reasons (use in automated paths that must degrade gracefully); a denial also
 * raises a once-per-month 'quota' notification.
 */
export async function checkQuota(orgId: string, metric: QuotaMetric, increment = 1): Promise<{ allowed: boolean; limit: number | null; used: number }> {
  const entitlements = await getEntitlements(orgId);
  const limit = entitlements.limits[metric];
  const used = await getQuotaUsage(orgId, metric);
  const allowed = withinLimit(limit, used, increment);
  if (!allowed && limit !== null) notifyQuotaReached(orgId, metric, limit, entitlements.planName);
  return { allowed, limit, used };
}

/** 402 PLAN_LIMIT { metric, limit, used, requiredPlan, currentPlan } when `increment` more would exceed the plan. */
export async function assertQuota(orgId: string, metric: QuotaMetric, increment = 1): Promise<void> {
  const { allowed, limit, used } = await checkQuota(orgId, metric, increment);
  if (allowed) return;
  const entitlements = await getEntitlements(orgId);
  const requiredPlan = requiredPlanForMetric(metric, used + increment);
  const label = METRIC_LABELS[metric].toLowerCase();
  const message =
    requiredPlan && requiredPlan !== entitlements.plan
      ? `You've reached your plan's limit of ${limit ?? 0} ${label}. Upgrade to ${getPlan(requiredPlan).name} for more.`
      : `You've reached the limit of ${limit ?? 0} ${label} for your workspace.`;
  throw paymentRequired(message, 'PLAN_LIMIT', { metric, limit, used, requiredPlan, currentPlan: entitlements.plan });
}

/** Usage of every quota metric for the current month plus the AI-credit wallet. */
export async function getUsageSummary(orgId: string): Promise<UsageSummary> {
  const period = currentPeriod();
  const [monthly, gaugeValues, credits] = await Promise.all([
    getMonthlyUsage(orgId, period),
    Promise.all(GAUGE_METRICS.map((metric) => countGauge(orgId, metric))),
    getCreditBalance(orgId),
  ]);
  const gauges = Object.fromEntries(GAUGE_METRICS.map((metric, index) => [metric, gaugeValues[index]])) as Record<GaugeMetric, number>;
  return { period, usage: { ...monthly, ...gauges }, credits };
}

// --- API keys ------------------------------------------------------------------------------

/**
 * Every API-key request (public `/api/v1` and private routers alike) requires
 * the `api_access` feature and counts against the monthly `api_calls` quota.
 * Registered here so the auth middleware does not depend on billing code.
 */
setApiKeyGuard(async (auth, req) => {
  await assertFeature(auth.orgId, 'api_access');
  await assertQuota(auth.orgId, 'api_calls', 1);
  const meter = () =>
    recordUsage(auth.orgId, 'api_calls').catch((error: unknown) => {
      console.error('[Entitlements] Failed to meter API call:', error instanceof Error ? error.message : error);
    });
  // Bill only calls that were served: a request later rejected (scope, session-only route, validation) is not metered.
  const res = req.res;
  if (!res) {
    void meter();
    return;
  }
  res.once('finish', () => {
    if (res.statusCode < 400) void meter();
  });
});
