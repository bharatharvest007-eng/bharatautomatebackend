/**
 * Team (`/api/team`), mounted behind `requireAuth, requireSessionAuth`.
 *
 * A workspace is its owner plus up to three members (hard cap 4, lower on
 * smaller plans). The owner invites people with a copyable link (no email is
 * sent): the raw token lives only in the link, the DB keeps sha256(token).
 * Pending invites count against the member limit so the owner cannot hand out
 * more links than seats. Everyone can see the team; only the owner can invite,
 * revoke, regenerate links or remove members, and every such action is audited.
 * Members can leave the workspace themselves.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as models from '../models/index.js';
import { env } from '../config/env.js';
import { MAX_WORKSPACE_MEMBERS } from '../config/plans.js';
import { badRequest, conflict, forbidden, notFound, sendError, unauthorized } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { newId } from '../lib/ids.js';
import { authOrgId } from '../lib/scope.js';
import { parseBody, parseParams } from '../lib/validate.js';
import { destroySession, destroyUserSessions, normalizeRole, requireOwner } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { assertQuota, getEntitlements, invalidateEntitlements } from '../services/entitlements.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';
const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INVITE_DAYS = 7;
const inviteLimit = rateLimit({
    name: 'team-invite',
    windowMs: 60 * 60 * 1000,
    max: 30,
    key: (req) => req.auth?.orgId ?? req.ip ?? 'unknown',
    message: 'Too many invites created. Please wait a while.',
});
const inviteBody = z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
    name: z.string().trim().max(80).optional(),
    expiresInDays: z.coerce.number().int().min(1).max(30).optional(),
});
const regenerateBody = z.object({
    expiresInDays: z.coerce.number().int().min(1).max(30).optional(),
});
const idParams = z.object({ id: z.string().min(1).max(100) });
function requireUserId(req) {
    const userId = req.auth?.userId;
    if (!userId)
        throw unauthorized();
    return userId;
}
function inviteLink(token) {
    return `${env.FRONTEND_URL}/invite/${token}`;
}
function pendingInviteFilter(orgId) {
    return { orgId, acceptedAt: { $exists: false }, expiresAt: { $gt: new Date() } };
}
function inviteView(invite, inviterNames) {
    return {
        id: invite._id,
        email: invite.email,
        name: invite.name ?? null,
        invitedBy: invite.invitedBy,
        invitedByName: inviterNames.get(invite.invitedBy) ?? null,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
    };
}
/** Effective member limit: the plan limit, never above the hard cap of 4. */
async function memberLimit(orgId) {
    const entitlements = await getEntitlements(orgId);
    const limit = entitlements.limits.members;
    return limit === null ? MAX_WORKSPACE_MEMBERS : Math.min(limit, MAX_WORKSPACE_MEMBERS);
}
// List members and pending invites
router.get('/', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const me = requireUserId(req);
        const [users, invites, org, limit] = await Promise.all([
            models.User.find({ 'memberships.orgId': orgId }, { passwordHash: 0 }).sort({ createdAt: 1 }).lean(),
            models.Invite.find(pendingInviteFilter(orgId)).sort({ createdAt: -1 }).lean(),
            models.Organization.findById(orgId, { ownerId: 1 }).lean(),
            memberLimit(orgId),
        ]);
        const names = new Map(users.map((user) => [user._id, user.name || user.email]));
        const missingInviters = invites.map((invite) => invite.invitedBy).filter((id) => !names.has(id));
        if (missingInviters.length > 0) {
            const inviters = await models.User.find({ _id: { $in: missingInviters } }, { name: 1, email: 1 }).lean();
            for (const inviter of inviters)
                names.set(inviter._id, inviter.name || inviter.email);
        }
        const members = users
            .map((user) => {
            const membership = user.memberships.find((m) => m.orgId === orgId);
            const role = user._id === org?.ownerId ? 'owner' : normalizeRole(membership?.role);
            return {
                id: user._id,
                name: user.name ?? '',
                email: user.email,
                avatarUrl: user.avatarUrl ?? null,
                role,
                lastSeenAt: user.lastSeenAt ?? user.lastLoginAt ?? null,
                lastLoginAt: user.lastLoginAt ?? null,
                joinedAt: user.createdAt,
                isYou: user._id === me,
            };
        })
            .sort((a, b) => (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1));
        return res.json({
            ok: true,
            members,
            invites: invites.map((invite) => inviteView(invite, names)),
            seats: { used: members.length, pending: invites.length, limit, hardCap: MAX_WORKSPACE_MEMBERS },
            canManage: req.auth?.role === 'owner',
        });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Create an invite link (owner only)
router.post('/invites', requireOwner, inviteLimit, async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const userId = requireUserId(req);
        const body = parseBody(inviteBody, req.body);
        const existingUser = await models.User.findOne({ email: body.email }, { memberships: 1 }).lean();
        if (existingUser?.memberships?.some((m) => m.orgId === orgId)) {
            throw conflict('This person is already a member of your workspace', 'ALREADY_MEMBER');
        }
        if (existingUser && (existingUser.memberships?.length ?? 0) > 0) {
            throw conflict('This email already belongs to another workspace. Each account can be in one workspace only.', 'EMAIL_TAKEN');
        }
        // Re-inviting the same email replaces its previous link instead of taking another seat.
        await models.Invite.deleteMany({ ...pendingInviteFilter(orgId), email: body.email });
        const pending = await models.Invite.countDocuments(pendingInviteFilter(orgId));
        invalidateEntitlements(orgId);
        await assertQuota(orgId, 'members', 1 + pending);
        const used = await models.User.countDocuments({ 'memberships.orgId': orgId });
        if (used + pending + 1 > MAX_WORKSPACE_MEMBERS) {
            throw conflict(`A workspace can have at most ${MAX_WORKSPACE_MEMBERS} people, including pending invites.`, 'SEAT_CAP');
        }
        const token = randomToken(32);
        const days = body.expiresInDays ?? DEFAULT_INVITE_DAYS;
        const invite = await models.Invite.create({
            _id: newId('inv'),
            orgId,
            email: body.email,
            name: body.name || undefined,
            tokenHash: sha256(token),
            invitedBy: userId,
            expiresAt: new Date(Date.now() + days * DAY_MS),
        });
        audit(req, 'member.invited', { type: 'invite', id: invite._id }, { email: body.email, expiresInDays: days });
        const names = new Map([[userId, req.auth?.name || req.auth?.email || '']]);
        return res.status(201).json({ ok: true, invite: inviteView(invite.toObject(), names), token, inviteUrl: inviteLink(token) });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Regenerate an invite link (owner only): invalidates the old link, resets the expiry
router.post('/invites/:id/regenerate', requireOwner, inviteLimit, async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const { id } = parseParams(idParams, req.params);
        const body = parseBody(regenerateBody, req.body);
        const token = randomToken(32);
        const days = body.expiresInDays ?? DEFAULT_INVITE_DAYS;
        const invite = await models.Invite.findOneAndUpdate({ _id: id, orgId, acceptedAt: { $exists: false } }, { $set: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + days * DAY_MS) } }, { returnDocument: 'after', runValidators: true }).lean();
        if (!invite)
            throw notFound('Invite not found or already used');
        audit(req, 'member.invite_regenerated', { type: 'invite', id }, { email: invite.email, expiresInDays: days });
        const inviter = await models.User.findById(invite.invitedBy, { name: 1, email: 1 }).lean();
        const names = new Map(inviter ? [[inviter._id, inviter.name || inviter.email]] : []);
        return res.json({ ok: true, invite: inviteView(invite, names), token, inviteUrl: inviteLink(token) });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Revoke a pending invite (owner only)
router.delete('/invites/:id', requireOwner, async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const { id } = parseParams(idParams, req.params);
        const invite = await models.Invite.findOneAndDelete({ _id: id, orgId, acceptedAt: { $exists: false } }).lean();
        if (!invite)
            throw notFound('Invite not found or already used');
        audit(req, 'member.invite_revoked', { type: 'invite', id }, { email: invite.email });
        return res.json({ ok: true });
    }
    catch (error) {
        return sendError(res, error);
    }
});
/** Detaches a user from the workspace: membership, sessions, inbox assignments. */
async function detachMember(orgId, userId) {
    await models.User.updateOne({ _id: userId }, { $pull: { memberships: { orgId } } });
    const [sessions] = await Promise.all([
        destroyUserSessions(userId),
        models.Conversation.updateMany({ orgId, assignedTo: userId }, { $unset: { assignedTo: 1 } }),
    ]);
    invalidateEntitlements(orgId);
    return sessions;
}
// Remove a member (owner only; the owner cannot remove themselves)
router.delete('/members/:id', requireOwner, async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const me = requireUserId(req);
        const { id } = parseParams(idParams, req.params);
        if (id === me)
            throw badRequest('You cannot remove yourself. The owner stays with the workspace.');
        const [user, org] = await Promise.all([
            models.User.findOne({ _id: id, 'memberships.orgId': orgId }, { name: 1, email: 1, memberships: 1 }).lean(),
            models.Organization.findById(orgId, { ownerId: 1 }).lean(),
        ]);
        if (!user)
            throw notFound('Member not found');
        const membership = user.memberships.find((m) => m.orgId === orgId);
        if (user._id === org?.ownerId || normalizeRole(membership?.role) === 'owner') {
            throw forbidden('The workspace owner cannot be removed', 'OWNER_PROTECTED');
        }
        const sessionsEnded = await detachMember(orgId, id);
        audit(req, 'member.removed', { type: 'user', id }, { email: user.email, sessionsEnded });
        return res.json({ ok: true });
    }
    catch (error) {
        return sendError(res, error);
    }
});
// Leave the workspace (members only; ends every session of the caller)
router.post('/leave', async (req, res) => {
    try {
        const orgId = authOrgId(req);
        const me = requireUserId(req);
        if (req.auth?.role === 'owner') {
            throw forbidden('The owner cannot leave the workspace', 'OWNER_PROTECTED');
        }
        const user = await models.User.findOne({ _id: me, 'memberships.orgId': orgId }, { name: 1, email: 1 }).lean();
        if (!user)
            throw notFound('Member not found');
        audit(req, 'member.left', { type: 'user', id: me }, { email: user.email });
        await detachMember(orgId, me);
        await destroySession(req, res);
        const org = await models.Organization.findById(orgId, { ownerId: 1 }).lean();
        void notify(orgId, {
            type: 'system',
            severity: 'info',
            title: `${user.name || user.email} left your workspace`,
            link: '/settings?tab=team',
            userId: org?.ownerId,
        });
        return res.json({ ok: true });
    }
    catch (error) {
        return sendError(res, error);
    }
});
export default router;
