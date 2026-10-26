/**
 * Authentication and account endpoints (`/api/auth`), mounted publicly.
 *
 * Signup creates a workspace (14-day Growth trial) with its owner; login
 * verifies scrypt hashes (legacy plaintext rows are verified once and
 * rehashed); invites let the owner add up to three members. Sessions are
 * issued by `issueSession` (httpOnly cookie + Bearer token for the SPA).
 * Brute-force protection: per-IP limits on every credential endpoint plus a
 * per-email limit on login.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import * as models from '../models/index.js';
import type { IOrganization, IUser } from '../models/index.js';
import { TRIAL_DAYS, TRIAL_PLAN, type Entitlements } from '../config/plans.js';
import { HttpError, badRequest, conflict, forbidden, notFound, sendError, unauthorized } from '../lib/http.js';
import { hashPassword, isLegacyPasswordHash, sha256, verifyPassword } from '../lib/crypto.js';
import { newId, newWidgetKey, uniqueOrgSlug } from '../lib/ids.js';
import { parseBody, parseParams } from '../lib/validate.js';
import { destroySession, destroyUserSessions, issueSession, normalizeRole, optionalAuth, requireAuth, requireSessionAuth } from '../middleware/auth.js';
import { clientIp, rateLimit } from '../middleware/security.js';
import { assertQuota, buildEntitlements, getEntitlements, getUsageSummary, invalidateEntitlements } from '../services/entitlements.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';

const router = Router();

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const INVALID_CREDENTIALS = 'Invalid email or password';
const INVITE_INVALID = 'This invite link is invalid or has expired';

// Verified against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH_PROMISE = hashPassword('timing-equalizer-not-a-real-password');

// --- Rate limits ---------------------------------------------------------------------------

const signupLimit = rateLimit({ name: 'auth-signup', windowMs: MINUTE_MS, max: 5, message: 'Too many signup attempts. Please wait a minute.' });
const loginLimit = rateLimit({ name: 'auth-login', windowMs: MINUTE_MS, max: 10, message: 'Too many login attempts. Please wait a minute.' });
const loginEmailLimit = rateLimit({
  name: 'auth-login-email',
  windowMs: 15 * MINUTE_MS,
  max: 20,
  key: (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : `ip:${clientIp(req)}`;
  },
  message: 'Too many login attempts for this account. Please wait 15 minutes.',
});
const passwordLimit = rateLimit({ name: 'auth-password', windowMs: 15 * MINUTE_MS, max: 10, message: 'Too many attempts. Please wait 15 minutes.' });
const inviteLimit = rateLimit({ name: 'auth-invite', windowMs: MINUTE_MS, max: 20 });

// --- Validation --------------------------------------------------------------------------------

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(200, 'Password is too long');
const personName = z.string().trim().min(1, 'Name is required').max(80);
const timezone = z.string().trim().max(64).refine(isValidTimezone, 'Unknown timezone');

const signupBody = z.object({
  name: personName,
  email,
  password,
  workspaceName: z.string().trim().min(1).max(80).optional(),
  timezone: timezone.optional(),
});

const loginBody = z.object({
  email,
  // No min length here: legacy accounts may have shorter passwords.
  password: z.string().min(1, 'Password is required').max(200),
});

const profileBody = z
  .object({
    name: personName.optional(),
    avatarUrl: z.union([z.string().trim().url('Avatar must be a URL').max(1_000), z.literal('')]).optional(),
    timezone: timezone.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(200),
  newPassword: password,
});

const inviteTokenParams = z.object({ token: z.string().min(16).max(200) });

const acceptInviteBody = z.object({
  token: z.string().min(16).max(200),
  name: personName,
  password,
});

// --- Response shapes -----------------------------------------------------------------------------

type UserFields = Pick<IUser, '_id' | 'email' | 'name' | 'avatarUrl' | 'timezone' | 'isSuperAdmin'>;
type OrgFields = Pick<IOrganization, '_id' | 'name' | 'slug' | 'timezone' | 'widgetKey' | 'locale' | 'industry'>;

function publicUser(user: UserFields) {
  return {
    id: user._id,
    email: user.email,
    name: user.name ?? '',
    avatarUrl: user.avatarUrl ?? null,
    timezone: user.timezone ?? 'UTC',
    isSuperAdmin: Boolean(user.isSuperAdmin),
  };
}

function publicOrganization(org: OrgFields, entitlements: Entitlements) {
  return {
    id: org._id,
    name: org.name,
    slug: org.slug,
    timezone: org.timezone ?? 'UTC',
    locale: org.locale ?? 'en',
    industry: org.industry ?? null,
    plan: entitlements.plan,
    widgetKey: org.widgetKey ?? null,
  };
}

/** The signed-in user's workspace (memberships[0]); 403 when they have none. */
async function loadWorkspace(user: Pick<IUser, 'memberships'>) {
  const membership = user.memberships?.[0];
  if (!membership) throw forbidden('This account is not a member of any workspace', 'NO_WORKSPACE');
  const org = await models.Organization.findById(membership.orgId).lean();
  if (!org) throw forbidden('This account is not a member of any workspace', 'NO_WORKSPACE');
  return { org, role: normalizeRole(membership.role) };
}

