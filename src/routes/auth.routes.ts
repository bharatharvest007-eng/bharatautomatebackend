import { Router } from 'express';
import * as models from '../models/index.js';

const router = Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    let user = await models.User.findOne({ email });

    if (!user) {
      // If user doesn't exist, check if it's the default admin login
      if (email === 'admin@senddm.local' || email === 'demo@senddm.local') {
        const org = await models.Organization.findOne() || await models.Organization.create({
          _id: 'org_workspace',
          name: 'My Workspace',
          slug: 'workspace',
          plan: 'unlimited',
        });
        user = await models.User.create({
          _id: 'usr_admin',
          email,
          passwordHash: password || 'password123',
          name: 'Admin User',
          memberships: [{ orgId: org._id, role: 'owner' }],
        });
      } else {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
    }

    const orgId = user.memberships[0]?.orgId;
    const org = await models.Organization.findById(orgId);

    res.cookie('token', user._id, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.json({
      ok: true,
      user: { id: user._id, email: user.email, name: user.name },
      organization: org,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Current User / Session
router.get('/me', async (req, res) => {
  try {
    const user = await models.User.findOne();
    const org = await models.Organization.findOne();

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    return res.json({
      ok: true,
      user: { id: user._id, email: user.email, name: user.name },
      organization: org,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({ ok: true });
});

export default router;
