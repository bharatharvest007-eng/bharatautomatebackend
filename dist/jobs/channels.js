/**
 * Background jobs for: Webhook processing, 60-day token auto-refresh, account health checks.
 * Owner: Channels & Connect.
 */
import axios from 'axios';
import * as models from '../models/index.js';
import { registerRecurring } from '../services/jobs.js';
import { accountToken, encryptSecret } from '../lib/crypto.js';
import { MetaService } from '../services/metaService.js';
import { notify } from '../services/notify.js';
const HOUR_MS = 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * HOUR_MS;
const FIFTEEN_DAYS_MS = 15 * 24 * HOUR_MS;
export function register() {
    // Recurring job: Auto-refresh Meta / Instagram long-lived tokens before the 60-day expiry
    registerRecurring('tokens.refresh', TWELVE_HOURS_MS, async () => {
        console.log('[Jobs:Channels] Running scheduled token refresh sweep...');
        const threshold = new Date(Date.now() + FIFTEEN_DAYS_MS);
        // Find active Instagram & Facebook accounts whose tokens expire within the next 15 days
        const accounts = await models.SocialAccount.find({
            status: 'active',
            $or: [
                { tokenExpiresAt: { $lte: threshold } },
                { tokenExpiresAt: { $exists: false } },
            ],
        });
        let refreshed = 0;
        let failed = 0;
        for (const account of accounts) {
            const rawToken = accountToken(account);
            if (!rawToken)
                continue;
            try {
                if (account.platform === 'instagram' && account.loginMode === 'instagram') {
                    // Instagram Long-Lived Token Refresh
                    const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(rawToken)}`;
                    const res = await axios.get(url, { timeout: 15_000 });
                    const data = res.data;
                    if (data?.access_token) {
                        const expiresInSeconds = Number(data.expires_in) || 60 * 24 * 60 * 60;
                        const newExpiry = new Date(Date.now() + expiresInSeconds * 1000);
                        await models.SocialAccount.updateOne({ _id: account._id }, {
                            $set: {
                                accessToken: encryptSecret(data.access_token),
                                tokenExpiresAt: newExpiry,
                                lastRefreshedAt: new Date(),
                                statusReason: null,
                            },
                        });
                        refreshed++;
                        console.log(`[Jobs:Channels] Successfully refreshed Instagram token for @${account.username}`);
                    }
                }
                else {
                    // Validate and verify Facebook Page token / PAT
                    const validation = await MetaService.validateToken(rawToken);
                    if (validation.valid) {
                        await models.SocialAccount.updateOne({ _id: account._id }, {
                            $set: {
                                lastRefreshedAt: new Date(),
                                statusReason: null,
                                // Extend expiry assumption by 60 days
                                tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                            },
                        });
                        refreshed++;
                    }
                    else {
                        throw new Error(validation.error || 'Invalid token');
                    }
                }
            }
            catch (e) {
                failed++;
                console.error(`[Jobs:Channels] Failed to refresh token for @${account.username}:`, e.message);
                await models.SocialAccount.updateOne({ _id: account._id }, { $set: { statusReason: `Token refresh failed: ${e.message}` } });
                await notify(account.orgId, {
                    type: 'system',
                    severity: 'warning',
                    title: `Action needed: ${account.username} connection`,
                    body: `Token auto-refresh failed (${e.message}). Please reconnect in Accounts.`,
                    link: '/accounts',
                }).catch(() => undefined);
            }
        }
        console.log(`[Jobs:Channels] Token refresh complete: ${refreshed} refreshed, ${failed} failed.`);
    }, { initialDelayMs: 2 * 60 * 1000 });
    // Recurring job: Daily account health check
    registerRecurring('accounts.health_check', 24 * HOUR_MS, async () => {
        console.log('[Jobs:Channels] Running daily account health verification...');
        const accounts = await models.SocialAccount.find({ status: 'active' });
        for (const account of accounts) {
            const token = accountToken(account);
            if (!token)
                continue;
            const validation = await MetaService.validateToken(token);
            if (!validation.valid) {
                await models.SocialAccount.updateOne({ _id: account._id }, { $set: { status: 'error', statusReason: validation.error } });
            }
        }
    }, { initialDelayMs: 10 * 60 * 1000 });
}
