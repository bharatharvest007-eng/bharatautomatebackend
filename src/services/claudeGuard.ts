/**
 * Claude API Budget Guard & Rate Limiter
 * Enforces a strict $3.00 USD total spending cap and sliding window rate limiter
 * to protect the user's Claude account from exceeding the 3-dollar budget.
 */
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const SHARED_TRACKER_PATH = path.resolve(
  process.env.CLAUDE_TRACKER_PATH || '/Users/apple/Downloads/bharatharvestupgradesep19th/.claude_budget_tracker.json'
);

const HARD_BUDGET_CAP_USD = 3.00;
const MAX_CALLS_PER_MINUTE = 12;

// STRICT RULE: ONLY HAIKU MODEL TO PRESERVE $3.00 BUDGET
export const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
export const HAIKU_FALLBACK_MODEL = 'claude-3-haiku-20240307';

// Per-token cost definitions for Claude Haiku (USD)
const PRICING: Record<string, { inputPerToken: number; outputPerToken: number }> = {
  [HAIKU_MODEL]: {
    inputPerToken: 0.80 / 1_000_000,   // $0.00000080
    outputPerToken: 4.00 / 1_000_000,  // $0.00000400
  },
  [HAIKU_FALLBACK_MODEL]: {
    inputPerToken: 0.25 / 1_000_000,   // $0.00000025
    outputPerToken: 1.25 / 1_000_000,  // $0.00000125
  },
  default: {
    inputPerToken: 0.80 / 1_000_000,
    outputPerToken: 4.00 / 1_000_000,
  },
};

interface BudgetData {
  budgetCapUsd: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  budgetExceeded: boolean;
  updatedAt: string;
  history?: Array<{
    timestamp: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    context: string;
  }>;
}

// In-memory timestamps for sliding-window rate limit
const recentCallTimestamps: number[] = [];

