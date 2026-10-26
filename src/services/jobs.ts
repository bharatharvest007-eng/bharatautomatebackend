/**
 * Durable background jobs backed by the `Job` collection.
 *
 * Why Mongo instead of Redis: the app already depends on Mongo and runs as a
 * single process, so one atomic `findOneAndUpdate` claim gives at-least-once
 * execution, retries and scheduling without new infrastructure.
 *
 * Semantics:
 * - `enqueueJob` inserts a job (optionally delayed). A `dedupeKey` is unique
 *   while the job is pending/delayed/active; it is unset when the job finishes,
 *   fails or is cancelled, so the key can be reused afterwards.
 * - The worker claims due jobs (priority desc, runAt asc), runs up to
 *   CONCURRENCY at once, and holds a lock (LOCK_MS). Locks left by a crashed or
 *   hung worker are recovered by the maintenance sweep.
 * - Failures retry with exponential backoff (30s·2^(attempt-1), max 1h) until
 *   `maxAttempts`, then the job is marked `failed`.
 * - Recurring jobs (`registerRecurring`) are ordinary jobs with dedupeKey
 *   `recurring:<name>` that the worker re-enqueues after every run.
 * Handlers must be idempotent: a job can run twice if a worker dies mid-run.
 */
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import * as models from '../models/index.js';
import type { IJob } from '../models/index.js';
import { newId } from '../lib/ids.js';

// `any` on purpose: each job defines its own payload shape and validates it in the handler.
export type JobHandler = (payload: any, job: IJob) => Promise<unknown>;

export interface EnqueueOptions {
  runAt?: Date;
  delayMs?: number;
  dedupeKey?: string;
  orgId?: string;
  /** Higher runs first. Default 0. */
  priority?: number;
  maxAttempts?: number;
  groupKey?: string;
}

interface RegisteredJob {
  handler: JobHandler;
  timeoutMs: number;
}

interface RecurringJob {
  everyMs: number;
  initialDelayMs: number;
}

const CONCURRENCY = 4;
const BUSY_POLL_MS = 1_000;
const IDLE_POLL_MS = 3_000;
const LOCK_MS = 5 * 60 * 1000;
const LOCK_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;
const MAINTENANCE_EVERY_MS = 60_000;
const RECURRING_ENSURE_EVERY_MS = 5 * 60 * 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
const KEEP_FINISHED_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_FAILED_MS = 30 * 24 * 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 25_000;
const MAX_ERROR_LENGTH = 2_000;
const MAX_RESULT_BYTES = 16_384;
const RECURRING_PREFIX = 'recurring:';

const WORKER_ID = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;

const handlers = new Map<string, RegisteredJob>();
const recurring = new Map<string, RecurringJob>();
const activeRuns = new Set<Promise<void>>();

let running = false;
let pollTimer: NodeJS.Timeout | null = null;
let polling = false;
let lastMaintenanceAt = 0;
let lastRecurringEnsureAt = 0;
let lastPurgeAt = 0;
let lastPollErrorLogAt = 0;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

// --- Registration -----------------------------------------------------------------

export function registerJob(name: string, handler: JobHandler, opts: { timeoutMs?: number } = {}): void {
  if (handlers.has(name)) {
    console.warn(`[Jobs] Handler for "${name}" registered twice; the last registration wins`);
  }
  handlers.set(name, { handler, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
}

/**
 * Runs `handler` every `everyMs` (first run after `initialDelayMs`, default
 * `everyMs`). Persisted as a job so a restart does not reset the schedule.
 */
export function registerRecurring(name: string, everyMs: number, handler: () => Promise<void>, opts: { initialDelayMs?: number } = {}): void {
  if (everyMs < 1_000) throw new Error(`[Jobs] Recurring job "${name}" interval must be at least 1s`);
  registerJob(name, async () => handler());
  recurring.set(name, { everyMs, initialDelayMs: opts.initialDelayMs ?? everyMs });
}

// --- Producer API -----------------------------------------------------------------

/** Enqueues a job; returns its id, or null when `dedupeKey` matches a job that is still pending/active. */
export async function enqueueJob(name: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}): Promise<string | null> {
  const now = Date.now();
  const runAt = opts.runAt ?? new Date(now + Math.max(0, opts.delayMs ?? 0));
  const id = newId('job');
  try {
    await models.Job.create({
      _id: id,
      orgId: opts.orgId,
      queue: 'default',
      name,
      payload,
      status: runAt.getTime() > now ? 'delayed' : 'pending',
      priority: opts.priority ?? 0,
      runAt,
      attempts: 0,
      maxAttempts: Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
      dedupeKey: opts.dedupeKey,
      groupKey: opts.groupKey,
    });
  } catch (error) {
    if (opts.dedupeKey && isDuplicateKeyError(error)) return null;
    throw error;
  }
  if (runAt.getTime() <= now) kickWorker();
  return id;
}

/** Cancels pending/delayed jobs matching the filter (at least one field is required). Returns how many. */
export async function cancelJobs(filter: { name?: string; orgId?: string; groupKey?: string; dedupeKey?: string }): Promise<number> {
  const query: Record<string, unknown> = {};
  if (filter.name) query.name = filter.name;
  if (filter.orgId) query.orgId = filter.orgId;
  if (filter.groupKey) query.groupKey = filter.groupKey;
  if (filter.dedupeKey) query.dedupeKey = filter.dedupeKey;
  if (Object.keys(query).length === 0) throw new Error('[Jobs] cancelJobs requires at least one filter field');

  const result = await models.Job.updateMany(
    { ...query, status: { $in: ['pending', 'delayed'] } },
    { $set: { status: 'cancelled', finishedAt: new Date() }, $unset: { dedupeKey: 1 } },
  );
  return result.modifiedCount;
}

// --- Worker -------------------------------------------------------------------------

export function jobWorkerRunning(): boolean {
  return running;
}

export function startJobWorker(): void {
  if (running) return;
  running = true;
  console.log(`[Jobs] Worker ${WORKER_ID} started (${handlers.size} handlers, ${recurring.size} recurring)`);
  void ensureRecurringJobs();
  schedulePoll(0);
}

export async function stopJobWorker(): Promise<void> {
  if (!running) return;
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (activeRuns.size > 0) {
    console.log(`[Jobs] Waiting for ${activeRuns.size} running job(s) to finish...`);
    let graceTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...activeRuns]),
      new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
      }),
    ]);
    if (graceTimer) clearTimeout(graceTimer);
  }
  console.log('[Jobs] Worker stopped');
}

