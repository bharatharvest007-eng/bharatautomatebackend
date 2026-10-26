/**
 * Anthropic client and model tiers.
 *
 * Two tiers: 'default' (Claude Opus 5.5) for generation, agents and strategy,
 * 'fast' (Claude Haiku 5.5) for high-volume classification. Model ids come
 * from env so they can be changed without a deploy. The client is created
 * lazily and rebuilt if the API key changes at runtime.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { serviceUnavailable } from '../../lib/http.js';
export const AI_MODELS = {
    get default() {
        return env.AI_MODEL;
    },
    get fast() {
        return env.AI_MODEL_FAST;
    },
};
/** Beta header for the scalar `fallbacks: 'default'` form of server-side refusal fallbacks. */
export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/**
 * Models that accept server-side `fallbacks: 'default'` on the Claude API.
 * Haiku has no server-side fallback, so the fast tier never sends the param.
 */
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
/** Generous because default-tier calls think adaptively before answering; the SDK retries 429/5xx twice. */
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 2;
export function modelForTier(tier = 'default') {
    return tier === 'fast' ? AI_MODELS.fast : AI_MODELS.default;
}
export function supportsServerFallbacks(model) {
    return SERVER_FALLBACK_MODELS.has(model);
}
export function isAiConfigured() {
    return env.ANTHROPIC_API_KEY.trim().length > 0;
}
let client = null;
let clientKey = '';
/** The shared SDK client. Throws 503 AI_NOT_CONFIGURED when no API key is set. */
export function getAnthropicClient() {
    const apiKey = env.ANTHROPIC_API_KEY.trim();
    if (!apiKey)
        throw serviceUnavailable('AI is not configured. Add ANTHROPIC_API_KEY.', 'AI_NOT_CONFIGURED');
    if (!client || clientKey !== apiKey) {
        client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES });
        clientKey = apiKey;
    }
    return client;
}
