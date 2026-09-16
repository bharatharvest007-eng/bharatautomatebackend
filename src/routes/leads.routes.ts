import { Router } from 'express';
import * as models from '../models/index.js';

const router = Router();

// List captured leads — optionally scoped to one platform (e.g. WhatsApp) or one account.
router.get('/', async (req, res) => {
  try {
    const { platform, accountId } = req.query;
    const query: Record<string, unknown> = {};

    if (accountId) {
      query.accountId = accountId;
    } else if (platform) {
      const accounts = await models.SocialAccount.find({ platform: String(platform) }, { _id: 1 }).lean();
      query.accountId = { $in: accounts.map((a: any) => a._id) };
    }

    const leads = await models.LeadSubmission.find(query).sort({ createdAt: -1 }).limit(200);
    const total = await models.LeadSubmission.countDocuments(query);
    return res.json({ ok: true, leads, total });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Export Leads as CSV
router.get('/export', async (req, res) => {
  try {
    const leads = await models.LeadSubmission.find().sort({ createdAt: -1 });
    const headers = 'ID,LeadCardID,ContactID,Values,Status,CapturedAt\n';
    const rows = leads
      .map(
        (l: any) =>
          `"${l._id}","${l.leadCardId}","${l.contactId}","${JSON.stringify(l.values || {}).replace(/"/g, '""')}","${l.status || 'new'}","${l.createdAt ? l.createdAt.toISOString() : ''}"`
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    return res.send(headers + rows);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update lead status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const lead = await models.LeadSubmission.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { returnDocument: 'after' }
    );
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    return res.json({ ok: true, lead });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
