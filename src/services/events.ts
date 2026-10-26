/**
 * Outbound webhooks: application events delivered to customer endpoints.
 *
 * `emitEvent` fans an event out to the workspace's enabled endpoints that
 * subscribe to it (or to '*'): one `WebhookDelivery` row per endpoint plus a
 * 'webhooks.deliver' job, so delivery happens off the request path with
 * retries. Each POST is signed with the endpoint's secret:
 *   X-BharatAutomate-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>
 * An endpoint is disabled after MAX_CONSECUTIVE_FAILURES failed attempts in a row.
 *
 * Endpoints are customer-supplied URLs, so every delivery re-checks that the
 * host resolves to a public address (no loopback/private/link-local targets)
 * and redirects are not followed.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as models from '../models/index.js';
import type { IJob, IWebhookEndpoint } from '../models/index.js';
import { env } from '../config/env.js';
import { badRequest } from '../lib/http.js';
import { decryptSecret, hmacSha256Hex } from '../lib/crypto.js';
import { newId } from '../lib/ids.js';
import { enqueueJob } from './jobs.js';
import { hasFeature } from './entitlements.js';
import { notify } from './notify.js';

export type AppEvent =
  | 'contact.created'
  | 'contact.updated'
  | 'lead.created'
  | 'lead.updated'
  | 'message.received'
  | 'message.sent'
  | 'automation.triggered'
  | 'post.published'
  | 'broadcast.completed'
  | 'approval.created'
  | 'subscription.updated';

export const APP_EVENTS: AppEvent[] = [
  'contact.created',
  'contact.updated',
  'lead.created',
  'lead.updated',
  'message.received',
  'message.sent',
  'automation.triggered',
  'post.published',
  'broadcast.completed',
  'approval.created',
  'subscription.updated',
];

export function isAppEvent(value: unknown): value is AppEvent {
  return typeof value === 'string' && (APP_EVENTS as string[]).includes(value);
}

export const WEBHOOK_DELIVER_JOB = 'webhooks.deliver';
export const WEBHOOK_MAX_ATTEMPTS = 6;
export const MAX_CONSECUTIVE_FAILURES = 20;
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_ERROR_CHARS = 300;
const USER_AGENT = 'BharatAutomate-Webhooks/1.0';

/** Body sent to endpoints. `id` is the event id (stable across endpoints and retries). */
export interface WebhookEnvelope {
  id: string;
  event: AppEvent | 'ping';
  createdAt: string;
  orgId: string;
  data: Record<string, unknown>;
}

