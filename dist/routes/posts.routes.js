/**
 * Scheduled posts, calendar, and publishing routes.
 * Handles creating, updating, scheduling, immediate publishing, and canceling posts.
 */
import { Router } from 'express';
import * as models from '../models/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { PublishingService } from '../services/publishingService.js';
import { newId } from '../lib/ids.js';
const router = Router();
// Helper to resolve orgId from request
async function resolveOrgId(req) {
    if (req.auth?.orgId)
        return req.auth.orgId;
    const org = await models.Organization.findOne();
    return org ? org._id : 'org_workspace';
}
// GET /api/posts - list posts with filters
router.get('/', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const { status, accountId, kind, page = '1', limit = '50' } = req.query;
        const filter = { orgId };
        if (status && status !== 'all')
            filter.status = status;
        if (accountId && accountId !== 'all')
            filter.accountId = accountId;
        if (kind && kind !== 'all')
            filter.kind = kind;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const skip = (pageNum - 1) * limitNum;
        const [posts, total] = await Promise.all([
            models.ScheduledPost.find(filter)
                .sort({ scheduledFor: 1, createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            models.ScheduledPost.countDocuments(filter),
        ]);
        return res.json({
            ok: true,
            posts,
            total,
            page: pageNum,
            limit: limitNum,
        });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// GET /api/posts/:id - single post
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const post = await models.ScheduledPost.findOne({ _id: req.params.id, orgId }).lean();
        if (!post)
            return res.status(404).json({ ok: false, error: 'Post not found' });
        return res.json({ ok: true, post });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// POST /api/posts - create or schedule a post
router.post('/', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const { accountId, kind = 'image', caption = '', media = [], mediaUrl, scheduledFor, publishNow = false, firstComment, attachAutomationId, shareToFeed = true, timezone = 'Asia/Kolkata', } = req.body;
        // Resolve target account
        let targetAccountId = accountId;
        if (!targetAccountId) {
            const activeAccount = await models.SocialAccount.findOne({
                orgId,
                platform: { $in: ['instagram', 'facebook'] },
                status: 'active',
            });
            if (!activeAccount) {
                return res.status(400).json({ ok: false, error: 'No active Instagram or Facebook account connected.' });
            }
            targetAccountId = activeAccount._id;
        }
        // Format media items
        const mediaItems = Array.isArray(media) && media.length > 0
            ? media
            : mediaUrl
                ? [{ url: mediaUrl, type: kind === 'video' || kind === 'reel' ? 'video' : 'image' }]
                : [];
        const postId = newId('pst');
        const initialStatus = publishNow ? 'publishing' : scheduledFor ? 'scheduled' : 'draft';
        const scheduleDate = scheduledFor ? new Date(scheduledFor) : undefined;
        const post = await models.ScheduledPost.create({
            _id: postId,
            orgId,
            accountId: targetAccountId,
            kind,
            caption,
            media: mediaItems,
            coverUrl: req.body.coverUrl,
            scheduledFor: scheduleDate,
            timezone,
            status: initialStatus,
            shareToFeed,
            firstComment,
            attachAutomationId,
            createdBy: req.auth?.userId || 'system',
            attempts: 0,
        });
        if (publishNow) {
            // Trigger immediate publishing asynchronously
            PublishingService.publishScheduledPost(postId).catch((err) => {
                console.error(`[PostsRouter] Background publishNow error for ${postId}:`, err.message);
            });
        }
        return res.status(201).json({ ok: true, post });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// PUT /api/posts/:id - update post
router.put('/:id', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const post = await models.ScheduledPost.findOne({ _id: req.params.id, orgId });
        if (!post)
            return res.status(404).json({ ok: false, error: 'Post not found' });
        if (post.status === 'published') {
            return res.status(400).json({ ok: false, error: 'Cannot modify an already published post.' });
        }
        const { caption, media, scheduledFor, firstComment, attachAutomationId, shareToFeed, status, } = req.body;
        if (caption !== undefined)
            post.caption = caption;
        if (media !== undefined)
            post.media = media;
        if (firstComment !== undefined)
            post.firstComment = firstComment;
        if (attachAutomationId !== undefined)
            post.attachAutomationId = attachAutomationId;
        if (shareToFeed !== undefined)
            post.shareToFeed = shareToFeed;
        if (scheduledFor !== undefined) {
            post.scheduledFor = scheduledFor ? new Date(scheduledFor) : undefined;
            if (post.status === 'draft' && scheduledFor)
                post.status = 'scheduled';
        }
        if (status !== undefined)
            post.status = status;
        await post.save();
        return res.json({ ok: true, post });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// POST /api/posts/:id/publish-now - trigger immediate publishing
router.post('/:id/publish-now', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const post = await models.ScheduledPost.findOne({ _id: req.params.id, orgId });
        if (!post)
            return res.status(404).json({ ok: false, error: 'Post not found' });
        if (post.status === 'published') {
            return res.status(400).json({ ok: false, error: 'Post is already published.' });
        }
        const result = await PublishingService.publishScheduledPost(post._id);
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// POST /api/posts/:id/cancel - cancel scheduled post
router.post('/:id/cancel', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const post = await models.ScheduledPost.findOne({ _id: req.params.id, orgId });
        if (!post)
            return res.status(404).json({ ok: false, error: 'Post not found' });
        if (post.status === 'published') {
            return res.status(400).json({ ok: false, error: 'Cannot cancel a published post.' });
        }
        post.status = 'cancelled';
        await post.save();
        return res.json({ ok: true, post });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// DELETE /api/posts/:id - delete post
router.delete('/:id', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const post = await models.ScheduledPost.findOne({ _id: req.params.id, orgId });
        if (!post)
            return res.status(404).json({ ok: false, error: 'Post not found' });
        await models.ScheduledPost.deleteOne({ _id: req.params.id });
        return res.json({ ok: true, message: 'Post deleted successfully.' });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
export default router;
