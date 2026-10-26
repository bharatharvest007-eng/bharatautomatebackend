/**
 * Short links: CRUD + stats (private) and the public `/r/:slug` redirect.
 * Owner: D8 Campaigns. Placeholder so the app compiles; the owner replaces it.
 */
import { Router, type Request, type Response } from 'express';
import { notFound, sendError } from '../lib/http.js';

const router = Router();

/** Public redirect handler mounted at `GET /r/:slug` in app.ts. */
export async function redirectShortLink(_req: Request, res: Response): Promise<Response> {
  return sendError(res, notFound('Link not found'));
}

export default router;
