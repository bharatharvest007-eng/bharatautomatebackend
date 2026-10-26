import { Router } from 'express';
import * as models from '../models/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { captureLead, normalizeEmail, normalizePhone } from '../services/leads.js';

const router = Router();

async function resolveOrgId(req: any): Promise<string> {
  if (req.auth?.orgId) return req.auth.orgId;
  const org = await models.Organization.findOne();
  return org ? org._id : 'org_workspace';
}

// List captured leads with search, platform filter, status filter, and pagination
router.get('/', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { platform, accountId, status, search, page = '1', limit = '100' } = req.query;

    const query: Record<string, unknown> = { orgId };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (accountId && accountId !== 'all') {
      query.accountId = accountId;
    } else if (platform && platform !== 'all') {
      const accounts = await models.SocialAccount.find({ orgId, platform: String(platform) }, { _id: 1 }).lean();
      query.accountId = { $in: accounts.map((a: any) => a._id) };
    }

    if (search && typeof search === 'string' && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { 'data.address': searchRegex },
        { 'data.item': searchRegex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [rawLeads, total] = await Promise.all([
      models.LeadSubmission.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      models.LeadSubmission.countDocuments(query),
    ]);

    // Format leads for both modern schema and existing UI compatibility
    const leads = rawLeads.map((l: any) => ({
      ...l,
      values: {
        ...(l.name ? { Name: l.name } : {}),
        ...(l.phone ? { Phone: l.phone } : {}),
        ...(l.email ? { Email: l.email } : {}),
        ...(l.data || {}),
      },
    }));

    return res.json({ ok: true, leads, total, page: pageNum, limit: limitNum });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Export Leads as CSV
router.get('/export', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { platform, status } = req.query;

    const query: Record<string, unknown> = { orgId };
    if (status && status !== 'all') query.status = status;

    if (platform && platform !== 'all') {
      const accounts = await models.SocialAccount.find({ orgId, platform: String(platform) }, { _id: 1 }).lean();
      query.accountId = { $in: accounts.map((a: any) => a._id) };
    }

    const leads = await models.LeadSubmission.find(query).sort({ createdAt: -1 }).lean();

    // Fetch accounts to map accountId to platform & handle
    const accounts = await models.SocialAccount.find({ orgId }).lean();
    const accountMap = new Map(accounts.map((a: any) => [a._id, a]));

    const headers = 'ID,Name,Phone,Email,Platform,Channel Handle,Source,Status,Captured At,Extra Data\n';
    const rows = leads
      .map((l: any) => {
        const acc = accountMap.get(l.accountId);
        const platformName = acc ? acc.platform : 'unknown';
        const handle = acc ? acc.username || acc.name || '' : '';
        const name = (l.name || '').replace(/"/g, '""');
        const phone = (l.phone || '').replace(/"/g, '""');
        const email = (l.email || '').replace(/"/g, '""');
        const extraData = JSON.stringify(l.data || {}).replace(/"/g, '""');
        const capturedAt = l.createdAt ? new Date(l.createdAt).toISOString() : '';

        return `"${l._id}","${name}","${phone}","${email}","${platformName}","${handle}","${l.source}","${l.status || 'new'}","${capturedAt}","${extraData}"`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="farmbox-leads.csv"');
    return res.send(headers + rows);
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Update lead status
router.patch('/:id/status', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { status } = req.body;
    const validStatuses = ['new', 'contacted', 'qualified', 'won', 'lost'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const lead = await models.LeadSubmission.findOneAndUpdate(
      { _id: req.params.id, orgId },
      { $set: { status } },
      { returnDocument: 'after' }
    );
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    return res.json({ ok: true, lead });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Create lead manually
router.post('/', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { accountId, name, phone, email, source = 'api', data, notes } = req.body;

    let targetAccountId = accountId;
    if (!targetAccountId) {
      const firstAcc = await models.SocialAccount.findOne({ orgId });
      targetAccountId = firstAcc ? firstAcc._id : 'acc_default';
    }

    const lead = await captureLead({
      orgId,
      accountId: targetAccountId,
      source: source as any,
      name,
      phone: normalizePhone(phone),
      email: normalizeEmail(email),
      data: { ...(data || {}), ...(notes ? { notes } : {}) },
    });

    return res.status(201).json({ ok: true, lead });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
