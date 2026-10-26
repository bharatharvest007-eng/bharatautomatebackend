/**
 * Global Express request augmentation.
 * - `auth`: set by `requireAuth` / `optionalAuth` / `requireApiKey`.
 * - `rawBody`: the exact request bytes captured by `express.json({ verify })`,
 *   needed to verify Meta and Razorpay webhook HMAC signatures.
 */
import type { AuthContext } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      rawBody?: Buffer;
    }
  }
}

export {};
