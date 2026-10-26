/**
 * Plan, usage and badge counts for the dashboard shell (`/api/usage`).
 * The AuthProvider polls this every 60s to keep sidebar meters and badges fresh.
 */
import { Router } from 'express';
import * as models from '../models/index.js';
import { sendError } from '../lib/http.js';
import { authOrgId } from '../lib/scope.js';
import { getEntitlements, getUsageSummary } from '../services/entitlements.js';
import { countUnreadNotifications } from '../services/notify.js';
const router = Router();
// Get entitlements, usage and badge counts
router.get('/', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const userId = req.auth?.userId ?? '';
        const [entitlements, usage, inboxUnread, pendingApprovals, unreadNotifications] = await Promise.all([
            getEntitlements(orgId),
            getUsageSummary(orgId),
            models.Conversation.countDocuments({ orgId, isRead: false, status: { $ne: 'closed' } }),
            // Expired-but-not-yet-swept approvals cannot be acted on, so they do not count toward the badge.
            models.AiApproval.countDocuments({
                orgId,
                status: 'pending',
                $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
            }),
            countUnreadNotifications(orgId, userId),
        ]);
        return res.json({ ok: true, entitlements, usage, counts: { inboxUnread, pendingApprovals, unreadNotifications } });
    }
    catch (error) {
        return sendError(res, error);
    }
});
export default router;
