import { Router } from 'express';
import * as models from '../models/index.js';
const router = Router();
// List templates
router.get('/', async (req, res) => {
    try {
        const org = await models.Organization.findOne();
        const templates = await models.Template.find(org ? { orgId: org._id } : {}).sort({ updatedAt: -1 });
        return res.json({ ok: true, templates });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Create template
router.post('/', async (req, res) => {
    try {
        const { name, type, content } = req.body;
        const org = await models.Organization.findOne();
        const orgId = org ? org._id : 'org_workspace';
        const templateId = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
        const template = await models.Template.create({
            _id: templateId,
            orgId,
            name: name || 'Untitled Template',
            type: type || 'button',
            content: content || {
                text: 'Tap below to continue:',
                buttons: [{ title: 'View Website', url: 'https://example.com' }],
            },
        });
        return res.status(201).json({ ok: true, template });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Get template
router.get('/:id', async (req, res) => {
    try {
        const template = await models.Template.findById(req.params.id);
        if (!template)
            return res.status(404).json({ error: 'Template not found' });
        return res.json({ ok: true, template });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Update template
router.put('/:id', async (req, res) => {
    try {
        const { name, type, content } = req.body;
        const template = await models.Template.findByIdAndUpdate(req.params.id, {
            $set: {
                ...(name && { name }),
                ...(type && { type }),
                ...(content && { content }),
            },
        }, { returnDocument: 'after' });
        if (!template)
            return res.status(404).json({ error: 'Template not found' });
        return res.json({ ok: true, template });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Delete template
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await models.Template.findByIdAndDelete(req.params.id);
        if (!deleted)
            return res.status(404).json({ error: 'Template not found' });
        return res.json({ ok: true, message: 'Template deleted' });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
