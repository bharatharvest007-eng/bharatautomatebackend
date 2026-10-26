/**
 * Model pricing and credit conversion.
 *
 * Prices are USD per 1M tokens. Credits shown to customers are derived from
 * the raw model cost (1 credit = AI_CREDIT_USD), so a price change here
 * changes what each feature costs in credits without touching callers.
 */
import { env } from '../../config/env.js';
export const MODEL_PRICING = {
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
const DEFAULT_PRICING_MODEL = 'claude-opus-5-5';
/** Pricing for a model id (exact or date-suffixed); unknown models are priced as Opus 5.5. */
export function pricingFor(model) {
    const exact = MODEL_PRICING[model];
    if (exact)
        return exact;
    const prefix = Object.keys(MODEL_PRICING).find((known) => model.startsWith(`${known}-`) || model.startsWith(`${known}@`));
    return MODEL_PRICING[prefix ?? DEFAULT_PRICING_MODEL];
}
/** Raw USD cost of a call (not rounded, so per-iteration costs can be summed exactly). */
export function costUsd(model, tokens) {
    const price = pricingFor(model);
    return ((tokens.inputTokens * price.input +
        tokens.outputTokens * price.output +
        tokens.cacheReadTokens * price.cacheRead +
        tokens.cacheWriteTokens * price.cacheWrite) /
        1_000_000);
}
export function round2(value) {
    return Math.round(value * 100) / 100;
}
/** Credits charged for a successful call: cost / AI_CREDIT_USD rounded to 2 places, at least 0.01. */
export function creditsForCost(cost) {
    const unit = env.AI_CREDIT_USD > 0 ? env.AI_CREDIT_USD : 0.005;
    return Math.max(0.01, round2(cost / unit));
}