function schedulePoll(delayMs: number): void {
  if (!running) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void poll();
  }, delayMs);
}

/** Wakes the worker early when an immediately-due job is enqueued in this process. */
function kickWorker(): void {
  if (!running || polling || activeRuns.size >= CONCURRENCY) return;
  schedulePoll(0);
}

async function poll(): Promise<void> {
  if (!running || polling) return;
  polling = true;
  let claimed = 0;
  try {
    if (isDbConnected()) {
      await runMaintenance();
      while (running && activeRuns.size < CONCURRENCY) {
        const job = await claimNextJob();
        if (!job) break;
        if (!running) {
          // Shutdown began while this claim was in flight: hand the job back untouched.
          await models.Job.updateOne(
            { _id: job._id, lockedBy: WORKER_ID, status: 'active' },
            { $set: { status: 'pending' }, $inc: { attempts: -1 }, $unset: { lockedBy: 1, lockedAt: 1, lockExpiresAt: 1 } },
          );
          break;
        }
        claimed += 1;
        const run: Promise<void> = executeJob(job)
          .catch((error: unknown) => {
            // Only bookkeeping writes can land here (handler errors are handled inside); the stale-lock sweep recovers the job.
            console.error(`[Jobs] Failed to record outcome of "${job.name}" (${job._id}):`, errorMessage(error));
          })
          .finally(() => {
            activeRuns.delete(run);
            kickWorker();
          });
        activeRuns.add(run);
      }
    }
  } catch (error) {
    const now = Date.now();
    if (now - lastPollErrorLogAt > 60_000) {
      lastPollErrorLogAt = now;
      console.error('[Jobs] Poll failed:', errorMessage(error));
    }
  } finally {
    polling = false;
  }
  schedulePoll(claimed > 0 || activeRuns.size >= CONCURRENCY ? BUSY_POLL_MS : IDLE_POLL_MS);
}

async function claimNextJob(): Promise<IJob | null> {
  const now = new Date();
  return models.Job.findOneAndUpdate(
    { status: { $in: ['pending', 'delayed'] }, runAt: { $lte: now } },
    {
      $set: { status: 'active', lockedBy: WORKER_ID, lockedAt: now, lockExpiresAt: new Date(now.getTime() + LOCK_MS) },
      $inc: { attempts: 1 },
    },
    { sort: { priority: -1, runAt: 1 }, returnDocument: 'after' },
  ).lean<IJob>();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Job "${name}" timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Keeps only small plain-object results; large or non-object results are summarized. */
function storableResult(result: unknown): Record<string, unknown> | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result !== 'object' || Array.isArray(result)) return { value: result as unknown };
  try {
    const json = JSON.stringify(result);
    if (json.length > MAX_RESULT_BYTES) return { truncated: true, bytes: json.length };
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { unserializable: true };
  }
}

function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

