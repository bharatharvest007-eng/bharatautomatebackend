/**
 * Plan catalog: the single source of truth for what each subscription tier
 * includes (features), how much of each metered resource it allows (limits),
 * and what it costs.
 *
 * Limits: a number is a hard cap, `null` means unlimited. Monthly metrics reset
 * each UTC calendar month ('YYYY-MM'); gauge metrics are counted live.
 * Prices are in minor units (paise / cents). INR prices exclude 18% GST.
 *
 * Legacy data:
 * - Organizations created before billing existed carry `plan: 'unlimited'`.
 *   `normalizePlanId('unlimited')` resolves it to 'enterprise', and the
 *   entitlements service treats such orgs as status 'active' so existing
 *   workspaces keep working without a subscription.
 * - `org.limits` holds per-org overrides keyed by QuotaMetric. Legacy keys
 *   (`maxAccounts`, `monthlyAiCredits`, `dailyDmLimitPerAccount`) are not
 *   QuotaMetrics and are ignored by `effectiveLimits`. A negative or null
 *   override means unlimited (the legacy seed used -1 for "unlimited").
 * - `members` is hard-capped at MAX_WORKSPACE_MEMBERS on every plan, overrides included.
 */

export type PlanId = 'free' | 'starter' | 'growth' | 'business' | 'enterprise';
export type SubscriptionStatus = 'free' | 'trialing' | 'active' | 'past_due' | 'halted' | 'cancelled' | 'expired';
export type FeatureKey =
  | 'facebook'
  | 'whatsapp'
  | 'broadcasts'
  | 'ai_agent'
  | 'ai_studio'
  | 'content_publishing'
  | 'smart_stack'
  | 'rewind'
  | 'trial_reels'
  | 'sequences'
  | 'lead_scoring'
  | 'lead_forms'
  | 'insights_copilot'
  | 'competitor_watch'
  | 'api_access'
  | 'webhooks_out'
  | 'remove_branding'
  | 'csv_export'
  | 'audit_log'
  | 'ab_testing'
  | 'website_widget'
  | 'priority_support';
export type MonthlyMetric = 'messages_sent' | 'automation_runs' | 'ai_credits' | 'broadcast_recipients' | 'scheduled_posts' | 'api_calls';
export type GaugeMetric = 'social_accounts' | 'members' | 'contacts' | 'live_automations' | 'knowledge_docs' | 'competitors' | 'lead_forms';
export type QuotaMetric = MonthlyMetric | GaugeMetric;
export type StatMetric =
  | 'inbound_messages'
  | 'comments_received'
  | 'comments_replied'
  | 'comments_hidden'
  | 'dms_sent'
  | 'dms_failed'
  | 'wa_messages_sent'
  | 'triggers_fired'
  | 'automation_runs'
  | 'leads_captured'
  | 'link_clicks'
  | 'bio_views'
  | 'posts_published'
  | 'broadcast_sent'
  | 'ai_calls'
  | 'ai_replies'
  | 'new_contacts'
  | 'follows_confirmed'
  | 'conversions';

export type Currency = 'INR' | 'USD';
export type BillingInterval = 'month' | 'year';
export type PlanLimits = Record<QuotaMetric, number | null>;
export type PlanPrices = Record<Currency, Record<BillingInterval, number>>;

export interface PlanDefinition {
  id: PlanId;
  /** Ordering from cheapest (0) to most expensive. */
  rank: number;
  name: string;
  tagline: string;
  /** Marketing bullets for pricing / plan-change UIs. */
  highlights: string[];
  recommended: boolean;
  /** Sales-led pricing: no self-serve checkout, `prices` is null. */
  custom: boolean;
  prices: PlanPrices | null;
  /** Full (cumulative) feature list of this plan. */
  features: FeatureKey[];
  limits: PlanLimits;
}

export type CreditPackId = 'pack_1k' | 'pack_5k' | 'pack_20k';

