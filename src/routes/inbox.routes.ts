import { Router } from 'express';
import * as models from '../models/index.js';
import { MetaService } from '../services/metaService.js';

const router = Router();

// List DM conversations
router.get('/conversations', async (req, res) => {
  try {
    const org = await models.Organization.findOne();
    const conversations = await models.Conversation.find(org ? { orgId: org._id } : {})
      .sort({ lastMessageAt: -1 })
      .limit(50);
    return res.json({ ok: true, conversations });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get messages for a conversation
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const messages = await models.Message.find({ conversationId: req.params.id }).sort({
      createdAt: 1,
    });
    return res.json({ ok: true, messages });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Send live message in a conversation
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Message text is required' });

    const conversation = await models.Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const account = await models.SocialAccount.findById(conversation.accountId);
    if (!account) return res.status(404).json({ error: 'Associated Instagram account not found' });

    const contact = await models.Contact.findById(conversation.contactId);

    // Call Meta Graph API
    let metaRes: any = null;
    const convAny = conversation as any;
    if (contact && contact.igsid) {
      metaRes = await MetaService.sendDirectMessage({
        recipientIgsid: contact.igsid,
        accessToken: account.accessToken,
        text,
        tag: convAny.humanAgentUntil && new Date(convAny.humanAgentUntil) > new Date() ? 'HUMAN_AGENT' : undefined,
      });
    }

    const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const msg = await models.Message.create({
      _id: msgId,
      conversationId: conversation._id,
      direction: 'outbound',
      senderType: 'user',
      text,
      status: metaRes?.success ? 'delivered' : 'sent',
      createdAt: new Date(),
    });

    conversation.lastMessageAt = new Date();
    await conversation.save();

    return res.json({ ok: true, message: msg, metaResult: metaRes });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Toggle Human Agent takeover (extending window to 7 days)
router.post('/conversations/:id/toggle-human', async (req, res) => {
  try {
    const conversation = await models.Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const convAny = conversation as any;
    const isCurrentlyActive =
      convAny.humanAgentUntil && new Date(convAny.humanAgentUntil) > new Date();

    if (isCurrentlyActive) {
      convAny.humanAgentUntil = undefined;
    } else {
      convAny.humanAgentUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days Meta HUMAN_AGENT tag
    }

    await conversation.save();
    return res.json({
      ok: true,
      isHumanAgentActive: !isCurrentlyActive,
      humanAgentUntil: convAny.humanAgentUntil,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
