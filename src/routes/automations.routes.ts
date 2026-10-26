import { Router } from 'express';
import * as models from '../models/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { FarmboxService } from '../services/farmboxService.js';

const router = Router();

async function resolveOrgId(req: any): Promise<string> {
  if (req.auth?.orgId) return req.auth.orgId;
  const org = await models.Organization.findOne();
  return org ? org._id : 'org_workspace';
}

export const TURNKEY_FARMBOX_AUTOMATIONS = [
  {
    name: '🥦 Fresh Harvest Box (Comment-to-DM)',
    type: 'comment',
    keywords: ['FRESH', 'BOX', 'HARVEST', 'VEG', 'కూరగాయలు', 'ఆర్డర్'],
    trigger: {
      type: 'comment',
      scope: 'all_posts',
      keywords: ['FRESH', 'BOX', 'HARVEST', 'VEG', 'కూరగాయలు', 'ఆర్డర్'],
      matchMode: 'contains',
    },
    steps: [
      {
        id: 'start',
        type: 'start',
        next: 'reply_comment',
      },
      {
        id: 'reply_comment',
        type: 'comment_reply',
        text: [
          'నమస్తే! ఫార్మ్ బాక్స్ తాజా కూరగాయల వివరాలు మరియు ఆర్డర్ లింక్ మీ DM కి పంపాము! 🥦🧺',
          'Fresh from our partner farms! Just DM’d you the Weekly Harvest Box details and 1-click order link! ✨🌿',
        ],
        next: 'send_dm',
      },
      {
        id: 'send_dm',
        type: 'send',
        content: {
          kind: 'text',
          text:
            'Hello {{first_name}}! 🌿\n\nHere is this week’s Farm Fresh Vegetable Box:\n🥦 10-12 curated seasonal farm vegetables\n🧺 Farm-to-kitchen in under 12 hours\n💰 Special harvest price: ₹399 only\n\nTap to order in 1 click:\n{{order_link}}',
        },
        next: 'ask_slot',
      },
      {
        id: 'ask_slot',
        type: 'ask',
        content: {
          kind: 'text',
          text: 'What delivery slot works best for your home?\n1️⃣ Morning (6:00 AM - 9:00 AM)\n2️⃣ Evening (5:00 PM - 8:00 PM)\n\nReply with 1 or 2!',
        },
        saveTo: 'delivery_slot_preference',
        expect: 'text',
        next: 'send_confirmation',
      },
      {
        id: 'send_confirmation',
        type: 'send',
        content: {
          kind: 'text',
          text: 'Noted! Your preference has been saved. Our delivery partner will dispatch your box fresh tomorrow morning. Thank you for supporting local organic farming! 🚜💚',
        },
      },
    ],
  },
  {
    name: '📱 WhatsApp Instant Grocery Order Bot',
    type: 'message',
    keywords: ['ORDER', 'MENU', 'START', 'HI', 'HELLO', 'నమస్తే', 'బాక్స్'],
    trigger: {
      type: 'message',
      keywords: ['ORDER', 'MENU', 'START', 'HI', 'HELLO', 'నమస్తే', 'బాక్స్'],
      matchMode: 'contains',
    },
    steps: [
      {
        id: 'start',
        type: 'start',
        next: 'send_menu',
      },
      {
        id: 'send_menu',
        type: 'send',
        content: {
          kind: 'text',
          text:
            '🌿 *Welcome to Farm Box / ఫార్మ్ బాక్స్* 🌿\n\nChoose your harvest box for fresh home delivery:\n\n1️⃣ *Weekly Veg Box (₹399)* — 10-12 Daily cooking essentials\n2️⃣ *Fresh Fruit Basket (₹499)* — Seasonal immunity booster fruits\n3️⃣ *Greens Detox Box (₹249)* — 5 Farm-fresh leafy greens & herbs\n\nOrder online directly:\nhttps://farmbox.in/cart\n\nReply with 1, 2, or 3 to order instantly!',
        },
        next: 'ask_choice',
      },
      {
        id: 'ask_choice',
        type: 'ask',
        content: {
          kind: 'text',
          text: 'Please reply with your delivery address or pincode to check instant slot availability:',
        },
        saveTo: 'delivery_address',
        expect: 'text',
        next: 'send_thanks',
      },
      {
        id: 'send_thanks',
        type: 'send',
        content: {
          kind: 'text',
          text: 'Thank you! We deliver to your area in both 6-9 AM and 5-8 PM slots. Our team is packing your fresh harvest now. 🥦✨',
        },
      },
    ],
  },
  {
    name: '🍲 Cook the Harvest (Recipe to Cart)',
    type: 'comment',
    keywords: ['RECIPE', 'COOK', 'వండు', 'రెసిపీ', 'CURRY'],
    trigger: {
      type: 'comment',
      scope: 'all_posts',
      keywords: ['RECIPE', 'COOK', 'వండు', 'రెసిపీ', 'CURRY'],
      matchMode: 'contains',
    },
    steps: [
      {
        id: 'start',
        type: 'start',
        next: 'comment_ack',
      },
      {
        id: 'comment_ack',
        type: 'comment_reply',
        text: 'Sent the recipe card & fresh ingredients basket straight to your DMs! 👨‍🍳🍲 Happy cooking!',
        next: 'send_recipe_dm',
      },
      {
        id: 'send_recipe_dm',
        type: 'send',
        content: {
          kind: 'text',
          text:
            'Here is today’s "Cook the Harvest" recipe: *Homestyle Palak Paneer & Mixed Vegetable Sambar*! 🌿🍲\n\nAll ingredients (Organic Palak, Farm Tomatoes, Drumsticks, Coriander) are available in our curated Harvest Basket for just ₹299.\n\nTap to add all recipe ingredients to cart:\nhttps://farmbox.in/cart?recipe=cook_the_harvest',
        },
      },
    ],
  },
];

