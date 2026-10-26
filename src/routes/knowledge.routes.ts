/**
 * Knowledge base documents for the Farm Box AI agent.
 * Stores business FAQs, delivery coverage, product guarantees, and organic guidelines.
 */
import { Router } from 'express';
import * as models from '../models/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { newId } from '../lib/ids.js';

const router = Router();

async function resolveOrgId(req: any): Promise<string> {
  if (req.auth?.orgId) return req.auth.orgId;
  const org = await models.Organization.findOne();
  return org ? org._id : 'org_workspace';
}

const SEED_FARMBOX_DOCS = [
  {
    title: 'Farm-to-Kitchen Harvest & Organic Standards',
    content:
      'Farm Box partners with certified natural and organic farms within 80km of the city. Vegetables and fruits are harvested at 4:00 AM daily, hand-sorted, and hydro-washed with pure water. Zero carbide, zero artificial ripening, and no synthetic wax coatings.',
    source: 'faq',
  },
  {
    title: 'Delivery Slots, Lead Times & Pincode Coverage',
    content:
      'We deliver twice daily: Morning Slot (6:00 AM – 9:00 AM) and Evening Dinner Slot (5:00 PM – 8:00 PM). Same-day delivery is available across Hyderabad, Secunderabad, Gachibowli, Madhapur, Kondapur, Hitec City, Jubilee Hills, Banjara Hills, and Kukatpally. Orders placed before 10 PM arrive next morning.',
    source: 'faq',
  },
  {
    title: 'Eco Packaging & 100% Freshness Replacement Policy',
    content:
      'Produce is packed in reusable and biodegradable breathable kraft boxes. If any leafy green or vegetable arrives damaged or sub-standard, customers can send a photo on WhatsApp for instant 100% wallet credit or same-day replacement with no questions asked.',
    source: 'faq',
  },
];

// List knowledge documents (auto-seeds default Farm Box documents if empty)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    let docs = await models.KnowledgeDoc.find({ orgId }).sort({ updatedAt: -1 }).lean();

    if (docs.length === 0) {
      for (const item of SEED_FARMBOX_DOCS) {
        await models.KnowledgeDoc.create({
          _id: newId('kno'),
          orgId,
          title: item.title,
          content: item.content,
          source: item.source as any,
          enabled: true,
          tokens: Math.round(item.content.length / 4),
          status: 'ready',
        }).catch(() => undefined);
      }
      docs = await models.KnowledgeDoc.find({ orgId }).sort({ updatedAt: -1 }).lean();
    }

    return res.json({ ok: true, docs });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Create knowledge document
router.post('/', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { title, content, source = 'manual', accountId } = req.body;

    if (!title || !content) {
      return res.status(400).json({ ok: false, error: 'Title and content are required' });
    }

    const docId = newId('kno');
    const doc = await models.KnowledgeDoc.create({
      _id: docId,
      orgId,
      accountId: accountId || undefined,
      title,
      content,
      source,
      enabled: true,
      tokens: Math.round(content.length / 4),
      status: 'ready',
    });

    return res.status(201).json({ ok: true, doc });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Update knowledge document
router.put('/:id', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { title, content, enabled } = req.body;

    const doc = await models.KnowledgeDoc.findOneAndUpdate(
      { _id: req.params.id, orgId },
      {
        $set: {
          ...(title !== undefined ? { title } : {}),
          ...(content !== undefined ? { content, tokens: Math.round(content.length / 4) } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
        },
      },
      { returnDocument: 'after' }
    );

    if (!doc) return res.status(404).json({ ok: false, error: 'Knowledge document not found' });
    return res.json({ ok: true, doc });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Delete knowledge document
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    await models.KnowledgeDoc.deleteOne({ _id: req.params.id, orgId });
    return res.json({ ok: true, message: 'Document deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
