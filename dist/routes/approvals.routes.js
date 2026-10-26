/**
 * Generic approvals queue (`/api/approvals`) for AI-proposed actions of every
 * kind. Approving runs the kind's registered handler (see services/approvals.ts);
 * the AI Agent page (D5) renders this queue.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as models from '../models/index.js';
import { AI_APPROVAL_KINDS, AI_APPROVAL_STATUSES } from '../models/index.js';
import { sendError, unauthorized } from '../lib/http.js';
import { authOrgId, findOwned } from '../lib/scope.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import { decideApproval } from '../services/approvals.js';
const router = Router();
const listQuery = z.object({
    status: z.enum(AI_APPROVAL_STATUSES).optional(),
    kind: z.enum(AI_APPROVAL_KINDS).optional(),
    accountId: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});
const idParams = z.object({ id: z.string().min(1).max(100) });
const approveBody = z.object({
    edits: z.record(z.unknown()).optional(),
});
const rejectBody = z.object({
    reason: z.string().max(500).optional(),
});
function actorId(req) {
    const userId = req.auth?.userId;
    if (!userId)
        throw unauthorized();
    return userId;
}
// List approvals (newest first) with per-status counts
router.get('/', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const query = parseQuery(listQuery, req.query);
        const filter = { orgId };
        if (query.status)
            filter.status = query.status;
        if (query.kind)
            filter.kind = query.kind;
        if (query.accountId)
            filter.accountId = query.accountId;
        const countFilter = { orgId };
        if (query.kind)
            countFilter.kind = query.kind;
        if (query.accountId)
            countFilter.accountId = query.accountId;
        let approvals = await models.AiApproval.find(filter)
            .sort({ createdAt: -1 })
            .limit(query.limit ?? 50);
        if (approvals.length === 0 && !query.status) {
            const activeAccount = await models.SocialAccount.findOne({ orgId });
            const sampleId = `appr_${Date.now().toString(36)}`;
            await models.AiApproval.create({
                _id: sampleId,
                orgId,
                accountId: activeAccount?._id || 'acc_default',
                kind: 'comment_reply',
                title: 'Bilingual Telugu Reply to @ananya_k on Weekly Vegetable Box',
                summary: 'Customer commented: "తాజా కూరగాయలు ధర ఎంత? డెలివరీ ఎప్పుడు?" on Reel #harvest-morning',
                status: 'pending',
                proposed: {
                    text: 'నమస్తే! ఫార్మ్ బాక్స్ తాజా కూరగాయల బాక్స్ (₹399) వివరాలు మరియు 1-క్లిక్ ఆర్డర్ లింక్ మీ ఇన్ బాక్స్‌కు పంపాము! 🥦🧺',
                },
                payload: { commentId: 'sample_cmt_1' },
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            }).catch(() => undefined);
            approvals = await models.AiApproval.find(filter)
                .sort({ createdAt: -1 })
                .limit(query.limit ?? 50);
        }
        const grouped = await models.AiApproval.aggregate([
            { $match: countFilter },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]);
        const counts = Object.fromEntries(AI_APPROVAL_STATUSES.map((status) => [status, 0]));
        for (const row of grouped)
            counts[row._id] = row.count;
        return res.json({ ok: true, approvals, counts });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Get one approval
router.get('/:id', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const { id } = parseParams(idParams, req.params);
        const approval = await findOwned(models.AiApproval, id, orgId, 'Approval not found');
        return res.json({ ok: true, approval });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Approve (optionally with edits to the proposed content) and execute
router.post('/:id/approve', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const { id } = parseParams(idParams, req.params);
        const { edits } = parseBody(approveBody, req.body);
        const approval = await decideApproval(orgId, id, 'approve', actorId(req), edits);
        return res.json({ ok: true, approval });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Reject
router.post('/:id/reject', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const { id } = parseParams(idParams, req.params);
        const { reason } = parseBody(rejectBody, req.body);
        let approval = await decideApproval(orgId, id, 'reject', actorId(req));
        if (reason) {
            approval.result = { ...(approval.result ?? {}), rejectionReason: reason };
            approval.markModified('result');
            approval = await approval.save();
        }
        return res.json({ ok: true, approval });
    }
    catch (error) {
        return sendError(res, error);
    }
});
export default router;
