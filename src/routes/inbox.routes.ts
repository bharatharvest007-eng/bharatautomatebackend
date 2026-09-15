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

    // A human is replying live, inside the 24h window or extended by the
    // HUMAN_AGENT tag — either way this is a manual send, not automation output.
    const humanAgentActive = conversation.humanAgentUntil && new Date(conversation.humanAgentUntil) > new Date();

    let sendRes: any = null;
    if (contact && contact.igsid) {
      sendRes = await MetaService.sendDirectMessage({
        recipientIgsid: contact.igsid,
        accessToken: account.accessToken,
        text,
        tag: humanAgentActive ? 'HUMAN_AGENT' : undefined,
      });
    }

    const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const msg = await models.Message.create({
      _id: msgId,
      orgId: conversation.orgId,
      accountId: conversation.accountId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      direction: 'out',
      type: 'text',
      text,
      status: sendRes?.success ? 'sent' : 'failed',
      error: sendRes?.success ? undefined : sendRes?.error,
      externalId: sendRes?.data?.message_id,
      sentAt: new Date(),
    });

    conversation.lastMessageAt = new Date();
    conversation.lastOutboundAt = new Date();
    conversation.lastMessagePreview = text.slice(0, 120);
    conversation.messageCount = (conversation.messageCount ?? 0) + 1;
    await conversation.save();

    if (contact) {
      await models.Contact.updateOne(
        { _id: contact._id },
        { $set: { lastOutboundAt: new Date(), lastSeenAt: new Date() }, $inc: { messagesSent: 1 } },
      );
    }

    return res.json({ ok: true, message: msg, sendResult: sendRes });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Toggle Human Agent takeover (extending window to 7 days)
router.post('/conversations/:id/toggle-human', async (req, res) => {
  try {
    const conversation = await models.Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const isCurrentlyActive =
      conversation.humanAgentUntil && new Date(conversation.humanAgentUntil) > new Date();

    conversation.humanAgentUntil = isCurrentlyActive
      ? undefined
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days — Meta's HUMAN_AGENT tag window

    await conversation.save();
    return res.json({
      ok: true,
      isHumanAgentActive: !isCurrentlyActive,
      humanAgentUntil: conversation.humanAgentUntil,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
