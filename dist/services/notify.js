/**
 * In-app notifications (the header bell).
 *
 * `notify` never throws: it is called from webhook handlers, jobs and quota
 * checks where a failed notification must not abort the real work. A
 * `dedupeKey` makes "once per period" alerts safe to fire repeatedly — the
 * unique {orgId, dedupeKey} index rejects the duplicate and we treat that as
 * "already sent".
 */
import * as models from '../models/index.js';
import { newId } from '../lib/ids.js';
const MAX_TITLE = 200;
const MAX_BODY = 1_000;
function clip(text, max) {
    if (!text)
        return undefined;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
export async function notify(orgId, n) {
    if (!orgId || !n.title)
        return;
    try {
        await models.Notification.create({
            _id: newId('ntf'),
            orgId,
            userId: n.userId,
            type: n.type,
            severity: n.severity ?? 'info',
            title: clip(n.title, MAX_TITLE),
            body: clip(n.body, MAX_BODY),
            link: n.link,
            dedupeKey: n.dedupeKey,
        });
    }
    catch (error) {
        if (error?.code === 11000)
            return;
        console.error(`[Notify] Failed to create "${n.type}" notification:`, error instanceof Error ? error.message : error);
    }
}
/** Mongo filter for notifications a member can see: workspace-wide ones plus their own. */
export function visibleTo(orgId, userId) {
    return { orgId, $or: [{ userId: { $exists: false } }, { userId: null }, { userId }] };
}
/** Unread notifications visible to a member. */
export async function countUnreadNotifications(orgId, userId) {
    return models.Notification.countDocuments({ ...visibleTo(orgId, userId), readAt: null });
}
