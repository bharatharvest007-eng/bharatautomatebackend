/**
 * Express application: middleware order and router mounting.
 *
 * Order matters:
 * 1. security headers for every response;
 * 2. open CORS for the embeddable widget and the API-key REST API, applied
 *    before the credentialed allowlist so those paths stay callable from any site;
 * 3. the dashboard CORS allowlist;
 * 4. body parsing that keeps the raw bytes for webhook signature checks;
 * 5. routers — public/mixed ones guard their private routes themselves,
 *    private ones are mounted behind `requireAuth`;
 * 6. JSON 404 and the shared error handler.
 */
import './config/env.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { securityHeaders, corsAllowlist, publicCors } from './middleware/security.js';
import { requireAuth, requireSessionAuth, optionalAuth } from './middleware/auth.js';
import { notFound, sendError } from './lib/http.js';
import { jobWorkerRunning } from './services/jobs.js';

// Public / mixed routers
import authRoutes from './routes/auth.routes.js';
import metaRoutes from './routes/meta.routes.js';
import bioRoutes from './routes/bio.routes.js';
import widgetRoutes from './routes/widget.routes.js';
import leadFormsRoutes from './routes/leadForms.routes.js';
import linksRoutes, { redirectShortLink } from './routes/links.routes.js';
import billingRoutes from './routes/billing.routes.js';
import publicApiRoutes from './routes/publicApi.routes.js';

// Private routers
import accountsRoutes from './routes/accounts.routes.js';
import automationsRoutes from './routes/automations.routes.js';
import templatesRoutes from './routes/templates.routes.js';
import contactsRoutes from './routes/contacts.routes.js';
import leadsRoutes from './routes/leads.routes.js';
import inboxRoutes from './routes/inbox.routes.js';
import aiRoutes from './routes/ai.routes.js';
import smartRoutes from './routes/smart.routes.js';
import rewindRoutes from './routes/rewind.routes.js';
import trialReelsRoutes from './routes/trialReels.routes.js';
import essentialsRoutes from './routes/essentials.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import mediaRoutes from './routes/media.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import facebookRoutes from './routes/facebook.routes.js';
import broadcastsRoutes from './routes/broadcasts.routes.js';
import remindersRoutes from './routes/reminders.routes.js';
import crossChannelRoutes from './routes/crossChannel.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import usageRoutes from './routes/usage.routes.js';
import teamRoutes from './routes/team.routes.js';
import apiKeysRoutes from './routes/apiKeys.routes.js';
import webhookEndpointsRoutes from './routes/webhookEndpoints.routes.js';
import auditRoutes from './routes/audit.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';
import approvalsRoutes from './routes/approvals.routes.js';
import contentRoutes from './routes/content.routes.js';
import postsRoutes from './routes/posts.routes.js';
import insightsRoutes from './routes/insights.routes.js';
import competitorsRoutes from './routes/competitors.routes.js';
import farmboxRoutes from './routes/farmbox.routes.js';

export const app = express();

// One reverse proxy (Render / Vercel edge) in front: makes req.ip the real client IP for rate limits.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(securityHeaders);
app.use('/api/widget', publicCors);
app.use('/api/v1', publicCors);
app.use(corsAllowlist);

app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb',
    verify: (req, _res, buf) => {
      if (!(req as Request).rawBody) {
        (req as Request).rawBody = buf;
      }
    },
  }),
);
app.use(cookieParser());

// Health check (used by the hosting platform; never requires auth)
app.get('/api/health', (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.json({
    ok: true,
    status: dbUp ? 'online' : 'degraded',
    db: dbUp ? 'up' : 'down',
    jobs: jobWorkerRunning() ? 'running' : 'stopped',
    timestamp: new Date().toISOString(),
  });
});

// --- Public / mixed routers (private routes inside apply requireAuth themselves) ---
app.use('/api/auth', authRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/bio', bioRoutes);
app.use('/api/widget', widgetRoutes);
app.use('/api/lead-forms', leadFormsRoutes);
app.use('/api/links', linksRoutes);
app.get('/r/:slug', redirectShortLink);
app.use('/api/billing', billingRoutes);
app.use('/api/v1', publicApiRoutes);
app.use('/api/farmbox', farmboxRoutes);

// --- Private routers -------------------------------------------------------------
app.use('/api/accounts', requireAuth, accountsRoutes);
app.use('/api/automations', requireAuth, automationsRoutes);
app.use('/api/templates', requireAuth, templatesRoutes);
app.use('/api/contacts', requireAuth, contactsRoutes);
app.use('/api/leads', requireAuth, leadsRoutes);
app.use('/api/inbox', requireAuth, inboxRoutes);
app.use('/api/ai', requireAuth, aiRoutes);
app.use('/api/smart', requireAuth, smartRoutes);
app.use('/api/rewind', requireAuth, rewindRoutes);
app.use('/api/trial-reels', requireAuth, trialReelsRoutes);
app.use('/api/essentials', requireAuth, essentialsRoutes);
app.use('/api/analytics', requireAuth, analyticsRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/media', requireAuth, mediaRoutes);
app.use('/api/whatsapp', requireAuth, whatsappRoutes);
app.use('/api/facebook', requireAuth, facebookRoutes);
app.use('/api/broadcasts', requireAuth, broadcastsRoutes);
app.use('/api/reminders', requireAuth, remindersRoutes);
app.use('/api/cross-channel', requireAuth, crossChannelRoutes);
app.use('/api/notifications', requireAuth, notificationsRoutes);
app.use('/api/usage', requireAuth, usageRoutes);
// Workspace administration never accepts API keys (a leaked key must not mint keys or invite members).
app.use('/api/team', requireAuth, requireSessionAuth, teamRoutes);
app.use('/api/api-keys', requireAuth, requireSessionAuth, apiKeysRoutes);
app.use('/api/webhook-endpoints', requireAuth, requireSessionAuth, webhookEndpointsRoutes);
app.use('/api/audit', requireAuth, auditRoutes);
app.use('/api/knowledge', optionalAuth, knowledgeRoutes);
app.use('/api/approvals', optionalAuth, approvalsRoutes);
app.use('/api/content', optionalAuth, contentRoutes);
app.use('/api/posts', optionalAuth, postsRoutes);
app.use('/api/insights', optionalAuth, insightsRoutes);
app.use('/api/competitors', requireAuth, competitorsRoutes);

// 404 for anything unmatched
app.use((req: Request, res: Response) => sendError(res, notFound(`Route not found: ${req.method} ${req.path}`)));

// Error handler (Express recognizes it by the 4-argument signature)
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  sendError(res, error);
});
