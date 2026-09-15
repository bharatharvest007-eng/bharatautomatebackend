import { Router } from 'express';
import * as models from '../models/index.js';
const router = Router();
// List trial reels
router.get('/', async (req, res) => {
    try {
        const automations = await models.Automation.find({ 'trigger.isTrialReel': true });
        return res.json({ ok: true, trialReels: automations });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Create trial reel automation
router.post('/', async (req, res) => {
    try {
        const { name, firstCommentText, dmResourceText, accountId } = req.body;
        const org = await models.Organization.findOne();
        let targetAccountId = accountId;
        if (!targetAccountId) {
            const acc = await models.SocialAccount.findOne();
            targetAccountId = acc ? acc._id : 'acc_default';
        }
        const autoId = `tr_${Date.now().toString(36)}`;
        const trialReel = await models.Automation.create({
            _id: autoId,
            orgId: org ? org._id : 'org_workspace',
            accountId: targetAccountId,
            name: name || 'Trial Reel Automation',
            status: 'live',
            trigger: {
                type: 'comment_any_reel',
                isTrialReel: true,
                keywords: [],
                matchMode: 'contains',
            },
            steps: [
                {
                    type: 'first_comment',
                    text: firstCommentText || 'Comment "ACCESS" below to get the direct blueprint in your DMs! 🚀',
                },
                {
                    type: 'ask_for_follow',
                    followPromptText: 'Please follow this page to unlock the link! Tap below when done: 🌟',
                },
                {
                    type: 'send_dm',
                    text: dmResourceText || 'Here is your trial reel exclusive resource: https://example.com/guide',
                },
            ],
            metrics: { sentCount: 0, clickCount: 0, leadCount: 0 },
        });
        return res.status(201).json({ ok: true, trialReel });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
