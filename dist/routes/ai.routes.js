import { Router } from 'express';
import * as models from '../models/index.js';
import { AiService } from '../services/aiService.js';
const router = Router();
// Get Brand Voice settings
router.get('/brand-voice', async (req, res) => {
    try {
        const org = await models.Organization.findOne();
        const voice = await models.BrandVoice.findOne(org ? { orgId: org._id } : {});
        return res.json({
            ok: true,
            brandVoice: voice || {
                personaName: 'Creator Studio Voice',
                tone: 'Warm, engaging, and enthusiastic',
                guidelines: 'Reply concisely with 1 emoji. Always offer clear value and encourage DMs.',
                sampleReplies: [
                    'Thank you so much! Sending you the full link right now in DMs! 🚀',
                    'Appreciate you checking out the video! Check your inbox for the guide ✨',
                ],
                forbiddenWords: ['crypto', 'invest', 'click link in bio'],
            },
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Update Brand Voice settings
router.put('/brand-voice', async (req, res) => {
    try {
        const { personaName, tone, guidelines, sampleReplies, forbiddenWords } = req.body;
        const org = await models.Organization.findOne();
        const orgId = org ? org._id : 'org_workspace';
        const voice = await models.BrandVoice.findOneAndUpdate({ orgId }, {
            $set: {
                personaName,
                tone,
                guidelines,
                sampleReplies,
                forbiddenWords,
            },
        }, { upsert: true, returnDocument: 'after' });
        return res.json({ ok: true, brandVoice: voice });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Live test AI reply simulation
router.post('/test-reply', async (req, res) => {
    try {
        const { commentText, postCaption } = req.body;
        if (!commentText)
            return res.status(400).json({ error: 'Comment text is required' });
        const org = await models.Organization.findOne();
        const voice = await models.BrandVoice.findOne(org ? { orgId: org._id } : {});
        const result = await AiService.generateCommentReply(commentText, postCaption || '', voice || {});
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Classify comment spam & toxicity
router.post('/classify-spam', async (req, res) => {
    try {
        const { commentText } = req.body;
        if (!commentText)
            return res.status(400).json({ error: 'Comment text is required' });
        const result = await AiService.classifySpam(commentText);
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// AI Usage stats
router.get('/stats', async (req, res) => {
    try {
        const totalAiTokens = await models.AiUsage.countDocuments();
        return res.json({
            ok: true,
            stats: {
                totalRepliesGenerated: totalAiTokens,
                spamCommentsBlocked: 0,
                creditsRemaining: 'Unlimited (Paid Tier)',
            },
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
