import { Router } from 'express';
import * as models from '../models/index.js';
import { MetaService } from '../services/metaService.js';

const router = Router();

// Get 4 Ice Breakers
router.get('/ice-breakers', async (req, res) => {
  try {
    const org = await models.Organization.findOne();
    const iceBreakers = await models.IceBreaker.find(org ? { orgId: org._id } : {}).sort({
      position: 1,
    });
    return res.json({ ok: true, iceBreakers });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update & Sync 4 Ice Breakers
router.put('/ice-breakers', async (req, res) => {
  try {
    const { iceBreakers, syncMeta } = req.body; // array of up to 4 items
    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';

    await models.IceBreaker.deleteMany({ orgId });

    const created = [];
    if (Array.isArray(iceBreakers)) {
      for (let i = 0; i < Math.min(iceBreakers.length, 4); i++) {
        const item = iceBreakers[i];
        const doc = await models.IceBreaker.create({
          _id: `ib_${Date.now().toString(36)}_${i}`,
          orgId,
          accountId: item.accountId || 'acc_default',
          question: item.question,
          payload: item.payload || item.question,
          position: i,
        });
        created.push(doc);
      }
    }

    let metaResult = null;
    if (syncMeta) {
      const account = await models.SocialAccount.findOne();
      if (account && account.accessToken) {
        metaResult = await MetaService.setIceBreakers(
          created.map((ib: any) => ({ question: ib.question, payload: String(ib.payload || ib.question) })),
          account.accessToken
        );
      }
    }

    return res.json({ ok: true, iceBreakers: created, metaResult });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get Persistent Menu (up to 20 items)
router.get('/menu', async (req, res) => {
  try {
    const org = await models.Organization.findOne();
    const menuItems = await models.MenuItem.find(org ? { orgId: org._id } : {}).sort({
      position: 1,
    });
    return res.json({ ok: true, menuItems });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update & Sync Persistent Menu
router.put('/menu', async (req, res) => {
  try {
    const { menuItems, syncMeta } = req.body;
    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';

    await models.MenuItem.deleteMany({ orgId });

    const created = [];
    if (Array.isArray(menuItems)) {
      for (let i = 0; i < Math.min(menuItems.length, 20); i++) {
        const item = menuItems[i];
        const doc = await models.MenuItem.create({
          _id: `menu_${Date.now().toString(36)}_${i}`,
          orgId,
          accountId: item.accountId || 'acc_default',
          title: item.title,
          type: item.url ? 'web_url' : 'postback',
          url: item.url,
          payload: item.payload,
          position: i,
        });
        created.push(doc);
      }
    }

    let metaResult = null;
    if (syncMeta) {
      const account = await models.SocialAccount.findOne();
      if (account && account.accessToken) {
        metaResult = await MetaService.setPersistentMenu(
          created.map((item: any) => ({
            title: item.title,
            url: item.url,
            payload: item.payload ? String(item.payload) : undefined,
          })),
          account.accessToken
        );
      }
    }

    return res.json({ ok: true, menuItems: created, metaResult });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