function requireUserId(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw unauthorized();
  return userId;
}

async function findValidInvite(token: string) {
  const invite = await models.Invite.findOne({ tokenHash: sha256(token), acceptedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).lean();
  if (!invite) throw notFound(INVITE_INVALID);
  return invite;
}

// --- Routes --------------------------------------------------------------------------------------------

// Sign up: create a workspace on a 14-day trial and its owner
router.post('/signup', signupLimit, async (req, res) => {
  try {
    const body = parseBody(signupBody, req.body);
    if (await models.User.exists({ email: body.email })) {
      throw conflict('An account with this email already exists. Sign in instead.', 'EMAIL_TAKEN');
    }

    const now = new Date();
    const orgId = newId('org');
    const userId = newId('usr');
    const passwordHash = await hashPassword(body.password);
    const workspaceName = body.workspaceName ?? `${body.name.split(' ')[0]}'s workspace`;

    const org = await models.Organization.create({
      _id: orgId,
      name: workspaceName,
      slug: await uniqueOrgSlug(workspaceName),
      plan: 'free',
      timezone: body.timezone ?? 'Asia/Kolkata',
      ownerId: userId,
      widgetKey: newWidgetKey(),
      billing: {
        provider: 'none',
        status: 'trialing',
        trialPlan: TRIAL_PLAN,
        trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
      },
    });

    let user;
    try {
      user = await models.User.create({
        _id: userId,
        email: body.email,
        name: body.name,
        passwordHash,
        timezone: body.timezone ?? 'Asia/Kolkata',
        memberships: [{ orgId, role: 'owner' }],
        lastLoginAt: now,
      });
    } catch (error) {
      // Lost a race with another signup for the same email: undo the orphan workspace.
      await models.Organization.deleteOne({ _id: orgId });
      if ((error as { code?: number }).code === 11000) {
        throw conflict('An account with this email already exists. Sign in instead.', 'EMAIL_TAKEN');
      }
      throw error;
    }

    const token = await issueSession(res, req, userId, orgId);
    const entitlements = buildEntitlements(org);
    audit({ orgId, userId, ip: req.ip }, 'auth.signup', { type: 'user', id: userId });
    void notify(orgId, {
      type: 'system',
      severity: 'success',
      title: 'Welcome to BharatAutomate!',
      body: `Your ${TRIAL_DAYS}-day Growth trial has started. Connect your Instagram account to launch your first automation.`,
      link: '/accounts',
      dedupeKey: 'welcome',
    });

    return res.status(201).json({ ok: true, token, user: publicUser(user), organization: publicOrganization(org, entitlements) });
  } catch (error) {
    return sendError(res, error);
  }
});

// Log in with email and password
router.post('/login', loginLimit, loginEmailLimit, async (req, res) => {
  try {
    const body = parseBody(loginBody, req.body);
    const user = await models.User.findOne({ email: body.email });

    let valid = false;
    if (user?.passwordHash) {
      valid = await verifyPassword(body.password, user.passwordHash);
    } else {
      await verifyPassword(body.password, await DUMMY_HASH_PROMISE);
    }
    if (!user || !valid) throw new HttpError(401, INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');

    const { org, role } = await loadWorkspace(user);

    const updates: Record<string, unknown> = { lastLoginAt: new Date() };
    if (user.passwordHash && isLegacyPasswordHash(user.passwordHash)) {
      updates.passwordHash = await hashPassword(body.password);
    }
    await models.User.updateOne({ _id: user._id }, { $set: updates });

    const token = await issueSession(res, req, user._id, org._id);
    const entitlements = await getEntitlements(org._id);
    audit({ orgId: org._id, userId: user._id, ip: req.ip }, 'auth.login', { type: 'user', id: user._id }, updates.passwordHash ? { rehashed: true } : undefined);

    return res.json({ ok: true, token, user: publicUser(user), organization: publicOrganization(org, entitlements), role });
  } catch (error) {
    return sendError(res, error);
  }
});

// Log out (ends the current session)
router.post('/logout', optionalAuth, async (req, res) => {
  try {
    if (req.auth?.via !== 'api_key') await destroySession(req, res);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
});

// Current user, workspace, role, entitlements and usage
router.get('/me', requireAuth, requireSessionAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const user = await models.User.findById(userId).lean();
    if (!user) throw unauthorized();
    const orgId = req.auth?.orgId ?? '';
    const org = await models.Organization.findById(orgId).lean();
    if (!org) throw forbidden('This account is not a member of any workspace', 'NO_WORKSPACE');

    const [entitlements, usage] = await Promise.all([getEntitlements(orgId), getUsageSummary(orgId)]);
    return res.json({
      ok: true,
      user: publicUser(user),
      organization: publicOrganization(org, entitlements),
      role: req.auth?.role ?? 'member',
      entitlements,
      usage,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// Update own profile
router.put('/profile', requireAuth, requireSessionAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const body = parseBody(profileBody, req.body);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.timezone !== undefined) set.timezone = body.timezone;
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl === '') unset.avatarUrl = 1;
      else set.avatarUrl = body.avatarUrl;
    }

    const user = await models.User.findOneAndUpdate(
      { _id: userId },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!user) throw unauthorized();
    return res.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    return sendError(res, error);
  }
});

// Change own password (signs out every other session)
router.post('/change-password', passwordLimit, requireAuth, requireSessionAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const body = parseBody(changePasswordBody, req.body);
    const user = await models.User.findById(userId);
    if (!user) throw unauthorized();
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect', { field: 'currentPassword' });
    }
    if (body.currentPassword === body.newPassword) {
      throw badRequest('Choose a password different from your current one', { field: 'newPassword' });
    }

    user.passwordHash = await hashPassword(body.newPassword);
    await user.save();
    const signedOut = await destroyUserSessions(userId, req.auth?.sessionId);
    audit(req, 'auth.password_changed', { type: 'user', id: userId }, { otherSessionsEnded: signedOut });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
});