export interface CreditPack {
  id: CreditPackId;
  name: string;
  credits: number;
  /** Price in paise, excluding GST. */
  inr: number;
  /** Price in cents. */
  usd: number;
}

// --- Shapes shared with the frontend (spec 6.3) --------------------------------

export interface Entitlements {
  plan: PlanId;
  planName: string;
  status: SubscriptionStatus;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  features: Record<FeatureKey, boolean>;
  limits: Record<QuotaMetric, number | null>;
}

export interface CreditBalance {
  period: string;
  included: number;
  includedUsed: number;
  includedRemaining: number;
  purchased: number;
  available: number;
  /** True when an org override makes included AI credits unlimited (included/remaining then report 0). */
  unlimited?: boolean;
}

export interface UsageSummary {
  period: string;
  usage: Record<QuotaMetric, number>;
  credits: CreditBalance;
}

// --- Key lists --------------------------------------------------------------

export const PLAN_IDS: readonly PlanId[] = ['free', 'starter', 'growth', 'business', 'enterprise'];
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['free', 'trialing', 'active', 'past_due', 'halted', 'cancelled', 'expired'];

export const FEATURE_KEYS: readonly FeatureKey[] = [
  'facebook',
  'whatsapp',
  'broadcasts',
  'ai_agent',
  'ai_studio',
  'content_publishing',
  'smart_stack',
  'rewind',
  'trial_reels',
  'sequences',
  'lead_scoring',
  'lead_forms',
  'insights_copilot',
  'competitor_watch',
  'api_access',
  'webhooks_out',
  'remove_branding',
  'csv_export',
  'audit_log',
  'ab_testing',
  'website_widget',
  'priority_support',
];

export const MONTHLY_METRICS: readonly MonthlyMetric[] = ['messages_sent', 'automation_runs', 'ai_credits', 'broadcast_recipients', 'scheduled_posts', 'api_calls'];
export const GAUGE_METRICS: readonly GaugeMetric[] = ['social_accounts', 'members', 'contacts', 'live_automations', 'knowledge_docs', 'competitors', 'lead_forms'];
export const QUOTA_METRICS: readonly QuotaMetric[] = [...MONTHLY_METRICS, ...GAUGE_METRICS];

export const STAT_METRICS: readonly StatMetric[] = [
  'inbound_messages',
  'comments_received',
  'comments_replied',
  'comments_hidden',
  'dms_sent',
  'dms_failed',
  'wa_messages_sent',
  'triggers_fired',
  'automation_runs',
  'leads_captured',
  'link_clicks',
  'bio_views',
  'posts_published',
  'broadcast_sent',
  'ai_calls',
  'ai_replies',
  'new_contacts',
  'follows_confirmed',
  'conversions',
];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  facebook: 'Facebook Pages',
  whatsapp: 'WhatsApp Business',
  broadcasts: 'Broadcast campaigns',
  ai_agent: 'AI sales & support agent',
  ai_studio: 'AI Content Studio',
  content_publishing: 'Scheduling & auto-publishing',
  smart_stack: 'Smart Stack (spam guard & pacing)',
  rewind: 'Rewind (reply to past comments)',
  trial_reels: 'Trial Reels automation',
  sequences: 'Drip sequences',
  lead_scoring: 'AI lead scoring',
  lead_forms: 'Lead forms',
  insights_copilot: 'AI Insights & Growth Co-pilot',
  competitor_watch: 'Competitor tracking',
  api_access: 'REST API',
  webhooks_out: 'Outbound webhooks',
  remove_branding: 'Remove BharatAutomate branding',
  csv_export: 'CSV import & export',
  audit_log: 'Audit log',
  ab_testing: 'A/B testing',
  website_widget: 'Website chat widget',
  priority_support: 'Priority support',
};

