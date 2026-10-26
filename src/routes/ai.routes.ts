import { Router } from 'express';
import * as models from '../models/index.js';
import { AiService } from '../services/aiService.js';
import { FarmboxService } from '../services/farmboxService.js';

const router = Router();

const DEFAULT_FARMBOX_VOICE = {
  personaName: 'Farm Box Fresh Grocery Concierge',
  tone: 'Fresh, appetizing, farm-to-table, helpful, bilingual (Telugu & English)',
  guidelines:
    'Reply concisely (1-2 sentences). Share fresh harvest details, vegetable box pricing (₹399 Weekly Box), morning/evening delivery slots, and direct cart links. Reply in Telugu if the user writes in Telugu.',
  sampleReplies: [
    'నమస్తే! ఫార్మ్ బాక్స్ తాజా కూరగాయల బాక్స్ (₹399) వివరాలు మరియు 1-క్లిక్ ఆర్డర్ లింక్ మీ ఇన్ బాక్స్‌కు పంపాము! 🥦🧺',
    'Our farm-fresh Weekly Veg Box is harvested today and delivered morning (6-9 AM)! DMing you the cart link right now! 🌿✨',
    'Just sent you the "Cook the Harvest" recipe card and ingredients cart straight to your DMs! 👨‍🍳🍲',
  ],
  forbiddenWords: ['crypto', 'invest', 'click link in bio', 'affiliate'],
};

// Get Brand Voice settings
router.get('/brand-voice', async (req, res) => {
  try {
    const org = await models.Organization.findOne();
    const voice = await models.BrandVoice.findOne(org ? { orgId: org._id } : {});
    return res.json({
      ok: true,
      brandVoice: voice || DEFAULT_FARMBOX_VOICE,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update Brand Voice settings
router.put('/brand-voice', async (req, res) => {
  try {
    const { personaName, tone, guidelines, sampleReplies, forbiddenWords } = req.body;
    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';

    const voice = await models.BrandVoice.findOneAndUpdate(
      { orgId },
      {
        $set: {
          personaName: personaName || DEFAULT_FARMBOX_VOICE.personaName,
          tone: tone || DEFAULT_FARMBOX_VOICE.tone,
          guidelines: guidelines || DEFAULT_FARMBOX_VOICE.guidelines,
          sampleReplies: sampleReplies || DEFAULT_FARMBOX_VOICE.sampleReplies,
          forbiddenWords: forbiddenWords || DEFAULT_FARMBOX_VOICE.forbiddenWords,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    return res.json({ ok: true, brandVoice: voice });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Live test AI reply simulation
router.post('/test-reply', async (req, res) => {
  try {
    const { commentText, postCaption } = req.body;
    if (!commentText) return res.status(400).json({ error: 'Comment text is required' });

    const org = await models.Organization.findOne();
    const voice = await models.BrandVoice.findOne(org ? { orgId: org._id } : {});

    const result = await AiService.generateCommentReply(
      commentText,
      postCaption || '',
      voice || DEFAULT_FARMBOX_VOICE
    );

    return res.json({
      ok: true,
      ...result,
      isTelugu: AiService.isTelugu(commentText),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Recommend vegetable / produce box
router.post('/recommend-box', (req, res) => {
  try {
    const { familySize = 3, vegetarian = true, likesFruits = true } = req.body;
    const recommendation = AiService.recommendBox(Number(familySize), Boolean(vegetarian), Boolean(likesFruits));
    const orderLink = FarmboxService.generateOrderLink(recommendation.recommended.id);

    return res.json({
      ok: true,
      ...recommendation,
      orderLink,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Classify comment spam & toxicity
router.post('/classify-spam', async (req, res) => {
  try {
    const { commentText } = req.body;
    if (!commentText) return res.status(400).json({ error: 'Comment text is required' });

    const result = await AiService.classifySpam(commentText);
    return res.json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// AI Usage stats
router.get('/stats', async (req, res) => {
  try {
    const totalAiTokens = await models.AiUsage.countDocuments();
    return res.json({
      ok: true,
      stats: {
        totalRepliesGenerated: totalAiTokens,
        spamCommentsBlocked: 0,
        creditsRemaining: 'Unlimited (Paid Tier)',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
