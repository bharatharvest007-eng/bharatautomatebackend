/**
 * Central, typed access to environment configuration.
 *
 * `dotenv.config()` runs at module top so that importing this file FIRST (as
 * `server.ts` and `app.ts` do) loads `.env` before any other module reads
 * `process.env` — ESM hoists imports, so a `dotenv.config()` call in the body
 * of `server.ts` used to run after every route/service module had already
 * captured `undefined` values.
 *
 * Every property is a getter that reads `process.env` on each access, so tests
 * and scripts can change variables at runtime and nothing caches a stale value.
 */
import dotenv from 'dotenv';

dotenv.config();

export type CookieSameSite = 'lax' | 'none';
export type BillingMode = 'live' | 'dev';

function str(name: string, fallback = ''): string {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed;
}

function num(name: string, fallback: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function list(name: string): string[] {
  return str(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function nodeEnv(): string {
  return str('NODE_ENV', 'development');
}

function isProduction(): boolean {
  return nodeEnv() === 'production';
}

function port(): number {
  return num('PORT', num('API_PORT', 5000));
}

function cookieSameSite(): CookieSameSite {
  return str('COOKIE_SAMESITE', 'lax').toLowerCase() === 'none' ? 'none' : 'lax';
}

function razorpayConfigured(): boolean {
  return Boolean(str('RAZORPAY_KEY_ID') && str('RAZORPAY_KEY_SECRET'));
}

export const env = {
  get NODE_ENV(): string {
    return nodeEnv();
  },
  get isProd(): boolean {
    return isProduction();
  },
  get PORT(): number {
    return port();
  },
  /** Public URL of this backend (used for webhook/OAuth callback URLs and short links). */
  get BASE_URL(): string {
    return stripTrailingSlash(str('BASE_URL', `http://localhost:${port()}`));
  },
  get FRONTEND_URL(): string {
    return stripTrailingSlash(str('FRONTEND_URL', 'http://localhost:3000'));
  },
  /** Extra browser origins allowed to call the private API with credentials. */
  get CORS_ORIGINS(): string[] {
    return list('CORS_ORIGINS').map(stripTrailingSlash);
  },
  get MONGODB_URI(): string {
    return str('MONGODB_URI') || str('DATABASE_URL') || 'mongodb://localhost:27017/socialmediaautomate';
  },

  // --- Auth & secrets -------------------------------------------------------
  get SESSION_SECRET(): string {
    return str('SESSION_SECRET');
  },
  /** Key material for encrypting stored access tokens / webhook secrets (falls back to SESSION_SECRET). */
  get ENCRYPTION_KEY(): string {
    return str('ENCRYPTION_KEY');
  },
  get COOKIE_SAMESITE(): CookieSameSite {
    return cookieSameSite();
  },
  /** Browsers reject `SameSite=None` cookies without `Secure`, so 'none' always forces it. */
  get COOKIE_SECURE(): boolean {
    if (cookieSameSite() === 'none') return true;
    return bool('COOKIE_SECURE', isProduction());
  },

  // --- AI (Anthropic) -------------------------------------------------------
  get ANTHROPIC_API_KEY(): string {
    return str('ANTHROPIC_API_KEY');
  },
  get AI_MODEL(): string {
    return str('AI_MODEL', 'claude-3-5-haiku-20241022');
  },
  get AI_MODEL_FAST(): string {
    return str('AI_MODEL_FAST', 'claude-3-5-haiku-20241022');
  },
  /** USD value of one AI credit (raw model cost). */
  get AI_CREDIT_USD(): number {
    const value = num('AI_CREDIT_USD', 0.005);
    return value > 0 ? value : 0.005;
  },

  // --- Billing (Razorpay) ---------------------------------------------------
  get RAZORPAY_KEY_ID(): string {
    return str('RAZORPAY_KEY_ID');
  },
  get RAZORPAY_KEY_SECRET(): string {
    return str('RAZORPAY_KEY_SECRET');
  },
  get RAZORPAY_WEBHOOK_SECRET(): string {
    return str('RAZORPAY_WEBHOOK_SECRET');
  },
  /** 'live' talks to Razorpay; 'dev' simulates checkout. Defaults to 'live' only when Razorpay keys exist. */
  get BILLING_MODE(): BillingMode {
    const raw = str('BILLING_MODE').toLowerCase();
    if (raw === 'live' || raw === 'dev') return raw;
    return razorpayConfigured() ? 'live' : 'dev';
  },

  // --- Invoice supplier details (GST) ---------------------------------------
  get COMPANY_NAME(): string {
    return str('COMPANY_NAME', 'BharatAutomate');
  },
  get COMPANY_GSTIN(): string {
    return str('COMPANY_GSTIN');
  },
  /** Two-digit GST state code of the supplier, e.g. '29' (Karnataka). Decides CGST+SGST vs IGST. */
  get COMPANY_STATE_CODE(): string {
    return str('COMPANY_STATE_CODE');
  },
  get COMPANY_ADDRESS(): string {
    return str('COMPANY_ADDRESS');
  },
  get COMPANY_EMAIL(): string {
    return str('COMPANY_EMAIL');
  },

  // --- Meta / Instagram -----------------------------------------------------
  get META_APP_ID(): string {
    return str('META_APP_ID');
  },
  get META_APP_SECRET(): string {
    return str('META_APP_SECRET');
  },
  get META_REDIRECT_URI(): string {
    return str('META_REDIRECT_URI');
  },
  get INSTAGRAM_APP_ID(): string {
    return str('INSTAGRAM_APP_ID');
  },
  get INSTAGRAM_APP_SECRET(): string {
    return str('INSTAGRAM_APP_SECRET');
  },
  get INSTAGRAM_SCOPES(): string {
    return str('INSTAGRAM_SCOPES');
  },
  get META_WEBHOOK_VERIFY_TOKEN(): string {
    return str('META_WEBHOOK_VERIFY_TOKEN');
  },

  // --- Background work ------------------------------------------------------
  /** Run the in-process job worker (disable on extra web replicas). */
  get JOBS_ENABLED(): boolean {
    return bool('JOBS_ENABLED', true);
  },
};

export type Env = typeof env;