export const METRIC_LABELS: Record<QuotaMetric, string> = {
  messages_sent: 'Messages sent',
  automation_runs: 'Automation runs',
  ai_credits: 'AI credits',
  broadcast_recipients: 'Broadcast recipients',
  scheduled_posts: 'Scheduled posts',
  api_calls: 'API calls',
  social_accounts: 'Connected accounts',
  members: 'Team members',
  contacts: 'Contacts',
  live_automations: 'Live automations',
  knowledge_docs: 'Knowledge base documents',
  competitors: 'Tracked competitors',
  lead_forms: 'Lead forms',
};

/** Owner + up to 3 members, on every plan. */
export const MAX_WORKSPACE_MEMBERS = 4;
export const TRIAL_PLAN: PlanId = 'growth';
export const TRIAL_DAYS = 14;
export const GST_RATE_PERCENT = 18;

// --- Catalog ----------------------------------------------------------------

const FREE_FEATURES: FeatureKey[] = ['lead_forms'];
const STARTER_FEATURES: FeatureKey[] = [
  ...FREE_FEATURES,
  'facebook',
  'whatsapp',
  'broadcasts',
  'ai_studio',
  'smart_stack',
  'rewind',
  'csv_export',
  'website_widget',
  'content_publishing',
];
const GROWTH_FEATURES: FeatureKey[] = [
  ...STARTER_FEATURES,
  'ai_agent',
  'trial_reels',
  'sequences',
  'lead_scoring',
  'ab_testing',
  'remove_branding',
  'competitor_watch',
  'insights_copilot',
];
const BUSINESS_FEATURES: FeatureKey[] = [...GROWTH_FEATURES, 'api_access', 'webhooks_out', 'audit_log', 'priority_support'];
const ENTERPRISE_FEATURES: FeatureKey[] = [...FEATURE_KEYS];

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    rank: 0,
    name: 'Free',
    tagline: 'Automate your first Instagram account',
    highlights: [
      '1 Instagram account',
      '3 live comment-to-DM and keyword automations',
      '1,000 automated messages / month',
      '50 AI credits / month',
      '500 contacts and 1 lead form',
    ],
    recommended: false,
    custom: false,
    prices: { INR: { month: 0, year: 0 }, USD: { month: 0, year: 0 } },
    features: FREE_FEATURES,
    limits: {
      social_accounts: 1,
      members: 1,
      contacts: 500,
      live_automations: 3,
      automation_runs: 1_000,
      messages_sent: 1_000,
      ai_credits: 50,
      broadcast_recipients: 0,
      scheduled_posts: 10,
      knowledge_docs: 3,
      competitors: 0,
      lead_forms: 1,
      api_calls: 0,
    },
  },
  starter: {
    id: 'starter',
    rank: 1,
    name: 'Starter',
    tagline: 'For creators and small businesses going multi-channel',
    highlights: [
      '2 accounts across Instagram, Facebook and WhatsApp',
      '15 live automations and 10,000 messages / month',
      'AI Content Studio with 500 AI credits / month',
      'Content calendar with auto-publishing (60 posts / month)',
      'Broadcasts to 1,000 recipients / month',
      'Smart Stack spam guard, Rewind and website chat widget',
      'CSV import & export',
    ],
    recommended: false,
    custom: false,
    prices: { INR: { month: 99_900, year: 999_000 }, USD: { month: 1_500, year: 15_000 } },
    features: STARTER_FEATURES,
    limits: {
      social_accounts: 2,
      members: 2,
      contacts: 2_500,
      live_automations: 15,
      automation_runs: 10_000,
      messages_sent: 10_000,
      ai_credits: 500,
      broadcast_recipients: 1_000,
      scheduled_posts: 60,
      knowledge_docs: 10,
      competitors: 0,
      lead_forms: 3,
      api_calls: 0,
    },
  },
  growth: {
    id: 'growth',
    rank: 2,
    name: 'Growth',
    tagline: 'An AI agent that sells and supports 24/7',
    highlights: [
      '5 accounts and 3 team members',
      'Unlimited live automations, 50,000 messages / month',
      'AI sales & support agent with a 50-document knowledge base',
      '3,000 AI credits / month',
      'AI lead scoring, drip sequences and A/B testing',
      'Weekly AI insights, Growth Co-pilot and 3 competitor trackers',
      'Trial Reels automation and no BharatAutomate branding',
    ],
    recommended: true,
    custom: false,
    prices: { INR: { month: 299_900, year: 2_999_000 }, USD: { month: 3_900, year: 39_000 } },
    features: GROWTH_FEATURES,
    limits: {
      social_accounts: 5,
      members: 3,
      contacts: 15_000,
      live_automations: null,
      automation_runs: 50_000,
      messages_sent: 50_000,
      ai_credits: 3_000,
      broadcast_recipients: 10_000,
      scheduled_posts: 300,
      knowledge_docs: 50,
      competitors: 3,
      lead_forms: 10,
      api_calls: 0,
    },
  },
  business: {
    id: 'business',
    rank: 3,
    name: 'Business',
    tagline: 'Scale with the API, webhooks and a full audit trail',
    highlights: [
      '15 accounts and 4 team members',
      '250,000 messages and 12,000 AI credits / month',
      '100,000 contacts and 100,000 broadcast recipients / month',
      'REST API (100,000 calls / month) and outbound webhooks',
      'Audit log and priority support',
      '10 competitor trackers and unlimited lead forms',
    ],
    recommended: false,
    custom: false,
    prices: { INR: { month: 799_900, year: 7_999_000 }, USD: { month: 9_900, year: 99_000 } },
    features: BUSINESS_FEATURES,
    limits: {
      social_accounts: 15,
      members: 4,
      contacts: 100_000,
      live_automations: null,
      automation_runs: 250_000,
      messages_sent: 250_000,
      ai_credits: 12_000,
      broadcast_recipients: 100_000,
      scheduled_posts: 1_500,
      knowledge_docs: 200,
      competitors: 10,
      lead_forms: null,
      api_calls: 100_000,
    },
  },
  enterprise: {
    id: 'enterprise',
    rank: 4,
    name: 'Enterprise',
    tagline: 'Custom volumes with a dedicated success manager',
    highlights: [
      'Unlimited accounts, contacts and messages',
      '50,000 AI credits / month',
      'Every feature, including the API and webhooks',
      '50 competitor trackers',
      'Custom pricing and GST invoicing',
      'Dedicated success manager',
    ],
    recommended: false,
    custom: true,
    prices: null,
    features: ENTERPRISE_FEATURES,
    limits: {
      social_accounts: null,
      members: 4,
      contacts: null,
      live_automations: null,
      automation_runs: null,
      messages_sent: null,
      ai_credits: 50_000,
      broadcast_recipients: null,
      scheduled_posts: null,
      knowledge_docs: null,
      competitors: 50,
      lead_forms: null,
      api_calls: null,
    },
  },
};

