/**
 * Post Publishing Service: publishes posts & Reels to Instagram and Facebook Page
 * using official Meta Graph API v21.0 container publishing.
 * Includes automated First Comment posting and keyword automation attachment.
 */
import axios from 'axios';
import * as models from '../models/index.js';
import { accountToken } from '../lib/crypto.js';
import { recordStat } from './stats.js';
import { notify } from './notify.js';
const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export class PublishingService {
    /**
     * Publishes a scheduled post immediately via Meta Graph API
     */
    static async publishScheduledPost(postId) {
        const post = await models.ScheduledPost.findById(postId);
        if (!post)
            throw new Error('Post not found');
        if (post.status === 'published')
            return { success: true, publishedMediaId: post.publishedMediaId };
        const account = await models.SocialAccount.findById(post.accountId);
        if (!account)
            throw new Error('Associated social account not found');
        const token = accountToken(account);
        if (!token)
            throw new Error('No access token available for account');
        await models.ScheduledPost.updateOne({ _id: postId }, { $set: { status: 'publishing' }, $inc: { attempts: 1 } });
        try {
            let publishedMediaId;
            let permalink;
            const mediaUrl = post.media?.[0]?.url || post.mediaUrl;
            const isVideoOrReel = post.kind === 'reel' || post.kind === 'video';
            if (account.platform === 'facebook') {
                // Facebook Page Publishing
                const pageId = account.pageId;
                if (!pageId)
                    throw new Error('Account has no Facebook pageId');
                if (mediaUrl) {
                    const res = await axios.post(`${GRAPH_BASE}/${pageId}/photos`, null, {
                        params: {
                            url: mediaUrl,
                            message: post.caption || '',
                            access_token: token,
                        },
                    });
                    publishedMediaId = res.data?.id || res.data?.post_id;
                }
                else {
                    const res = await axios.post(`${GRAPH_BASE}/${pageId}/feed`, null, {
                        params: {
                            message: post.caption || '',
                            access_token: token,
                        },
                    });
                    publishedMediaId = res.data?.id;
                }
                // Optional first comment on Facebook post
                if (publishedMediaId && post.firstComment) {
                    await axios.post(`${GRAPH_BASE}/${publishedMediaId}/comments`, null, {
                        params: { message: post.firstComment, access_token: token },
                    }).catch((e) => console.warn('[Publishing] FB First comment failed:', e.message));
                }
            }
            else {
                // Instagram Container Publishing
                const igUserId = account.igUserId;
                if (!igUserId)
                    throw new Error('Account has no Instagram igUserId');
                // Step 1: Create Container
                const containerParams = {
                    caption: post.caption || '',
                    access_token: token,
                };
                if (isVideoOrReel) {
                    containerParams.media_type = 'REELS';
                    containerParams.video_url = mediaUrl;
                    containerParams.share_to_feed = post.shareToFeed !== false;
                    if (post.coverUrl)
                        containerParams.cover_url = post.coverUrl;
                }
                else if (mediaUrl) {
                    containerParams.image_url = mediaUrl;
                }
                const containerRes = await axios.post(`${GRAPH_BASE}/${igUserId}/media`, null, {
                    params: containerParams,
                });
                const containerId = containerRes.data?.id;
                if (!containerId)
                    throw new Error('Failed to create Instagram media container');
                // Step 2: Poll container status if video/reel
                if (isVideoOrReel) {
                    let ready = false;
                    let retries = 0;
                    while (!ready && retries < 20) {
                        await new Promise((r) => setTimeout(r, 4000));
                        retries++;
                        try {
                            const statusRes = await axios.get(`${GRAPH_BASE}/${containerId}`, {
                                params: { fields: 'status_code', access_token: token },
                            });
                            const statusCode = statusRes.data?.status_code;
                            if (statusCode === 'FINISHED')
                                ready = true;
                            else if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
                                throw new Error(`Media container failed with status: ${statusCode}`);
                            }
                        }
                        catch (err) {
                            if (err.message.includes('status: ERROR'))
                                throw err;
                        }
                    }
                }
                // Step 3: Publish Container
                const publishRes = await axios.post(`${GRAPH_BASE}/${igUserId}/media_publish`, null, {
                    params: { creation_id: containerId, access_token: token },
                });
                publishedMediaId = publishRes.data?.id;
                // Fetch permalink
                if (publishedMediaId) {
                    try {
                        const mediaDetail = await axios.get(`${GRAPH_BASE}/${publishedMediaId}`, {
                            params: { fields: 'permalink,thumbnail_url,media_url', access_token: token },
                        });
                        permalink = mediaDetail.data?.permalink;
                    }
                    catch { }
                    // Step 4: Immediate First Comment Hook
                    if (post.firstComment) {
                        try {
                            await axios.post(`${GRAPH_BASE}/${publishedMediaId}/comments`, null, {
                                params: { message: post.firstComment, access_token: token },
                            });
                            console.log(`[Publishing] Posted First Comment on @${account.username}'s post ${publishedMediaId}`);
                        }
                        catch (e) {
                            console.warn('[Publishing] First comment hook failed:', e.message);
                        }
                    }
                    // Step 5: Attach Automation Trigger to Published Post
                    if (post.attachAutomationId) {
                        await models.Automation.updateOne({ _id: post.attachAutomationId }, { $set: { 'trigger.mediaId': publishedMediaId, 'trigger.scope': 'this_post' } }).catch(() => undefined);
                        console.log(`[Publishing] Attached automation ${post.attachAutomationId} to post ${publishedMediaId}`);
                    }
                    // Mirror into IgMedia collection
                    await models.IgMedia.create({
                        _id: `igm_${publishedMediaId}`,
                        orgId: account.orgId,
                        accountId: account._id,
                        mediaId: publishedMediaId,
                        mediaType: isVideoOrReel ? 'VIDEO' : 'IMAGE',
                        mediaProductType: isVideoOrReel ? 'REELS' : 'FEED',
                        caption: post.caption,
                        permalink,
                        mediaUrl,
                        likeCount: 0,
                        commentCount: post.firstComment ? 1 : 0,
                        timestamp: new Date(),
                        setupState: post.attachAutomationId ? 'has_trigger' : 'no_trigger',
                    }).catch(() => undefined);
                }
            }
            const now = new Date();
            await models.ScheduledPost.updateOne({ _id: postId }, {
                $set: {
                    status: 'published',
                    publishedAt: now,
                    publishedMediaId,
                    permalink,
                    error: null,
                },
            });
            await recordStat(post.orgId, post.accountId, 'posts_published');
            await notify(post.orgId, {
                type: 'system',
                severity: 'success',
                title: `Published: ${post.kind.toUpperCase()} on @${account.username}`,
                body: post.caption ? post.caption.slice(0, 80) : 'Post published successfully.',
                link: '/schedule',
            }).catch(() => undefined);
            console.log(`[Publishing] Successfully published post ${postId} (Media ID: ${publishedMediaId})`);
            return { success: true, publishedMediaId };
        }
        catch (error) {
            const errMsg = error.response?.data?.error?.message || error.message;
            console.error(`[Publishing] Failed to publish post ${postId}:`, errMsg);
            await models.ScheduledPost.updateOne({ _id: postId }, { $set: { status: 'failed', error: errMsg } });
            await notify(post.orgId, {
                type: 'system',
                severity: 'error',
                title: `Publishing failed: ${post.kind}`,
                body: errMsg,
                link: '/schedule',
            }).catch(() => undefined);
            return { success: false, error: errMsg };
        }
    }
}