async function executeJob(job: IJob): Promise<void> {
  const registered = handlers.get(job.name);
  const ownLock = { _id: job._id, lockedBy: WORKER_ID, status: 'active' as const };
  const unlock = { lockedBy: 1, lockedAt: 1, lockExpiresAt: 1 } as const;

  if (!registered) {
    await models.Job.updateOne(ownLock, {
      $set: { status: 'failed', error: `No handler registered for job "${job.name}"`, finishedAt: new Date() },
      $unset: { ...unlock, dedupeKey: 1 },
    });
    console.error(`[Jobs] No handler registered for job "${job.name}" (${job._id})`);
    return;
  }

  // Long-running handlers get a lock that outlives their timeout, so the stale-lock sweep never requeues a live run.
  if (registered.timeoutMs + LOCK_MARGIN_MS > LOCK_MS) {
    await models.Job.updateOne(ownLock, { $set: { lockExpiresAt: new Date(Date.now() + registered.timeoutMs + LOCK_MARGIN_MS) } });
  }

  const startedAt = Date.now();
  try {
    const result = storableResult(
      await withTimeout(Promise.resolve().then(() => registered.handler(job.payload ?? {}, job)), registered.timeoutMs, job.name),
    );
    const outcome = await models.Job.updateOne(ownLock, {
      $set: { status: 'done', finishedAt: new Date(), ...(result ? { result } : {}) },
      $unset: { ...unlock, dedupeKey: 1, error: 1 },
    });
    if (outcome.matchedCount === 0) {
      console.warn(`[Jobs] "${job.name}" (${job._id}) finished after its lock was taken over (${Date.now() - startedAt}ms)`);
    }
  } catch (error) {
    const message = errorMessage(error);
    const exhausted = job.attempts >= job.maxAttempts;
    if (exhausted) {
      await models.Job.updateOne(ownLock, {
        $set: { status: 'failed', error: message, finishedAt: new Date() },
        $unset: { ...unlock, dedupeKey: 1 },
      });
      console.error(`[Jobs] "${job.name}" (${job._id}) failed permanently after ${job.attempts} attempt(s): ${message}`);
    } else {
      const delay = backoffMs(job.attempts);
      await models.Job.updateOne(ownLock, {
        $set: { status: 'delayed', error: message, runAt: new Date(Date.now() + delay) },
        $unset: unlock,
      });
      console.warn(`[Jobs] "${job.name}" (${job._id}) attempt ${job.attempts}/${job.maxAttempts} failed, retrying in ${Math.round(delay / 1000)}s: ${message}`);
    }
  } finally {
    const schedule = recurring.get(job.name);
    if (schedule && running) {
      await scheduleRecurring(job.name, schedule.everyMs);
    }
  }
}

async function scheduleRecurring(name: string, delayMs: number): Promise<void> {
  try {
    await enqueueJob(name, {}, { dedupeKey: `${RECURRING_PREFIX}${name}`, delayMs, maxAttempts: 1 });
  } catch (error) {
    console.error(`[Jobs] Failed to schedule recurring job "${name}":`, errorMessage(error));
  }
}

/** Makes sure every recurring job has a pending run (no-op when one exists thanks to the dedupe key). */
async function ensureRecurringJobs(): Promise<void> {
  if (!isDbConnected()) return;
  lastRecurringEnsureAt = Date.now();
  for (const [name, schedule] of recurring) {
    await scheduleRecurring(name, schedule.initialDelayMs);
  }
}

async function runMaintenance(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastMaintenanceAt < MAINTENANCE_EVERY_MS) return;
  lastMaintenanceAt = nowMs;
  const now = new Date(nowMs);

  // Recover jobs whose worker died or hung past the lock.
  const exhausted = await models.Job.updateMany(
    { status: 'active', lockExpiresAt: { $lt: now }, $expr: { $gte: ['$attempts', '$maxAttempts'] } },
    {
      $set: { status: 'failed', error: 'Lock expired: the worker crashed or the job hung', finishedAt: now },
      $unset: { lockedBy: 1, lockedAt: 1, lockExpiresAt: 1, dedupeKey: 1 },
    },
  );
  const retried = await models.Job.updateMany(
    { status: 'active', lockExpiresAt: { $lt: now } },
    {
      $set: { status: 'pending', runAt: now, error: 'Recovered after lock expiry' },
      $unset: { lockedBy: 1, lockedAt: 1, lockExpiresAt: 1 },
    },
  );
  if (exhausted.modifiedCount || retried.modifiedCount) {
    console.warn(`[Jobs] Recovered stale locks: ${retried.modifiedCount} requeued, ${exhausted.modifiedCount} failed`);
  }

  if (nowMs - lastRecurringEnsureAt >= RECURRING_ENSURE_EVERY_MS) {
    await ensureRecurringJobs();
  }

  if (nowMs - lastPurgeAt >= PURGE_EVERY_MS) {
    lastPurgeAt = nowMs;
    await models.Job.deleteMany({
      $or: [
        { status: { $in: ['done', 'cancelled'] }, finishedAt: { $lt: new Date(nowMs - KEEP_FINISHED_MS) } },
        { status: 'failed', finishedAt: { $lt: new Date(nowMs - KEEP_FAILED_MS) } },
      ],
    });
  }
}