/** Plans ordered cheapest first. */
export const PLAN_LIST: readonly PlanDefinition[] = PLAN_IDS.map((id) => PLANS[id]);

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: 'pack_1k', name: '1,000 AI credits', credits: 1_000, inr: 79_900, usd: 1_000 },
  { id: 'pack_5k', name: '5,000 AI credits', credits: 5_000, inr: 349_900, usd: 4_500 },
  { id: 'pack_20k', name: '20,000 AI credits', credits: 20_000, inr: 1_199_900, usd: 15_000 },
];

// --- Helpers ----------------------------------------------------------------

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value);
}

export function isMonthlyMetric(value: unknown): value is MonthlyMetric {
  return typeof value === 'string' && (MONTHLY_METRICS as readonly string[]).includes(value);
}

export function isGaugeMetric(value: unknown): value is GaugeMetric {
  return typeof value === 'string' && (GAUGE_METRICS as readonly string[]).includes(value);
}

export function isQuotaMetric(value: unknown): value is QuotaMetric {
  return isMonthlyMetric(value) || isGaugeMetric(value);
}

export function isStatMetric(value: unknown): value is StatMetric {
  return typeof value === 'string' && (STAT_METRICS as readonly string[]).includes(value);
}

/** Maps any stored plan string to a catalog id: legacy 'unlimited' → 'enterprise', unknown/empty → 'free'. */
export function normalizePlanId(value?: string | null): PlanId {
  if (!value) return 'free';
  const lowered = value.toLowerCase();
  if (lowered === 'unlimited') return 'enterprise';
  return isPlanId(lowered) ? lowered : 'free';
}

