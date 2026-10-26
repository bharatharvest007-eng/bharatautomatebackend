/**
 * Authentication context attached to every authenticated request as `req.auth`
 * (see `src/types/express.d.ts` and `src/middleware/auth.ts`).
 */

/** Stored roles 'admin' and 'viewer' are legacy and normalize to 'owner' / 'member'. */
export type WorkspaceRole = 'owner' | 'member';

export type AuthVia = 'session' | 'api_key';

export type ApiKeyScope = 'read' | 'write';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: WorkspaceRole;
  via: AuthVia;
  /** Session `_id` (session auth only). */
  sessionId?: string;
  /** ApiKey `_id` (API-key auth only). */
  apiKeyId?: string;
  /** API-key scopes (API-key auth only). */
  scopes?: string[];
  /** Signed-in user's email; '' for API-key requests. */
  email: string;
  /** User name, or the API key's name for API-key requests. */
  name?: string;
}