function loadBudgetData(): BudgetData {
  try {
    if (fs.existsSync(SHARED_TRACKER_PATH)) {
      const content = fs.readFileSync(SHARED_TRACKER_PATH, 'utf-8');
      const data = JSON.parse(content);
      return {
        budgetCapUsd: HARD_BUDGET_CAP_USD,
        totalCostUsd: Number(data.totalCostUsd) || 0,
        totalInputTokens: Number(data.totalInputTokens) || 0,
        totalOutputTokens: Number(data.totalOutputTokens) || 0,
        totalCalls: Number(data.totalCalls) || 0,
        budgetExceeded: Boolean(data.budgetExceeded) || (Number(data.totalCostUsd) >= HARD_BUDGET_CAP_USD),
        updatedAt: data.updatedAt || new Date().toISOString(),
        history: Array.isArray(data.history) ? data.history.slice(-30) : [],
      };
    }
  } catch (err: any) {
    console.warn('[ClaudeBudgetGuard] Error reading budget file, using safe defaults:', err.message);
  }

  return {
    budgetCapUsd: HARD_BUDGET_CAP_USD,
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCalls: 0,
    budgetExceeded: false,
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

function saveBudgetData(data: BudgetData): void {
  try {
    fs.writeFileSync(SHARED_TRACKER_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[ClaudeBudgetGuard] Failed to save budget tracker:', err.message);
  }
}

export class ClaudeBudgetGuard {
  private static apiKey = process.env.ANTHROPIC_API_KEY || '';
  private static anthropicClient: Anthropic | null = null;

  public static setApiKey(key: string) {
    this.apiKey = key;
    this.anthropicClient = null;
  }

  public static getClient(): Anthropic | null {
    if (this.anthropicClient) return this.anthropicClient;
    const key = (process.env.ANTHROPIC_API_KEY || this.apiKey).trim();
    if (!key || key.startsWith('sk-ant-dummy')) return null;
    this.anthropicClient = new Anthropic({ apiKey: key });
    return this.anthropicClient;
  }

  /**
   * Check whether a new API call is permitted under the $3.00 limit and rate limits.
   */
  public static canExecute(): { allowed: boolean; reason?: string; budgetRemaining: number; totalCostUsd: number } {
    const data = loadBudgetData();
    const budgetRemaining = Math.max(0, HARD_BUDGET_CAP_USD - data.totalCostUsd);

    // 1. Hard Budget Check ($3.00 stop)
    if (data.totalCostUsd >= HARD_BUDGET_CAP_USD || data.budgetExceeded) {
      console.warn(
        `[ClaudeBudgetGuard] 🛑 BLOCKED: Budget limit reached! Total spent: $${data.totalCostUsd.toFixed(4)} of $${HARD_BUDGET_CAP_USD.toFixed(2)} cap.`
      );
      return {
        allowed: false,
        reason: `Claude budget limit reached ($${HARD_BUDGET_CAP_USD.toFixed(2)} USD cap). Falling back to Farm Box offline concierge.`,
        budgetRemaining: 0,
        totalCostUsd: data.totalCostUsd,
      };
    }

    // 2. Sliding Window Rate Limit (12 calls per minute max)
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    while (recentCallTimestamps.length > 0 && recentCallTimestamps[0] < oneMinuteAgo) {
      recentCallTimestamps.shift();
    }

    if (recentCallTimestamps.length >= MAX_CALLS_PER_MINUTE) {
      console.warn(`[ClaudeBudgetGuard] ⏳ RATE LIMIT: ${MAX_CALLS_PER_MINUTE} calls/min exceeded. Throttling request.`);
      return {
        allowed: false,
        reason: 'Rate limit: Exceeded 12 calls/minute. Throttled to preserve Claude budget.',
        budgetRemaining,
        totalCostUsd: data.totalCostUsd,
      };
    }

    return {
      allowed: true,
      budgetRemaining,
      totalCostUsd: data.totalCostUsd,
    };
  }

  /**
   * Record exact tokens and cost from Anthropic usage response.
   */
  public static recordUsage(model: string, inputTokens: number, outputTokens: number, context = 'general') {
    const data = loadBudgetData();
    const rate = PRICING[model] || PRICING.default;

    const callCost = inputTokens * rate.inputPerToken + outputTokens * rate.outputPerToken;
    data.totalCostUsd = Math.round((data.totalCostUsd + callCost) * 1_000_000) / 1_000_000;
    data.totalInputTokens += inputTokens;
    data.totalOutputTokens += outputTokens;
    data.totalCalls += 1;
    data.updatedAt = new Date().toISOString();

    if (data.totalCostUsd >= HARD_BUDGET_CAP_USD) {
      data.budgetExceeded = true;
      console.error(
        `[ClaudeBudgetGuard] 🚨 $3.00 BUDGET CAP HIT: Total cost is now $${data.totalCostUsd.toFixed(4)}. Further calls are now HALTED.`
      );
    } else {
      console.log(
        `[ClaudeBudgetGuard] Call Cost: $${callCost.toFixed(5)} (${inputTokens}in / ${outputTokens}out). Total Spent: $${data.totalCostUsd.toFixed(4)} / $${HARD_BUDGET_CAP_USD.toFixed(2)}.`
      );
    }

    data.history = data.history || [];
    data.history.push({
      timestamp: new Date().toISOString(),
      model,
      inputTokens,
      outputTokens,
      costUsd: callCost,
      context,
    });
    if (data.history.length > 50) data.history.shift();

    saveBudgetData(data);
  }

  /**
   * Safe execution wrapper for Claude messages.
   * Capped tokens (default max 200) ensures micro-costs (~$0.0006/call).
   */
  public static async executeMessage(params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    system?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
    context?: string;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number } | null> {
    const check = this.canExecute();
    if (!check.allowed) {
      console.warn(`[ClaudeBudgetGuard] Skipped Claude API call: ${check.reason}`);
      return null;
    }

    const client = this.getClient();
    if (!client) {
      console.warn('[ClaudeBudgetGuard] Anthropic client not configured or missing valid key.');
      return null;
    }

    // STRICT RULE: ONLY HAIKU MODEL TO PRESERVE $3.00 BUDGET
    const model = HAIKU_MODEL;
    const maxTokens = Math.min(params.maxTokens || 200, 350); // Hard cap on output tokens

    try {
      recentCallTimestamps.push(Date.now());

      let response: any;
      try {
        response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature: params.temperature ?? 0.7,
          system: params.system,
          messages: params.messages,
        });
      } catch (err: any) {
        if (err.message?.includes('model') || err.status === 404) {
          console.warn(`[ClaudeBudgetGuard] ${HAIKU_MODEL} not accessible, trying ${HAIKU_FALLBACK_MODEL}`);
          response = await client.messages.create({
            model: HAIKU_FALLBACK_MODEL,
            max_tokens: maxTokens,
            temperature: params.temperature ?? 0.7,
            system: params.system,
            messages: params.messages,
          });
        } else {
          throw err;
        }
      }

      const inTokens = response.usage?.input_tokens || 0;
      const outTokens = response.usage?.output_tokens || 0;
      const rate = PRICING[model] || PRICING.default;
      const callCost = inTokens * rate.inputPerToken + outTokens * rate.outputPerToken;

      this.recordUsage(model, inTokens, outTokens, params.context || 'ai_service');

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      return {
        text,
        inputTokens: inTokens,
        outputTokens: outTokens,
        costUsd: callCost,
      };
    } catch (err: any) {
      console.error('[ClaudeBudgetGuard] Anthropic API call error:', err.message);
      return null;
    }
  }

  /**
   * Get current budget status for monitoring in dashboard.
   */
  public static getBudgetStatus() {
    const data = loadBudgetData();
    return {
      budgetCapUsd: HARD_BUDGET_CAP_USD,
      totalCostUsd: Number(data.totalCostUsd.toFixed(4)),
      budgetRemainingUsd: Number(Math.max(0, HARD_BUDGET_CAP_USD - data.totalCostUsd).toFixed(4)),
      totalCalls: data.totalCalls,
      totalInputTokens: data.totalInputTokens,
      totalOutputTokens: data.totalOutputTokens,
      budgetExceeded: data.budgetExceeded,
      updatedAt: data.updatedAt,
      recentHistory: (data.history || []).slice(-10),
    };
  }
}