export interface DeliveryAttemptResult {
  ok: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

/** `sha256=<hex>` signature header value for a raw request body. */
export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${hmacSha256Hex(secret, body)}`;
}

// --- URL safety --------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('ff')
  );
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true;
}

/**
 * Throws 400 unless `url` is an absolute http(s) URL whose host resolves only to
 * public addresses (https required in production). Use when saving an endpoint;
 * deliveries re-check because DNS can change.
 */
export async function assertPublicWebhookUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest('Webhook URL must be a valid absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw badRequest('Webhook URL must use https');
  if (env.isProd && parsed.protocol !== 'https:') throw badRequest('Webhook URL must use https');
  if (parsed.username || parsed.password) throw badRequest('Webhook URL must not contain credentials');

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw badRequest('Webhook URL must point to a public host');
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true }).catch(() => [])).map((entry) => entry.address);
  if (addresses.length === 0) throw badRequest('Webhook URL host could not be resolved');
  if (addresses.some(isPrivateAddress)) throw badRequest('Webhook URL must point to a public address');
  return parsed;
}

// --- Emit ------------------------------------------------------------------------------------

/**
 * Queues `event` for every enabled endpoint of the org subscribed to it.
 * Never throws (it sits on hot paths such as message sends); skipped when the
 * plan does not include outbound webhooks.
 */
export async function emitEvent(orgId: string, event: AppEvent, data: Record<string, unknown>): Promise<void> {
  try {
    const endpoints = await models.WebhookEndpoint.find({ orgId, enabled: true, events: { $in: [event, '*'] } }, { _id: 1 }).lean();
    if (endpoints.length === 0) return;
    if (!(await hasFeature(orgId, 'webhooks_out'))) return;

    const envelope: WebhookEnvelope = {
      id: newId('evt'),
      event,
      createdAt: new Date().toISOString(),
      orgId,
      data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
    };

    for (const endpoint of endpoints) {
      const deliveryId = newId('whd');
      await models.WebhookDelivery.create({
        _id: deliveryId,
        orgId,
        endpointId: endpoint._id,
        event,
        payload: envelope as unknown as Record<string, unknown>,
        status: 'pending',
        attempts: 0,
      });
      await enqueueJob(WEBHOOK_DELIVER_JOB, { deliveryId }, { orgId, dedupeKey: `whd:${deliveryId}`, maxAttempts: WEBHOOK_MAX_ATTEMPTS });
    }
  } catch (error) {
    console.error(`[Events] Failed to emit "${event}":`, error instanceof Error ? error.message : error);
  }
}

// --- Delivery --------------------------------------------------------------------------------

/** One signed POST of `body` to an endpoint. Never throws. */
export async function postToEndpoint(
  endpoint: Pick<IWebhookEndpoint, 'url' | 'secret'>,
  event: string,
  deliveryId: string,
  body: string,
): Promise<DeliveryAttemptResult> {
  const startedAt = Date.now();
  try {
    await assertPublicWebhookUrl(endpoint.url);
    const secret = decryptSecret(endpoint.secret);
    if (!secret) return { ok: false, status: 0, durationMs: 0, error: 'Endpoint secret is unreadable; rotate the secret' };

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-BharatAutomate-Event': event,
        'X-BharatAutomate-Delivery': deliveryId,
        'X-BharatAutomate-Signature': signWebhookBody(secret, body),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    const durationMs = Date.now() - startedAt;
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: true, status: response.status, durationMs };
    }
    const text = (await response.text().catch(() => '')).slice(0, MAX_RESPONSE_ERROR_CHARS);
    return { ok: false, status: response.status, durationMs, error: `HTTP ${response.status}${text ? `: ${text}` : ''}` };
  } catch (error) {
    const message = error instanceof Error ? (error.name === 'TimeoutError' ? `Timed out after ${DELIVERY_TIMEOUT_MS / 1000}s` : error.message) : String(error);
    return { ok: false, status: 0, durationMs: Date.now() - startedAt, error: message.slice(0, MAX_RESPONSE_ERROR_CHARS) };
  }
}

async function recordEndpointFailure(endpoint: IWebhookEndpoint, result: DeliveryAttemptResult): Promise<void> {
  const updated = await models.WebhookEndpoint.findOneAndUpdate(
    { _id: endpoint._id, orgId: endpoint.orgId },
    { $inc: { failureCount: 1 }, $set: { lastDeliveryAt: new Date(), lastStatus: result.status, lastError: result.error } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated || !updated.enabled || updated.failureCount < MAX_CONSECUTIVE_FAILURES) return;

  const disabled = await models.WebhookEndpoint.updateOne(
    { _id: endpoint._id, orgId: endpoint.orgId, enabled: true },
    { $set: { enabled: false, disabledAt: new Date(), disabledReason: `Disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failed deliveries` } },
  );
  if (disabled.modifiedCount > 0) {
    await notify(endpoint.orgId, {
      type: 'system',
      severity: 'error',
      title: 'Webhook endpoint disabled',
      body: `${endpoint.url} failed ${MAX_CONSECUTIVE_FAILURES} deliveries in a row and was disabled. Fix the endpoint, then re-enable it in Settings → Developers.`,
      link: '/settings?tab=developers',
    });
  }
}

/**
 * 'webhooks.deliver' job handler. Throws on a failed attempt so the job queue
 * retries with backoff; on the final attempt the delivery is marked failed instead.
 */
export async function deliverWebhookJob(payload: { deliveryId?: unknown }, job: IJob): Promise<Record<string, unknown>> {
  const deliveryId = typeof payload.deliveryId === 'string' ? payload.deliveryId : '';
  const delivery = deliveryId ? await models.WebhookDelivery.findById(deliveryId).lean() : null;
  if (!delivery) return { skipped: 'delivery not found' };
  if (delivery.status === 'success') return { skipped: 'already delivered' };

  const endpoint = await models.WebhookEndpoint.findOne({ _id: delivery.endpointId, orgId: delivery.orgId }).lean();
  if (!endpoint || !endpoint.enabled) {
    await models.WebhookDelivery.updateOne(
      { _id: delivery._id },
      { $set: { status: 'failed', error: endpoint ? 'Endpoint is disabled' : 'Endpoint was deleted' } },
    );
    return { skipped: 'endpoint unavailable' };
  }

  const body = JSON.stringify(delivery.payload ?? {});
  const result = await postToEndpoint(endpoint, delivery.event, delivery._id, body);

  if (result.ok) {
    await Promise.all([
      models.WebhookDelivery.updateOne(
        { _id: delivery._id },
        {
          $set: { status: 'success', responseStatus: result.status, durationMs: result.durationMs, deliveredAt: new Date() },
          $inc: { attempts: 1 },
          $unset: { error: 1 },
        },
      ),
      models.WebhookEndpoint.updateOne(
        { _id: endpoint._id, orgId: endpoint.orgId },
        { $set: { failureCount: 0, lastDeliveryAt: new Date(), lastStatus: result.status }, $unset: { lastError: 1 } },
      ),
    ]);
    return { status: result.status, durationMs: result.durationMs };
  }

  const finalAttempt = job.attempts >= job.maxAttempts;
  await models.WebhookDelivery.updateOne(
    { _id: delivery._id },
    {
      $set: { status: finalAttempt ? 'failed' : 'pending', responseStatus: result.status, durationMs: result.durationMs, error: result.error },
      $inc: { attempts: 1 },
    },
  );
  await recordEndpointFailure(endpoint, result);

  if (finalAttempt) return { failed: true, status: result.status, error: result.error };
  throw new Error(`Webhook delivery failed: ${result.error ?? `HTTP ${result.status}`}`);
}

/**
 * Sends a signed 'ping' event to an endpoint immediately (no retries) and logs
 * it as a delivery — used by the "Send test" button.
 */
export async function sendTestPing(endpoint: IWebhookEndpoint): Promise<DeliveryAttemptResult & { deliveryId: string }> {
  const deliveryId = newId('whd');
  const envelope: WebhookEnvelope = {
    id: newId('evt'),
    event: 'ping',
    createdAt: new Date().toISOString(),
    orgId: endpoint.orgId,
    data: { message: 'This is a test event from BharatAutomate.' },
  };
  const body = JSON.stringify(envelope);
  const result = await postToEndpoint(endpoint, 'ping', deliveryId, body);
  await models.WebhookDelivery.create({
    _id: deliveryId,
    orgId: endpoint.orgId,
    endpointId: endpoint._id,
    event: 'ping',
    payload: envelope as unknown as Record<string, unknown>,
    status: result.ok ? 'success' : 'failed',
    attempts: 1,
    responseStatus: result.status,
    durationMs: result.durationMs,
    error: result.error,
    deliveredAt: result.ok ? new Date() : undefined,
  });
  await models.WebhookEndpoint.updateOne(
    { _id: endpoint._id, orgId: endpoint.orgId },
    { $set: { lastDeliveryAt: new Date(), lastStatus: result.status, ...(result.ok ? {} : { lastError: result.error }) } },
  );
  return { ...result, deliveryId };
}
