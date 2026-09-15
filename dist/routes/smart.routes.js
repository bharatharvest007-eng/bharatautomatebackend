import { Router } from 'express';
import * as models from '../models/index.js';
const router = Router();
// Get Smart Stack settings
router.get('/settings', async (req, res) => {
    try {
        const org = await models.Organization.findOne();
        const settings = org?.settings || {};
        return res.json({
            ok: true,
            settings: {
                autoCommentReply: settings.autoCommentReply ?? true,
                viralPostProtection: settings.viralPostProtection ?? true,
                spamAutoDelete: settings.spamAutoDelete ?? true,
                storyMentionAutoReply: settings.storyMentionAutoReply ?? true,
                askForFollowDefault: settings.askForFollowDefault ?? true,
                maxCommentsPerHour: settings.maxCommentsPerHour ?? 120,
                replyDelaySeconds: settings.replyDelaySeconds ?? 3,
            },
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Update Smart Stack settings
router.put('/settings', async (req, res) => {
    try {
        const newSettings = req.body;
        const org = await models.Organization.findOne();
        if (!org)
            return res.status(404).json({ error: 'Organization not found' });
        org.settings = { ...org.settings, ...newSettings };
        await org.save();
        return res.json({ ok: true, settings: org.settings });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Get Smart Stack stats
router.get('/stats', async (req, res) => {
    try {
        const totalCommentsHandled = await models.CommentLog.countDocuments();
        return res.json({
            ok: true,
            stats: {
                commentsHandled: totalCommentsHandled,
                viralVelocityTriggered: 0,
                spamCommentsHidden: 0,
                safePacingActive: true,
            },
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
