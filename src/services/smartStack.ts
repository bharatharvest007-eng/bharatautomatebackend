/**
 * STUB (initial version): implemented by D5 (AI Agent, Knowledge, Moderation, Brand Voice).
 *
 * Smart Stack settings: comment auto-reply pacing, viral-post protection,
 * spam guard and quiet hours. The stub already reads real settings: the
 * defaults below, overridden by legacy top-level keys in
 * `Organization.settings` (where the old Smart Stack page saved them), then by
 * `Organization.settings.smartStack`.
 */
import * as models from '../models/index.js';

export interface SmartStackSettings {
  autoCommentReply: boolean;
  viralPostProtection: boolean;
  maxCommentsPerHour: number;
  replyDelaySeconds: number;
  spamGuard: boolean;
  spamAutoHide: boolean;
  spamAutoDelete: boolean;
  /** 0..1 confidence above which a comment is treated as spam. */
  spamThreshold: number;
  storyMentionAutoReply: boolean;
  askForFollowDefault: boolean;
  quietHours: { enabled: boolean; start: string; end: string; timezone?: string };
}

export const DEFAULT_SMART_STACK: SmartStackSettings = {
  autoCommentReply: true,
  viralPostProtection: true,
  maxCommentsPerHour: 120,
  replyDelaySeconds: 0,
  spamGuard: true,
  spamAutoHide: true,
  spamAutoDelete: false,
  spamThreshold: 0.8,
  storyMentionAutoReply: true,
  askForFollowDefault: true,
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
};

type Overrides = Record<string, unknown>;

function isRecord(value: unknown): value is Overrides {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copies keys from `source` whose type matches the default, so malformed stored values never leak through. */
function applyOverrides(target: SmartStackSettings, source: Overrides): void {
  const keys = Object.keys(DEFAULT_SMART_STACK) as (keyof SmartStackSettings)[];
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (key === 'quietHours') {
      if (!isRecord(value)) continue;
      const quiet = { ...target.quietHours };
      if (typeof value.enabled === 'boolean') quiet.enabled = value.enabled;
      if (typeof value.start === 'string' && /^\d{2}:\d{2}$/.test(value.start)) quiet.start = value.start;
      if (typeof value.end === 'string' && /^\d{2}:\d{2}$/.test(value.end)) quiet.end = value.end;
      if (typeof value.timezone === 'string' && value.timezone) quiet.timezone = value.timezone;
      target.quietHours = quiet;
      continue;
    }
    const expected = typeof DEFAULT_SMART_STACK[key];
    if (typeof value === expected && (expected !== 'number' || Number.isFinite(value))) {
      (target as unknown as Overrides)[key] = value;
    }
  }
}

export async function getSmartStackSettings(orgId: string): Promise<SmartStackSettings> {
  const settings: SmartStackSettings = { ...DEFAULT_SMART_STACK, quietHours: { ...DEFAULT_SMART_STACK.quietHours } };
  const org = await models.Organization.findById(orgId, { settings: 1 }).lean();
  const stored = isRecord(org?.settings) ? org.settings : {};
  applyOverrides(settings, stored);
  if (isRecord(stored.smartStack)) applyOverrides(settings, stored.smartStack);
  return settings;
}
