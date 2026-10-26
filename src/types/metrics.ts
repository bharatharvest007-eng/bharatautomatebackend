/**
 * Convenience re-exports of the plan / metric vocabulary defined in
 * `src/config/plans.ts`, for modules that only need the types and key lists.
 */
export type {
  PlanId,
  SubscriptionStatus,
  FeatureKey,
  MonthlyMetric,
  GaugeMetric,
  QuotaMetric,
  StatMetric,
  Currency,
  BillingInterval,
  PlanLimits,
  Entitlements,
  CreditBalance,
  UsageSummary,
} from '../config/plans.js';

export {
  FEATURE_KEYS,
  MONTHLY_METRICS,
  GAUGE_METRICS,
  QUOTA_METRICS,
  STAT_METRICS,
  FEATURE_LABELS,
  METRIC_LABELS,
  isFeatureKey,
  isMonthlyMetric,
  isGaugeMetric,
  isQuotaMetric,
  isStatMetric,
} from '../config/plans.js';