export function getPlan(id?: string | null): PlanDefinition {
  return PLANS[normalizePlanId(id)];
}

export function planHasFeature(planId: PlanId, feature: FeatureKey): boolean {
  return PLANS[planId].features.includes(feature);
}

export function featureMap(planId: PlanId): Record<FeatureKey, boolean> {
  const features = new Set(PLANS[planId].features);
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, features.has(key)])) as Record<FeatureKey, boolean>;
}

export function planLimit(planId: PlanId, metric: QuotaMetric): number | null {
  const limit = PLANS[planId].limits[metric];
  if (metric === 'members') return Math.min(limit ?? MAX_WORKSPACE_MEMBERS, MAX_WORKSPACE_MEMBERS);
  return limit;
}

/**
 * Plan limits with per-org overrides applied. Only QuotaMetric keys are honored;
 * a negative or null override means unlimited. Members stay capped at MAX_WORKSPACE_MEMBERS.
 */
export function effectiveLimits(planId: PlanId, overrides?: Record<string, unknown> | null): PlanLimits {
  const limits = { ...PLANS[planId].limits };
  if (overrides && typeof overrides === 'object') {
    for (const metric of QUOTA_METRICS) {
      if (!Object.prototype.hasOwnProperty.call(overrides, metric)) continue;
      const value = overrides[metric];
      if (value === null) {
        limits[metric] = null;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        limits[metric] = value < 0 ? null : Math.floor(value);
      }
    }
  }
  limits.members = Math.min(limits.members ?? MAX_WORKSPACE_MEMBERS, MAX_WORKSPACE_MEMBERS);
  return limits;
}

/** True when `used + increment` fits within `limit` (null = unlimited). */
export function withinLimit(limit: number | null, used: number, increment = 1): boolean {
  return limit === null || used + increment <= limit;
}

/** Cheapest plan that includes `feature`. */
export function requiredPlanForFeature(feature: FeatureKey): PlanId | null {
  return PLAN_LIST.find((plan) => plan.features.includes(feature))?.id ?? null;
}

/**
 * Cheapest plan whose `metric` limit is unlimited or at least `minimum`
 * (default 1, i.e. "allows any"). Returns null when no plan can, e.g. more
 * than MAX_WORKSPACE_MEMBERS members.
 */
export function requiredPlanForMetric(metric: QuotaMetric, minimum = 1): PlanId | null {
  return (
    PLAN_LIST.find((plan) => {
      const limit = planLimit(plan.id, metric);
      return limit === null || limit >= minimum;
    })?.id ?? null
  );
}

/**
 * Cheapest plan that satisfies a feature or quota need. 'lead_forms' is both a
 * feature and a gauge metric: passing `minimum` selects the metric meaning.
 */
export function requiredPlanFor(need: FeatureKey | QuotaMetric, minimum?: number): PlanId | null {
  if (isQuotaMetric(need) && (minimum !== undefined || !isFeatureKey(need))) {
    return requiredPlanForMetric(need, minimum ?? 1);
  }
  return isFeatureKey(need) ? requiredPlanForFeature(need) : null;
}

export function comparePlans(a: PlanId, b: PlanId): number {
  return PLANS[a].rank - PLANS[b].rank;
}

/** Self-serve price in minor units, or null for custom/unknown plans. */
export function planPrice(planId: PlanId, currency: Currency, interval: BillingInterval): number | null {
  const prices = PLANS[planId].prices;
  return prices ? prices[currency][interval] : null;
}

export function getCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}
