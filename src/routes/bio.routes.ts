import { Router } from 'express';
import * as models from '../models/index.js';

const router = Router();

// Get workspace Link in Bio page
router.get('/', async (req, res) => {
  try {
    const org = await models.Organization.findOne();
    let page = await models.BioPage.findOne(org ? { orgId: org._id } : {});

    if (!page) {
      page = await models.BioPage.create({
        _id: `bio_${Date.now().toString(36)}`,
        orgId: org ? org._id : 'org_workspace',
        slug: 'my-bio',
        title: 'Creator Links',
        bio: 'Welcome to my official resources & links!',
        theme: 'dark',
        blocks: [
          {
            id: 'b1',
            type: 'link',
            title: '🔥 Exclusive Free Growth Guide',
            url: 'https://example.com/guide',
            isActive: true,
          },
        ],
        published: true,
        viewCount: 0,
      });
    }

    return res.json({ ok: true, page });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update Link in Bio page
router.put('/', async (req, res) => {
  try {
    const { title, bio, slug, theme, blocks, published } = req.body;
    const org = await models.Organization.findOne();
    const orgId = org ? org._id : 'org_workspace';

    const page = await models.BioPage.findOneAndUpdate(
      { orgId },
      {
        $set: {
          title,
          bio,
          slug: slug ? slug.toLowerCase().replace(/[^a-z0-9-]/g, '') : 'links',
          theme,
          blocks,
          published,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    return res.json({ ok: true, page });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Public Bio Page View
router.get('/p/:slug', async (req, res) => {
  try {
    const page = await models.BioPage.findOneAndUpdate(
      { slug: req.params.slug, published: true },
      { $inc: { viewCount: 1 } },
      { returnDocument: 'after' }
    );

    if (!page) return res.status(404).json({ error: 'Bio page not found' });
    return res.json({ ok: true, page });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Track link click
router.post('/track-click', async (req, res) => {
  try {
    const { pageId, blockId } = req.body;
    if (pageId) {
      await models.BioPage.updateOne(
        { _id: pageId, 'blocks.id': blockId },
        { $inc: { 'blocks.$.clickCount': 1 } }
      );
    }
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
