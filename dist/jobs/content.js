/**
 * Background jobs for: Scheduled post publishing, media sync, container sweeps.
 * Owner: Content & Publishing.
 */
import * as models from '../models/index.js';
import { registerRecurring } from '../services/jobs.js';
import { PublishingService } from '../services/publishingService.js';
const ONE_MINUTE_MS = 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
export function register() {
    // Recurring job: Publish scheduled posts whose time has arrived
    registerRecurring('posts.publish_due', ONE_MINUTE_MS, async () => {
        const now = new Date();
        // Find all posts ready for publication
        const duePosts = await models.ScheduledPost.find({
            status: 'scheduled',
            scheduledFor: { $lte: now },
        }).limit(20);
        if (duePosts.length > 0) {
            console.log(`[Jobs:Content] Found ${duePosts.length} posts due for publishing.`);
            for (const post of duePosts) {
                try {
                    await PublishingService.publishScheduledPost(post._id);
                }
                catch (err) {
                    console.error(`[Jobs:Content] Failed to execute publishing for post ${post._id}:`, err.message);
                }
            }
        }
        // Sweep posts stuck in 'publishing' state for > 30 mins
        const stuckThreshold = new Date(Date.now() - THIRTY_MINUTES_MS);
        await models.ScheduledPost.updateMany({
            status: 'publishing',
            updatedAt: { $lte: stuckThreshold },
        }, {
            $set: {
                status: 'failed',
                error: 'Publishing timed out after 30 minutes without confirmation.',
            },
        }).catch(() => undefined);
    }, { initialDelayMs: 10 * 1000 });
}
