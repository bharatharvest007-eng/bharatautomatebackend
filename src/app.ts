import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

// Routes
import authRoutes from './routes/auth.routes.js';
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
import bioRoutes from './routes/bio.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import metaRoutes from './routes/meta.routes.js';

export const app = express();

// Middleware
app.use(
  cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'online',
    framework: 'Express.js',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/smart', smartRoutes);
app.use('/api/rewind', rewindRoutes);
app.use('/api/trial-reels', trialReelsRoutes);
app.use('/api/essentials', essentialsRoutes);
app.use('/api/bio', bioRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/meta', metaRoutes);

// Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Express Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});
