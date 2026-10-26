/**
 * MongoDB connection lifecycle plus one-time reconciliation of indexes whose
 * definition changed in a way Mongoose's autoIndex cannot apply by itself.
 */
import mongoose from 'mongoose';
import { env } from './env.js';
import * as models from '../models/index.js';
import { WEBHOOK_EVENT_TTL_SECONDS } from '../models/index.js';

export async function connectDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState >= 1) {
    return mongoose;
  }

  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    });
    // Host and database name only — the URI contains credentials.
    console.log(`[MongoDB] Connected to ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error('[MongoDB] Connection error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('[MongoDB] Disconnected');
  }
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

interface IndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  expireAfterSeconds?: number;
}

async function listIndexes(collectionName: string): Promise<IndexInfo[]> {
  const db = mongoose.connection.db;
  if (!db) return [];
  try {
    return (await db.collection(collectionName).indexes()) as IndexInfo[];
  } catch (error) {
    // NamespaceNotFound: the collection does not exist yet, so there is nothing to reconcile.
    if ((error as { code?: number }).code === 26) return [];
    throw error;
  }
}

/**
 * Idempotent startup fixes for databases created by earlier versions:
 * 1. DailyStat's old unique { accountId, day, metric } index collides across
 *    workspaces for org-level ('_org') stats; uniqueness now includes orgId.
 * 2. WebhookEvent's plain receivedAt index becomes a 30-day TTL index
 *    (raw payloads hold PII). `collMod` converts it in place; creating a TTL
 *    index with the same key would fail with IndexOptionsConflict.
 * Failures are logged, never fatal.
 */
export async function reconcileLegacyIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;

  try {
    const collection = models.DailyStat.collection.collectionName;
    const indexes = await listIndexes(collection);
    const legacy = indexes.find((index) => index.name === 'accountId_1_day_1_metric_1');
    if (legacy) {
      await db.collection(collection).dropIndex('accountId_1_day_1_metric_1');
      console.log('[MongoDB] Dropped legacy DailyStat index accountId_1_day_1_metric_1');
    }
  } catch (error) {
    console.error('[MongoDB] DailyStat index reconciliation failed:', error instanceof Error ? error.message : error);
  }

  try {
    const collection = models.WebhookEvent.collection.collectionName;
    const indexes = await listIndexes(collection);
    const receivedAt = indexes.find((index) => index.name === 'receivedAt_1');
    if (receivedAt && receivedAt.expireAfterSeconds !== WEBHOOK_EVENT_TTL_SECONDS) {
      await db.command({
        collMod: collection,
        index: { keyPattern: { receivedAt: 1 }, expireAfterSeconds: WEBHOOK_EVENT_TTL_SECONDS },
      });
      console.log('[MongoDB] Converted WebhookEvent receivedAt index to a 30-day TTL');
    }
  } catch (error) {
    console.error('[MongoDB] WebhookEvent TTL reconciliation failed:', error instanceof Error ? error.message : error);
  }
}

export { mongoose };
