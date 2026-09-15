import { Router } from 'express';
import * as models from '../models/index.js';

const router = Router();

/** Due-or-upcoming reminders — what the inbox badges/lists against a conversation. */
router.get('/', async (req, res) => {
  try {
    const org = await models.Organization.findOne();
    const query: Record<string, unknown> = org ? { orgId: org._id } : {};
    if (req.query.conversationId) query.conversationId = req.query.conversationId;
    if (req.query.dueOnly === 'true') query.doneAt = { $exists: false };

    const reminders = await models.Reminder.find(query).sort({ remindAt: 1 }).limit(200);
    return res.json({ ok: true, reminders });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { conversationId, note, remindAt, userId } = req.body;
    if (!conversationId || !note || !remindAt) {
      return res.status(400).json({ error: 'conversationId, note and remindAt are required' });
    }

    const conversation = await models.Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const reminder = await models.Reminder.create({
      _id: `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      orgId: conversation.orgId,
      conversationId,
      userId,
      note,
      remindAt: new Date(remindAt),
    });

    return res.status(201).json({ ok: true, reminder });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/done', async (req, res) => {
  try {
    const reminder = await models.Reminder.findByIdAndUpdate(
      req.params.id,
      { $set: { doneAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    return res.json({ ok: true, reminder });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await models.Reminder.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Reminder not found' });
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
