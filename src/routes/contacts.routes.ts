import { Router } from 'express';
import * as models from '../models/index.js';

const router = Router();

// List contacts
router.get('/', async (req, res) => {
  try {
    const { search, tag } = req.query;
    const query: Record<string, any> = {};

    if (search) {
      query.$or = [
        { username: { $regex: String(search), $options: 'i' } },
        { name: { $regex: String(search), $options: 'i' } },
        { email: { $regex: String(search), $options: 'i' } },
      ];
    }

    if (tag) {
      query.tags = String(tag);
    }

    const contacts = await models.Contact.find(query).sort({ lastInteractionAt: -1 }).limit(100);
    const total = await models.Contact.countDocuments(query);

    return res.json({ ok: true, contacts, total });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Export CSV
router.get('/export', async (req, res) => {
  try {
    const contacts = await models.Contact.find().sort({ lastInteractionAt: -1 });
    const headers = 'ID,Username,Name,Email,Phone,Follower,Tags,LastInteraction\n';
    const rows = contacts
      .map(
        (c: any) =>
          `"${c._id}","${c.username || ''}","${c.name || ''}","${c.email || ''}","${c.phone || ''}","${c.isFollower ? 'Yes' : 'No'}","${(c.tags || []).join(';')}","${c.lastInteractionAt ? c.lastInteractionAt.toISOString() : ''}"`
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    return res.send(headers + rows);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get contact
router.get('/:id', async (req, res) => {
  try {
    const contact = await models.Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    return res.json({ ok: true, contact });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update tags
router.post('/:id/tags', async (req, res) => {
  try {
    const { addTag, removeTag } = req.body;
    const update: any = {};
    if (addTag) update.$addToSet = { tags: addTag };
    if (removeTag) update.$pull = { tags: removeTag };

    const contact = await models.Contact.findByIdAndUpdate(req.params.id, update, {
      returnDocument: 'after',
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    return res.json({ ok: true, contact });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
