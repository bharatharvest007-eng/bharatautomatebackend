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
import mediaRoutes from './routes/media.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import facebookRoutes from './routes/facebook.routes.js';
import broadcastsRoutes from './routes/broadcasts.routes.js';
import widgetRoutes from './routes/widget.routes.js';
import remindersRoutes from './routes/reminders.routes.js';

export const app = express();

// Bulletproof CORS Middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With, Accept, Origin');
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(
  cors({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With', 'Accept', 'Origin'],
  })
);

app.options('*', cors());

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
app.use('/api/media', mediaRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/facebook', facebookRoutes);
app.use('/api/broadcasts', broadcastsRoutes);
app.use('/api/widget', widgetRoutes);
app.use('/api/reminders', remindersRoutes);

// Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Express Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});
