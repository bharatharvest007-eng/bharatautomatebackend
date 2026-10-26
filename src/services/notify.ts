/**
 * In-app notifications (the header bell).
 *
 * `notify` never throws: it is called from webhook handlers, jobs and quota
 * checks where a failed notification must not abort the real work. A
 * `dedupeKey` makes "once per period" alerts safe to fire repeatedly — the
 * unique {orgId, dedupeKey} index rejects the duplicate and we treat that as
 * "already sent".
 */
import * as models from '../models/index.js';
import type { NotificationSeverity, NotificationType } from '../models/index.js';
import { newId } from '../lib/ids.js';

export type { NotificationSeverity, NotificationType };

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  /** In-app path the notification opens, e.g. '/inbox?conversation=cnv_…'. */
  link?: string;
  /** Target one member; omit for a workspace-wide notification. */
  userId?: string;
  dedupeKey?: string;
  severity?: NotificationSeverity;
}

const MAX_TITLE = 200;
const MAX_BODY = 1_000;

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function notify(orgId: string, n: NotifyInput): Promise<void> {
  if (!orgId || !n.title) return;
  try {
    await models.Notification.create({
      _id: newId('ntf'),
      orgId,
      userId: n.userId,
      type: n.type,
      severity: n.severity ?? 'info',
      title: clip(n.title, MAX_TITLE),
      body: clip(n.body, MAX_BODY),
      link: n.link,
      dedupeKey: n.dedupeKey,
    });
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) return;
    console.error(`[Notify] Failed to create "${n.type}" notification:`, error instanceof Error ? error.message : error);
  }
}

/** Mongo filter for notifications a member can see: workspace-wide ones plus their own. */
export function visibleTo(orgId: string, userId: string): Record<string, unknown> {
  return { orgId, $or: [{ userId: { $exists: false } }, { userId: null }, { userId }] };
}

/** Unread notifications visible to a member. */
export async function countUnreadNotifications(orgId: string, userId: string): Promise<number> {
  return models.Notification.countDocuments({ ...visibleTo(orgId, userId), readAt: null });
}
