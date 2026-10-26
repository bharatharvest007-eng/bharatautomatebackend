import { Router } from 'express';
import * as models from '../models/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { getStatSeries } from '../services/stats.js';
const router = Router();
async function resolveOrgId(req) {
    if (req.auth?.orgId)
        return req.auth.orgId;
    const org = await models.Organization.findOne();
    return org ? org._id : 'org_workspace';
}
// Overview metrics
router.get('/overview', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const [accountsCount, automationsCount, contactsCount, leadsCount, outboundMessagesCount, inboundMessagesCount, publishedPostsCount, commentsCount, wonLeadsCount,] = await Promise.all([
            models.SocialAccount.countDocuments({ orgId, status: 'active' }),
            models.Automation.countDocuments({ orgId, status: 'live' }),
            models.Contact.countDocuments({ orgId }),
            models.LeadSubmission.countDocuments({ orgId }),
            models.Message.countDocuments({ orgId, direction: 'out' }),
            models.Message.countDocuments({ orgId, direction: 'in' }),
            models.ScheduledPost.countDocuments({ orgId, status: 'published' }),
            models.CommentLog.countDocuments({ orgId }),
            models.LeadSubmission.countDocuments({ orgId, status: 'won' }),
        ]);
        // Sum automation runs and clicks
        const automations = await models.Automation.find({ orgId }).lean();
        let totalDmsSentFromAutomations = 0;
        let totalClicks = 0;
        for (const a of automations) {
            totalDmsSentFromAutomations += a.sentCount || 0;
            totalClicks += a.clickCount || 0;
        }
        const totalDmsSent = Math.max(outboundMessagesCount, totalDmsSentFromAutomations);
        const conversionRate = totalDmsSent > 0 ? ((leadsCount / totalDmsSent) * 100).toFixed(1) : '0.0';
        // Daily limit calculation
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sentToday = await models.Message.countDocuments({
            orgId,
            direction: 'out',
            sentAt: { $gte: today },
        });
        return res.json({
            ok: true,
            metrics: {
                totalDmsSent,
                inboundMessages: inboundMessagesCount,
                activeAutomations: automationsCount,
                connectedAccounts: accountsCount,
                totalContacts: contactsCount,
                leadsCaptured: leadsCount,
                wonOrders: wonLeadsCount,
                linkClicks: totalClicks,
                publishedPosts: publishedPostsCount,
                totalComments: commentsCount,
                conversionRate: `${conversionRate}%`,
                aiCreditsRemaining: 'Unlimited (Paid Tier)',
                dailyLimitStatus: `${sentToday.toLocaleString()} / 5,000 sent today`,
            },
        });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// Timeseries for charts
router.get('/timeseries', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const range = req.query.range || '7d';
        let daysCount = 7;
        if (range === '14d')
            daysCount = 14;
        else if (range === '30d')
            daysCount = 30;
        else if (range === '90d')
            daysCount = 90;
        const to = new Date();
        const from = new Date(to.getTime() - (daysCount - 1) * 24 * 60 * 60 * 1000);
        const metrics = ['dms_sent', 'comments_received', 'leads_captured', 'link_clicks', 'inbound_messages'];
        const rawSeries = await getStatSeries(orgId, metrics, from, to);
        // Also aggregate from Message and LeadSubmission for live accuracy
        const messagesByDay = await models.Message.aggregate([
            {
                $match: {
                    orgId,
                    sentAt: { $gte: from, $lte: to },
                },
            },
            {
                $group: {
                    _id: {
                        day: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
                        direction: '$direction',
                    },
                    count: { $sum: 1 },
                },
            },
        ]);
        const leadsByDay = await models.LeadSubmission.aggregate([
            {
                $match: {
                    orgId,
                    createdAt: { $gte: from, $lte: to },
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                },
            },
        ]);
        const msgOutMap = new Map();
        const msgInMap = new Map();
        for (const m of messagesByDay) {
            if (m._id.direction === 'out')
                msgOutMap.set(m._id.day, m.count);
            else
                msgInMap.set(m._id.day, m.count);
        }
        const leadMap = new Map();
        for (const l of leadsByDay) {
            leadMap.set(l._id, l.count);
        }
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const timeseries = rawSeries.map((s) => {
            const dateObj = new Date(s.day);
            const dayName = daysCount <= 7 ? dayNames[dateObj.getDay()] : s.day.slice(5);
            const dmsFromStat = s.values.dms_sent || 0;
            const dmsFromMsg = msgOutMap.get(s.day) || 0;
            const dms = Math.max(dmsFromStat, dmsFromMsg);
            const leadsFromStat = s.values.leads_captured || 0;
            const leadsFromDb = leadMap.get(s.day) || 0;
            const leads = Math.max(leadsFromStat, leadsFromDb);
            const comments = s.values.comments_received || 0;
            const clicks = s.values.link_clicks || 0;
            const inbound = Math.max(s.values.inbound_messages || 0, msgInMap.get(s.day) || 0);
            return {
                date: s.day,
                name: dayName,
                dms,
                comments,
                leads,
                clicks,
                inbound,
            };
        });
        return res.json({ ok: true, timeseries, range });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// Conversion Funnel
router.get('/funnel', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const [commentsTotal, inboundsTotal, dmsTotal, leadsTotal, wonTotal] = await Promise.all([
            models.CommentLog.countDocuments({ orgId }),
            models.Message.countDocuments({ orgId, direction: 'in' }),
            models.Message.countDocuments({ orgId, direction: 'out' }),
            models.LeadSubmission.countDocuments({ orgId }),
            models.LeadSubmission.countDocuments({ orgId, status: 'won' }),
        ]);
        const reach = Math.max(commentsTotal + inboundsTotal, 1);
        const engaged = Math.max(dmsTotal, 0);
        const captured = Math.max(leadsTotal, 0);
        const converted = Math.max(wonTotal, 0);
        const stages = [
            {
                stage: 'Inbound Reach',
                count: reach,
                description: 'Customer comments and incoming inquiries',
                pctOfTop: 100,
            },
            {
                stage: 'Automated DMs & Replies',
                count: engaged,
                description: 'Automated harvest boxes, links & replies sent',
                pctOfTop: reach > 0 ? Math.min(100, Math.round((engaged / reach) * 100)) : 0,
            },
            {
                stage: 'Leads Captured',
                count: captured,
                description: 'Verified phone numbers & emails captured',
                pctOfTop: reach > 0 ? Math.min(100, Math.round((captured / reach) * 100)) : 0,
            },
            {
                stage: 'Converted Orders',
                count: converted,
                description: 'Orders completed and delivered',
                pctOfTop: reach > 0 ? Math.min(100, Math.round((converted / reach) * 100)) : 0,
            },
        ];
        return res.json({ ok: true, stages });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// Channel breakdown (WhatsApp vs Instagram vs Facebook)
router.get('/channels', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const accounts = await models.SocialAccount.find({ orgId }).lean();
        const channels = await Promise.all(accounts.map(async (acc) => {
            const [contacts, messagesSent, messagesReceived] = await Promise.all([
                models.Contact.countDocuments({ orgId, accountId: acc._id }),
                models.Message.countDocuments({ orgId, accountId: acc._id, direction: 'out' }),
                models.Message.countDocuments({ orgId, accountId: acc._id, direction: 'in' }),
            ]);
            return {
                accountId: acc._id,
                platform: acc.platform,
                username: acc.username || acc.name,
                contacts,
                messagesSent,
                messagesReceived,
                status: acc.status,
            };
        }));
        return res.json({ ok: true, channels });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
export default router;
