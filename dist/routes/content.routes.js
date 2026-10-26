/**
 * AI Content Studio and content drafts router.
 * Generates high-converting social media content for Farm Box
 * and schedules directly to the publishing calendar.
 */
import { Router } from 'express';
import * as models from '../models/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { FarmboxService } from '../services/farmboxService.js';
import { ClaudeBudgetGuard } from '../services/claudeGuard.js';
import { newId } from '../lib/ids.js';
const router = Router();
async function resolveOrgId(req) {
    if (req.auth?.orgId)
        return req.auth.orgId;
    const org = await models.Organization.findOne();
    return org ? org._id : 'org_workspace';
}
// Generate social media content with AI
router.post('/generate', optionalAuth, async (req, res) => {
    try {
        const { topic = 'Weekly Farm Fresh Vegetable Box', platform = 'instagram', kind = 'reel', language = 'english', boxId, } = req.body;
        const isTe = language === 'telugu' || language === 'bilingual';
        const boxes = FarmboxService.getCuratedBoxes();
        const targetBox = boxId ? boxes.find((b) => b.id === boxId) : boxes[0];
        // AI Generation via Claude Haiku with $3.00 budget protection
        const prompt = `Generate a high-converting ${platform} ${kind} for Farm Box (organic fresh grocery & vegetable delivery in Hyderabad).
Topic: ${topic}
Target Box: ${targetBox ? `${targetBox.name} (₹${targetBox.priceInr})` : 'Farm Harvest'}
Language Preference: ${language}

Output JSON format ONLY:
{
  "title": "short catchy title",
  "hook": "strong 3-second hook for video or caption opening",
  "caption": "complete engaging caption with emojis and value proposition",
  "script": "spoken script or visual reel scene breakdown",
  "hashtags": ["freshproduce", "organicfarming", "hyderabadfoodie", "farmbox"],
  "firstComment": "Comment keyword to trigger DM delivery",
  "ctaKeyword": "FRESH",
  "dmText": "Private DM sent with box link"
}`;
        const aiRes = await ClaudeBudgetGuard.executeMessage({
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 350,
            context: 'content_studio',
        });
        if (aiRes?.text) {
            try {
                const cleanJson = aiRes.text.substring(aiRes.text.indexOf('{'), aiRes.text.lastIndexOf('}') + 1);
                const parsed = JSON.parse(cleanJson);
                return res.json({ ok: true, content: parsed, costUsd: aiRes.costUsd });
            }
            catch (err) {
                console.warn('[ContentStudio] JSON parse failed, falling back:', err.message);
            }
        }
        // High-quality contextual Farm Box fallback
        let content;
        if (isTe) {
            content = {
                title: 'తాజా ఆర్గానిక్ కూరగాయల బాస్కెట్ (₹399)',
                hook: 'ఉదయం 6 గంటలకే నేరుగా పొలం నుండి మీ వంటగదికి! 🥦🧺',
                caption: `ఈ రోజు ఉదయమే మా ఆర్గానిక్ పొలాల నుండి కోసిన 12 రకాల తాజా కూరగాయలు ఇప్పుడు కేవలం ₹399 మాత్రమే! 🌿\n\n✅ రసాయనాలు లేని పవిత్రమైన పంట\n✅ ఆర్డర్ చేసిన 12 గంటల్లోనే మీ ఇంటికి డెలివరీ\n✅ ఉదయం (6-9 AM) & సాయంత్రం (5-8 PM) స్లాట్లు\n\nఈ బాక్స్ కావాలంటే కింద కామెంట్‌లో "FRESH" అని టైప్ చేయండి, నేరుగా మీ ఇన్ బాక్స్‌కు ఆర్డర్ లింక్ పంపుతాము! 👇`,
                script: 'Scene 1: చేలల్లో పచ్చటి తాజా కూరగాయలను తెంపుతున్న దృశ్యం.\nScene 2: ఫ్రెష్ వెజిటబుల్ బాక్స్ ప్యాకింగ్ మరియు నాణ్యత తనిఖీ.\nScene 3: "FRESH అని కామెంట్ చేయండి, మీ ఇంటికే తెస్తాం!" అని ముగింపు.',
                hashtags: ['FarmBox', 'TeluguVantalu', 'OrganicVegetables', 'HyderabadFood', 'FreshHarvest'],
                firstComment: 'నమస్తే! "FRESH" అని కామెంట్ చేసి ₹399 స్పెషల్ హార్వెస్ట్ బాక్స్ పొందండి! 🥦🧺',
                ctaKeyword: 'FRESH',
                dmText: `నమస్తే! ఫార్మ్ బాక్స్ వారపు కూరగాయల బాస్కెట్ (₹399) వివరాలు మరియు 1-క్లిక్ ఆర్డర్ లింక్:\n${FarmboxService.generateOrderLink(targetBox?.id || 'box_weekly_fresh')}`,
            };
        }
        else {
            content = {
                title: `${targetBox?.name || 'Weekly Farm Fresh Vegetable Box'} — Farm to Table in 12 Hours`,
                hook: 'Stop buying 4-day-old supermarket vegetables that have lost all their nutrients! 🥦✨',
                caption: `Did you know supermarket veggies spend 72+ hours in transit? At Farm Box, our certified partner farms harvest at 4 AM, and the produce arrives at your doorstep before dinner! 🚜🌿\n\n🧺 What's inside this week's harvest basket (8kg / 12 items):\n• Farm Fresh Vine Tomatoes & Country Onions\n• Tender Okra & Gutti Vankaya Brinjals\n• Hydro-washed Spinach, Amaranth & Mint\n• Bottle Gourd & Ridge Gourd\n\n💰 Direct Farm Price: ₹${targetBox?.priceInr || 399} only!\n\n👇 Comment "FRESH" below and our bot will instantly DM you the 1-click cart link!`,
                script: 'Hook (0-3s): Hold a supermarket pale tomato vs a deep red farm-harvested tomato.\nScene 1 (3-8s): Show the unboxing of the eco-friendly ₹399 harvest basket.\nScene 2 (8-14s): Quick sizzle of fresh Palak Dal cooking in a skillet.\nCTA (14-20s): "Comment FRESH below to get yours delivered fresh tomorrow morning!"',
                hashtags: ['FarmBox', 'FarmToTable', 'HyderabadGroceries', 'OrganicProduce', 'HealthyEating'],
                firstComment: 'Comment "FRESH" below and I will instantly DM you our 1-click order link! 🥦👇',
                ctaKeyword: 'FRESH',
                dmText: `Hello! 🌿 Here is your 1-click cart link for this week's Farm Box (₹${targetBox?.priceInr || 399}):\n${FarmboxService.generateOrderLink(targetBox?.id || 'box_weekly_fresh')}`,
            };
        }
        return res.json({ ok: true, content });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// List saved content drafts
router.get('/drafts', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        let drafts = await models.ContentDraft.find({ orgId }).sort({ updatedAt: -1 }).lean();
        if (drafts.length === 0) {
            // Auto-seed starter drafts for Farm Box
            const seed1Id = newId('drf');
            const seed2Id = newId('drf');
            await models.ContentDraft.create([
                {
                    _id: seed1Id,
                    orgId,
                    kind: 'reel',
                    title: 'Morning Harvest Unboxing Reel (₹399 Box)',
                    caption: 'Harvested at 4 AM, on your kitchen table by evening! Comment FRESH to order today’s basket! 🥦🧺',
                    hashtags: ['FarmBox', 'FreshHarvest', 'OrganicLiving'],
                    ctaKeyword: 'FRESH',
                    dmText: 'Here is your 1-click cart link for the Weekly Harvest Box: https://farmbox.in/order?box=weekly-fresh-box',
                    status: 'draft',
                    source: 'studio',
                },
                {
                    _id: seed2Id,
                    orgId,
                    kind: 'post',
                    title: 'Cook the Harvest: Palakura Pappu Kit',
                    caption: 'Cook authentic Telugu Palakura Pappu with tender farm spinach and aromatic garlic tadka. Comment RECIPE for ingredients! 🍲🌿',
                    hashtags: ['TeluguRecipes', 'CookTheHarvest', 'FarmBox'],
                    ctaKeyword: 'RECIPE',
                    dmText: 'Here is the full Palakura Pappu recipe card and pre-filled ingredient cart: https://farmbox.in/cart?recipe=palakura-pappu',
                    status: 'draft',
                    source: 'studio',
                },
            ]).catch(() => undefined);
            drafts = await models.ContentDraft.find({ orgId }).sort({ updatedAt: -1 }).lean();
        }
        return res.json({ ok: true, drafts });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// Save content draft
router.post('/drafts', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const { title, caption, script, kind = 'reel', hashtags = [], ctaKeyword, dmText, mediaUrls = [], } = req.body;
        const draftId = newId('drf');
        const draft = await models.ContentDraft.create({
            _id: draftId,
            orgId,
            kind,
            title: title || 'Untitled Content Draft',
            caption,
            script,
            hashtags: Array.isArray(hashtags) ? hashtags : [],
            ctaKeyword,
            dmText,
            mediaUrls,
            status: 'draft',
            source: 'studio',
            createdBy: req.auth?.userId || 'system',
        });
        return res.status(201).json({ ok: true, draft });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// Schedule draft directly into ScheduledPost
router.post('/drafts/:id/schedule', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        const draft = await models.ContentDraft.findOne({ _id: req.params.id, orgId });
        if (!draft)
            return res.status(404).json({ ok: false, error: 'Draft not found' });
        const { scheduledFor, accountId, mediaUrl, firstComment } = req.body;
        let targetAccountId = accountId;
        if (!targetAccountId) {
            const activeAccount = await models.SocialAccount.findOne({
                orgId,
                platform: { $in: ['instagram', 'facebook'] },
                status: 'active',
            });
            targetAccountId = activeAccount?._id || 'acc_default';
        }
        const postId = newId('pst');
        const post = await models.ScheduledPost.create({
            _id: postId,
            orgId,
            accountId: targetAccountId,
            kind: draft.kind === 'reel' ? 'reel' : 'image',
            caption: draft.caption ? `${draft.caption}\n\n${(draft.hashtags || []).map((h) => `#${h}`).join(' ')}` : '',
            media: mediaUrl ? [{ url: mediaUrl, type: draft.kind === 'reel' ? 'video' : 'image' }] : [],
            scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(Date.now() + 60 * 60 * 1000),
            status: 'scheduled',
            firstComment: firstComment || (draft.ctaKeyword ? `Comment "${draft.ctaKeyword}" to get this box directly in DMs! 🥦` : undefined),
        });
        draft.status = 'scheduled';
        draft.scheduledPostId = postId;
        await draft.save();
        return res.json({ ok: true, post, draft });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
// Delete draft
router.delete('/drafts/:id', optionalAuth, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        await models.ContentDraft.deleteOne({ _id: req.params.id, orgId });
        return res.json({ ok: true, message: 'Draft deleted successfully' });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});
export default router;
