import { Router } from 'express';
import * as models from '../models/index.js';
import { MetaService } from '../services/metaService.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { authOrgId } from '../lib/scope.js';
import { accountToken } from '../lib/crypto.js';

const router = Router();

// List DM conversations for current organization
router.get('/conversations', async (req, res) => {
  try {
    const orgId = authOrgId(req);
    const conversations = await models.Conversation.find({ orgId })
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .lean();

    // Fetch contact details in bulk
    const contactIds = conversations.map((c) => c.contactId);
    const contacts = await models.Contact.find({ _id: { $in: contactIds }, orgId }).lean();
    const contactMap = new Map(contacts.map((c) => [c._id, c]));

    const enriched = conversations.map((c: any) => {
      const contact = contactMap.get(c.contactId);
      return {
        ...c,
        contactUsername: contact?.username || contact?.name || (contact as any)?.waId || 'Customer',
        contactName: contact?.name || contact?.username,
        contactPhone: contact?.phone || (contact as any)?.waId,
        contactAvatar: contact?.avatarUrl,
        lastMessageSnippet: c.lastMessagePreview || 'Conversation active',
      };
    });

    return res.json({ ok: true, conversations: enriched });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get messages for a specific conversation (strictly scoped to caller's org)
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const orgId = authOrgId(req);
    const conversation = await models.Conversation.findOne({ _id: req.params.id, orgId });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const messages = await models.Message.find({ conversationId: conversation._id, orgId }).sort({
      createdAt: 1,
    });
    return res.json({ ok: true, messages });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Send live message in a conversation (supports Instagram, WhatsApp, and Facebook)
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message text is required' });

    const orgId = authOrgId(req);
    const conversation = await models.Conversation.findOne({ _id: req.params.id, orgId });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const account = await models.SocialAccount.findOne({ _id: conversation.accountId, orgId });
    if (!account) return res.status(404).json({ error: 'Associated social account not found' });

    const contact = await models.Contact.findOne({ _id: conversation.contactId, orgId });
    const token = accountToken(account);

    const humanAgentActive = conversation.humanAgentUntil && new Date(conversation.humanAgentUntil) > new Date();

    let sendRes: any = null;

    if (account.platform === 'whatsapp') {
      const recipient = (contact as any)?.waId || contact?.phone || contact?.igsid;
      if (!account.phoneNumberId || !recipient) {
        return res.status(400).json({ error: 'WhatsApp phone number ID or recipient phone missing' });
      }
      sendRes = await WhatsAppService.sendText(account.phoneNumberId, recipient, text.trim(), token);
    } else if (account.platform === 'facebook') {
      const recipient = contact?.igsid || contact?.username || '';
      sendRes = await MetaService.sendDirectMessage({
        recipientIgsid: recipient,
        accessToken: token,
        text: text.trim(),
        tag: humanAgentActive ? 'HUMAN_AGENT' : undefined,
      });
    } else {
      // Instagram
      const recipient = contact?.igsid || contact?.username || '';
      sendRes = await MetaService.sendDirectMessage({
        recipientIgsid: recipient,
        accessToken: token,
        text: text.trim(),
        tag: humanAgentActive ? 'HUMAN_AGENT' : undefined,
      });
    }

    const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const msg = await models.Message.create({
      _id: msgId,
      orgId,
      accountId: conversation.accountId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      direction: 'out',
      type: 'text',
      text: text.trim(),
      status: sendRes?.success ? 'sent' : 'failed',
      error: sendRes?.success ? undefined : (sendRes?.error || 'Send failed'),
      externalId: sendRes?.messageId || sendRes?.data?.message_id,
      sentAt: new Date(),
    });

    conversation.lastMessageAt = new Date();
    conversation.lastOutboundAt = new Date();
    conversation.lastMessagePreview = text.trim().slice(0, 120);
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
    const orgId = authOrgId(req);
    const conversation = await models.Conversation.findOne({ _id: req.params.id, orgId });
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
