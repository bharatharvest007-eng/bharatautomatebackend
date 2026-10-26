/**
 * In-app notifications for the header bell (`/api/notifications`).
 * A member sees workspace-wide notifications plus the ones addressed to them;
 * read state of workspace-wide notifications is shared by the team.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as models from '../models/index.js';
import { notFound, sendError } from '../lib/http.js';
import { authOrgId } from '../lib/scope.js';
import { parseParams, parseQuery, zBoolish } from '../lib/validate.js';
import { countUnreadNotifications, visibleTo } from '../services/notify.js';
const router = Router();
const listQuery = z.object({
    unreadOnly: zBoolish.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});
const idParams = z.object({ id: z.string().min(1).max(100) });
// List notifications
router.get('/', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const userId = req.auth?.userId ?? '';
        const query = parseQuery(listQuery, req.query);
        const filter = visibleTo(orgId, userId);
        if (query.unreadOnly)
            filter.readAt = null;
        const [notifications, unreadCount] = await Promise.all([
            models.Notification.find(filter)
                .sort({ createdAt: -1 })
                .limit(query.limit ?? 30),
            countUnreadNotifications(orgId, userId),
        ]);
        return res.json({ ok: true, notifications, unreadCount });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Mark all notifications read (registered before /:id so 'read-all' is never taken as an id)
router.post('/read-all', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const userId = req.auth?.userId ?? '';
        const result = await models.Notification.updateMany({ ...visibleTo(orgId, userId), readAt: null }, { $set: { readAt: new Date() } });
        return res.json({ ok: true, updated: result.modifiedCount, unreadCount: 0 });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Mark one notification read
router.post('/:id/read', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const userId = req.auth?.userId ?? '';
        const { id } = parseParams(idParams, req.params);
        const notification = await models.Notification.findOneAndUpdate({ ...visibleTo(orgId, userId), _id: id }, [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }], { returnDocument: 'after' });
        if (!notification)
            throw notFound('Notification not found');
        const unreadCount = await countUnreadNotifications(orgId, userId);
        return res.json({ ok: true, notification, unreadCount });
    }
    catch (error) {
        return sendError(res, error);
    }
});
export default router;