// List automations (auto-seeds Turnkey Farm Box automations if workspace is empty)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    let automations = await models.Automation.find({ orgId }).sort({ updatedAt: -1 });

    if (automations.length === 0) {
      // Auto-seed turnkey templates
      const firstAcc = await models.SocialAccount.findOne({ orgId });
      const targetAccountId = firstAcc ? firstAcc._id : 'acc_default';

      for (const tpl of TURNKEY_FARMBOX_AUTOMATIONS) {
        const autoId = `auto_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
        await models.Automation.create({
          _id: autoId,
          orgId,
          accountId: targetAccountId,
          name: tpl.name,
          type: tpl.type,
          status: 'live',
          keywords: tpl.keywords,
          trigger: tpl.trigger,
          flow: { version: 1, entry: 'start', nodes: tpl.steps },
          triggeredCount: 0,
          sentCount: 0,
          clickCount: 0,
          leadCount: 0,
          failedCount: 0,
        }).catch(() => undefined);
      }

      automations = await models.Automation.find({ orgId }).sort({ updatedAt: -1 });
    }

    return res.json({ ok: true, automations });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Explicitly seed / reset Turnkey Farm Box Automations
router.post('/seed-farmbox', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const firstAcc = await models.SocialAccount.findOne({ orgId });
    const targetAccountId = firstAcc ? firstAcc._id : 'acc_default';

    const created = [];
    for (const tpl of TURNKEY_FARMBOX_AUTOMATIONS) {
      const autoId = `auto_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      const auto = await models.Automation.create({
        _id: autoId,
        orgId,
        accountId: targetAccountId,
        name: tpl.name,
        type: tpl.type,
        status: 'live',
        keywords: tpl.keywords,
        trigger: tpl.trigger,
        flow: { version: 1, entry: 'start', nodes: tpl.steps },
        triggeredCount: 0,
        sentCount: 0,
        clickCount: 0,
        leadCount: 0,
        failedCount: 0,
      });
      created.push(auto);
    }

    return res.status(201).json({ ok: true, seeded: created.length, automations: created });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get single automation
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const automation = await models.Automation.findOne({ _id: req.params.id, orgId });
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    return res.json({ ok: true, automation });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Create automation
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { name, trigger, steps, accountId } = req.body;
    const orgId = await resolveOrgId(req);

    let targetAccountId = accountId;
    if (!targetAccountId) {
      const firstAcc = await models.SocialAccount.findOne({ orgId });
      targetAccountId = firstAcc ? firstAcc._id : 'acc_default';
    }

    const autoId = `auto_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const autoType = (trigger && trigger.type) || 'comment';
    const autoKeywords = (trigger && trigger.keywords) || [];

    const automation = await models.Automation.create({
      _id: autoId,
      orgId,
      accountId: targetAccountId,
      name: name || 'Untitled Automation',
      type: autoType,
      status: 'live',
      keywords: autoKeywords,
      trigger: trigger || { type: 'comment', keywords: ['INFO'], matchMode: 'contains' },
      flow: { version: 1, entry: 'start', nodes: steps || [] },
      triggeredCount: 0,
      sentCount: 0,
      clickCount: 0,
      leadCount: 0,
      failedCount: 0,
    });

    return res.status(201).json({ ok: true, automation });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update automation
router.put('/:id', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { name, trigger, steps, status, accountId } = req.body;
    const automation = await models.Automation.findOneAndUpdate(
      { _id: req.params.id, orgId },
      {
        $set: {
          ...(name && { name }),
          ...(trigger && { trigger }),
          ...(steps && { 'flow.nodes': steps }),
          ...(status && { status }),
          ...(accountId && { accountId }),
        },
      },
      { returnDocument: 'after' }
    );
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    return res.json({ ok: true, automation });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Toggle status (live <-> paused)
router.patch('/:id/toggle', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const auto = await models.Automation.findOne({ _id: req.params.id, orgId });
    if (!auto) return res.status(404).json({ error: 'Automation not found' });

    const newStatus = auto.status === 'live' ? 'paused' : 'live';
    auto.status = newStatus;
    await auto.save();

    return res.json({ ok: true, automation: auto, status: newStatus });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Delete automation
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const deleted = await models.Automation.findOneAndDelete({ _id: req.params.id, orgId });
    if (!deleted) return res.status(404).json({ error: 'Automation not found' });
    return res.json({ ok: true, message: 'Automation deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
