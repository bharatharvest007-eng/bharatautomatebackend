/**
 * Core platform jobs (owner: Foundation):
 * - 'webhooks.deliver': signed outbound webhook delivery with retries;
 * - 'approvals.expire' (every 10 min): pending approvals past expiresAt → 'expired';
 * - 'notifications.cleanup' (daily): deletes read notifications older than 90 days.
 * `registerAllJobs()` (./index.ts) calls `register()` at startup.
 */
import * as models from '../models/index.js';
import { registerJob, registerRecurring } from '../services/jobs.js';
import { WEBHOOK_DELIVER_JOB, deliverWebhookJob } from '../services/events.js';
import { expireApprovals } from '../services/approvals.js';
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const READ_NOTIFICATION_RETENTION_MS = 90 * DAY_MS;
export function register() {
    // 10s HTTP timeout plus bookkeeping; well under the default lock.
    registerJob(WEBHOOK_DELIVER_JOB, deliverWebhookJob, { timeoutMs: 60_000 });
    registerRecurring('approvals.expire', 10 * MINUTE_MS, async () => {
        const expired = await expireApprovals();
        if (expired > 0)
            console.log(`[Jobs] Expired ${expired} pending approval(s)`);
    }, { initialDelayMs: MINUTE_MS });
    registerRecurring('notifications.cleanup', DAY_MS, async () => {
        const result = await models.Notification.deleteMany({ readAt: { $lt: new Date(Date.now() - READ_NOTIFICATION_RETENTION_MS) } });
        if (result.deletedCount)
            console.log(`[Jobs] Deleted ${result.deletedCount} old read notification(s)`);
    }, { initialDelayMs: 15 * MINUTE_MS });
}