// Preview an invite (public, by token)
router.get('/invite/:token', inviteLimit, async (req, res) => {
  try {
    const { token } = parseParams(inviteTokenParams, req.params);
    const invite = await findValidInvite(token);
    const [org, inviter] = await Promise.all([
      models.Organization.findById(invite.orgId, { name: 1 }).lean(),
      models.User.findById(invite.invitedBy, { name: 1, email: 1 }).lean(),
    ]);
    if (!org) throw notFound(INVITE_INVALID);
    return res.json({
      ok: true,
      invite: {
        email: invite.email,
        name: invite.name ?? null,
        workspaceName: org.name,
        invitedByName: inviter?.name || inviter?.email || 'The workspace owner',
        expiresAt: invite.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// Accept an invite: create the member account (or attach a workspace-less account) and sign in
router.post('/accept-invite', inviteLimit, async (req, res) => {
  try {
    const body = parseBody(acceptInviteBody, req.body);
    const invite = await findValidInvite(body.token);
    const orgId = invite.orgId;
    const org = await models.Organization.findById(orgId).lean();
    if (!org) throw notFound(INVITE_INVALID);

    const existing = await models.User.findOne({ email: invite.email });
    if (existing && (existing.memberships?.length ?? 0) > 0) {
      throw conflict('This email already belongs to a workspace. Each account can be in one workspace only.', 'EMAIL_TAKEN');
    }
    if (existing && !(await verifyPassword(body.password, existing.passwordHash))) {
      throw new HttpError(401, 'An account with this email exists. Enter its current password to join.', 'INVALID_CREDENTIALS');
    }

    invalidateEntitlements(orgId);
    await assertQuota(orgId, 'members', 1);

    // Claim the invite atomically so a double submit cannot create two memberships.
    const now = new Date();
    const claimed = await models.Invite.findOneAndUpdate(
      { _id: invite._id, acceptedAt: { $exists: false }, expiresAt: { $gt: now } },
      { $set: { acceptedAt: now } },
      { returnDocument: 'after' },
    );
    if (!claimed) throw notFound(INVITE_INVALID);

    let userId: string;
    let createdUser = false;
    try {
      if (existing) {
        userId = existing._id;
        await models.User.updateOne(
          { _id: userId },
          { $set: { memberships: [{ orgId, role: 'member' }], lastLoginAt: now, ...(existing.name ? {} : { name: body.name }) } },
        );
      } else {
        userId = newId('usr');
        await models.User.create({
          _id: userId,
          email: invite.email,
          name: body.name,
          passwordHash: await hashPassword(body.password),
          timezone: org.timezone ?? 'UTC',
          memberships: [{ orgId, role: 'member' }],
          lastLoginAt: now,
        });
        createdUser = true;
      }
    } catch (error) {
      await models.Invite.updateOne({ _id: invite._id }, { $unset: { acceptedAt: 1 } });
      if ((error as { code?: number }).code === 11000) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
      throw error;
    }

    // Two different invites accepted at the same moment can both pass the quota check; re-count and roll back the loser.
    const entitlements = await getEntitlements(orgId);
    const memberLimit = entitlements.limits.members;
    const members = await models.User.countDocuments({ 'memberships.orgId': orgId });
    if (memberLimit !== null && members > memberLimit) {
      if (createdUser) await models.User.deleteOne({ _id: userId });
      else await models.User.updateOne({ _id: userId }, { $set: { memberships: [] } });
      await models.Invite.updateOne({ _id: invite._id }, { $unset: { acceptedAt: 1 } });
      await assertQuota(orgId, 'members', 1);
      throw conflict('This workspace is already full', 'PLAN_LIMIT');
    }

    await models.Invite.updateOne({ _id: invite._id }, { $set: { acceptedBy: userId } });
    const user = await models.User.findById(userId).lean();
    if (!user) throw notFound('Account not found');

    const token = await issueSession(res, req, userId, orgId);
    audit({ orgId, userId, ip: req.ip }, 'member.joined', { type: 'user', id: userId }, { inviteId: invite._id, invitedBy: invite.invitedBy });
    void notify(orgId, {
      type: 'system',
      severity: 'success',
      title: `${user.name || user.email} joined your workspace`,
      link: '/settings?tab=team',
      userId: org.ownerId,
    });

    return res.json({ ok: true, token, user: publicUser(user), organization: publicOrganization(org, entitlements), role: 'member' });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
