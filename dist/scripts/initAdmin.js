/**
 * Bootstraps the first owner account and workspace (`npm run db:init`).
 *
 * Reads INIT_ADMIN_EMAIL, INIT_ADMIN_PASSWORD (min 8 chars), INIT_ADMIN_NAME,
 * INIT_WORKSPACE_NAME and optional INIT_WORKSPACE_PLAN. Idempotent:
 * - new email → creates the workspace (14-day Growth trial unless a plan is
 *   given) and its owner with a hashed password;
 * - existing user without a workspace → creates one and makes them owner;
 * - existing user with a workspace → only backfills missing workspace fields
 *   (ownerId, widgetKey). The password is changed only with `--reset-password`.
 * The bootstrap user is marked super admin (platform-level Meta settings).
 */
import '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import * as models from '../models/index.js';
import { hashPassword, isLegacyPasswordHash } from '../lib/crypto.js';
import { newId, newWidgetKey, uniqueOrgSlug } from '../lib/ids.js';
import { PLANS, TRIAL_DAYS, TRIAL_PLAN, isPlanId } from '../config/plans.js';
const args = new Set(process.argv.slice(2));
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function fail(message) {
    console.error(`[InitAdmin] ${message}`);
    process.exit(1);
}
function readConfig() {
    const email = (process.env.INIT_ADMIN_EMAIL ?? '').trim().toLowerCase();
    const password = process.env.INIT_ADMIN_PASSWORD ?? '';
    const name = (process.env.INIT_ADMIN_NAME ?? '').trim() || 'Workspace Owner';
    const workspaceName = (process.env.INIT_WORKSPACE_NAME ?? '').trim() || 'My Workspace';
    const planRaw = (process.env.INIT_WORKSPACE_PLAN ?? '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email))
        fail('Set INIT_ADMIN_EMAIL to a valid email address.');
    if (password.length < 8)
        fail('Set INIT_ADMIN_PASSWORD (at least 8 characters).');
    if (planRaw && !isPlanId(planRaw))
        fail(`INIT_WORKSPACE_PLAN must be one of: ${Object.keys(PLANS).join(', ')}.`);
    return { email, password, name, workspaceName, plan: planRaw && isPlanId(planRaw) ? planRaw : null };
}
function initialBilling(config) {
    if (!config.plan) {
        return {
            plan: 'free',
            billing: {
                provider: 'none',
                status: 'trialing',
                trialPlan: TRIAL_PLAN,
                trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
            },
        };
    }
    if (config.plan === 'free') {
        return { plan: 'free', billing: { provider: 'none', status: 'free' } };
    }
    // Complimentary plan: active with no provider and no period end, so billing jobs leave it alone.
    return { plan: config.plan, billing: { provider: 'none', status: 'active', planId: config.plan } };
}
async function createWorkspace(config, ownerId) {
    const orgId = newId('org');
    const { plan, billing } = initialBilling(config);
    await models.Organization.create({
        _id: orgId,
        name: config.workspaceName,
        slug: await uniqueOrgSlug(config.workspaceName),
        plan,
        billing,
        ownerId,
        widgetKey: newWidgetKey(),
    });
    console.log(`[InitAdmin] Created workspace "${config.workspaceName}" (${orgId}) on plan ${plan}${billing.status === 'trialing' ? ` with a ${TRIAL_DAYS}-day ${PLANS[TRIAL_PLAN].name} trial` : ''}`);
    return orgId;
}
async function backfillWorkspace(orgId, ownerId) {
    const org = await models.Organization.findById(orgId).lean();
    if (!org) {
        console.warn(`[InitAdmin] Membership points at missing workspace ${orgId}`);
        return;
    }
    const updates = {};
    if (!org.ownerId)
        updates.ownerId = ownerId;
    if (!org.widgetKey)
        updates.widgetKey = newWidgetKey();
    if (Object.keys(updates).length > 0) {
        await models.Organization.updateOne({ _id: orgId }, { $set: updates });
        console.log(`[InitAdmin] Backfilled workspace ${orgId}: ${Object.keys(updates).join(', ')}`);
    }
    else {
        console.log(`[InitAdmin] Workspace ${orgId} already complete`);
    }
}
async function initAdmin() {
    const config = readConfig();
    await connectDB();
    try {
        const existing = await models.User.findOne({ email: config.email });
        if (!existing) {
            const userId = newId('usr');
            const orgId = await createWorkspace(config, userId);
            await models.User.create({
                _id: userId,
                email: config.email,
                name: config.name,
                passwordHash: await hashPassword(config.password),
                isSuperAdmin: true,
                memberships: [{ orgId, role: 'owner' }],
            });
            console.log(`[InitAdmin] Created owner ${config.email} (${userId}). Sign in at the dashboard with this email and password.`);
            return;
        }
        const updates = { isSuperAdmin: true };
        if (args.has('--reset-password')) {
            updates.passwordHash = await hashPassword(config.password);
            console.log('[InitAdmin] Password reset for existing user');
        }
        else if (existing.passwordHash && isLegacyPasswordHash(existing.passwordHash)) {
            console.warn('[InitAdmin] This user still has a legacy (unhashed) password. Re-run with --reset-password, or sign in once to upgrade it.');
        }
        const membership = existing.memberships?.[0];
        if (membership) {
            await backfillWorkspace(membership.orgId, existing._id);
        }
        else {
            const orgId = await createWorkspace(config, existing._id);
            updates.memberships = [{ orgId, role: 'owner' }];
        }
        await models.User.updateOne({ _id: existing._id }, { $set: updates });
        console.log(`[InitAdmin] User ${config.email} (${existing._id}) is ready`);
    }
    finally {
        await disconnectDB();
    }
}
initAdmin().catch(async (error) => {
    console.error('[InitAdmin] Failed:', error instanceof Error ? error.message : error);
    await disconnectDB().catch(() => undefined);
    process.exit(1);
});
