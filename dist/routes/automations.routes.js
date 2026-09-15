import { Router } from 'express';
import * as models from '../models/index.js';
const router = Router();
// List automations
router.get('/', async (req, res) => {
    try {
        const org = await models.Organization.findOne();
        const query = org ? { orgId: org._id } : {};
        const automations = await models.Automation.find(query).sort({ updatedAt: -1 });
        return res.json({ ok: true, automations });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Get single automation
router.get('/:id', async (req, res) => {
    try {
        const automation = await models.Automation.findById(req.params.id);
        if (!automation)
            return res.status(404).json({ error: 'Automation not found' });
        return res.json({ ok: true, automation });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Create automation
router.post('/', async (req, res) => {
    try {
        const { name, trigger, steps, accountId } = req.body;
        const org = await models.Organization.findOne();
        const orgId = org ? org._id : 'org_workspace';
        // Find first active account if not specified
        let targetAccountId = accountId;
        if (!targetAccountId) {
            const firstAcc = await models.SocialAccount.findOne();
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
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Update automation
router.put('/:id', async (req, res) => {
    try {
        const { name, trigger, steps, status, accountId } = req.body;
        const automation = await models.Automation.findByIdAndUpdate(req.params.id, {
            $set: {
                ...(name && { name }),
                ...(trigger && { trigger }),
                ...(steps && { steps }),
                ...(status && { status }),
                ...(accountId && { accountId }),
            },
        }, { returnDocument: 'after' });
        if (!automation)
            return res.status(404).json({ error: 'Automation not found' });
        return res.json({ ok: true, automation });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Toggle status (live <-> paused)
router.patch('/:id/toggle', async (req, res) => {
    try {
        const auto = await models.Automation.findById(req.params.id);
        if (!auto)
            return res.status(404).json({ error: 'Automation not found' });
        const newStatus = auto.status === 'live' ? 'paused' : 'live';
        auto.status = newStatus;
        await auto.save();
        return res.json({ ok: true, automation: auto, status: newStatus });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// Delete automation
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await models.Automation.findByIdAndDelete(req.params.id);
        if (!deleted)
            return res.status(404).json({ error: 'Automation not found' });
        return res.json({ ok: true, message: 'Automation deleted successfully' });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
