/**
 * The domain contract shared by the API, the workers, and the dashboard.
 *
 * Flows are stored as JSON, so these types *are* the schema for automation
 * behaviour. Changing them changes what users can build; treat them as a
 * versioned interface, not a scratch pad.
 */

// ---------------------------------------------------------------------------
// Platform / channel
// ---------------------------------------------------------------------------

export type Platform = 'instagram' | 'facebook' | 'whatsapp';

export type AccountStatus = 'connected' | 'token_expired' | 'revoked' | 'error' | 'paused';

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export type AutomationType =
  /** Someone comments on a feed post, reel or carousel. */
  | 'comment'
  /** Someone comments on a Trial Reel (invisible to the media list until it graduates). */
  | 'trial_reel_comment'
  /** Someone comments during an Instagram Live broadcast. */
  | 'live_comment'
  /** Someone replies to one of our stories. */
  | 'story_reply'
  /** Someone @mentions us in their own story. */
  | 'story_mention'
  /** Someone @mentions us in a comment or caption. */
  | 'mention'
  /** A direct message arrives. */
  | 'dm'
  /** The very first message of a brand-new conversation. */
  | 'dm_welcome'
  /** A tap on an ice breaker / conversation starter. */
  | 'ice_breaker'
  /** A tap on the persistent DM main menu. */
  | 'main_menu'
  /** A postback button inside a flow. */
  | 'postback'
  /** A referral link (ig.me/m/<user>?ref=...). */
  | 'referral'
  /** Manually run: broadcasts, rewind sweeps, tests. */
  | 'manual';

/** Which media an automation watches. */
export type MediaScope =
  | { kind: 'specific'; mediaIds: string[] }
  | { kind: 'any' } // every post, reel and carousel, including future ones
  | { kind: 'any_reel' }
  | { kind: 'any_post' }
  | { kind: 'any_story' }
  | { kind: 'next'; count: number }; // the next N posts published

export type MatchMode =
  | 'contains' // keyword appears anywhere (default, word-boundary aware)
  | 'exact' // the whole message equals the keyword
  | 'starts_with'
  | 'ends_with'
  | 'word' // whole-word match
  | 'regex'
  | 'any' // fire on anything at all
  | 'fuzzy'; // tolerant of typos (Levenshtein within threshold)

export interface KeywordTrigger {
  /** Positive keywords. Any one matching is enough. */
  keywords: string[];
  matchMode: MatchMode;
  /** If any of these appear, the trigger is suppressed. */
  negativeKeywords?: string[];
  caseSensitive?: boolean;
  /** Max edit distance for `fuzzy`. Defaults to 1 for short words, 2 for long. */
  fuzzyThreshold?: number;
  /** Also match when the comment contains only emoji from this list. */
  emoji?: string[];
}

export interface AudienceFilter {
  /** Only run for contacts carrying all of these tags. */
  hasAllTags?: string[];
  hasAnyTags?: string[];
  excludeTags?: string[];
  /** Only for contacts we have never messaged / have already messaged. */
  onlyNewContacts?: boolean;
  onlyReturningContacts?: boolean;
  /** Skip verified accounts, or accounts with follower counts we can see. */
  excludeUsernames?: string[];
  /** Ignore comments from the account owner and team members. */
  excludeSelf?: boolean;
}

export interface TriggerSchedule {
  timezone: string;
  /** Local hours during which the automation may fire, e.g. [9, 21]. */
  activeHours?: [number, number];
  /** 0 = Sunday. Empty/undefined means every day. */
  activeDays?: number[];
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface AutomationTrigger {
  type: AutomationType;
  keyword?: KeywordTrigger;
  mediaScope?: MediaScope;
  audience?: AudienceFilter;
  schedule?: TriggerSchedule;
  /** Don't re-fire for the same contact within this many hours. */
  cooldownHours?: number;
  /** Fire at most once ever per contact. */
  oncePerContact?: boolean;
  /** Fire at most once per comment/media pair. */
  oncePerMedia?: boolean;
}

// ---------------------------------------------------------------------------
// Message content
// ---------------------------------------------------------------------------

export type ButtonAction =
  | { type: 'url'; title: string; url: string; /** Track clicks through our shortener. */ track?: boolean }
  | { type: 'postback'; title: string; payload: string }
  | { type: 'phone'; title: string; phone: string }
  | { type: 'whatsapp'; title: string; phone: string; prefilledText?: string }
  | { type: 'email'; title: string; email: string; subject?: string };

export interface QuickReply {
  title: string;
  payload: string;
  imageUrl?: string;
}

export interface CardContent {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  defaultUrl?: string;
  buttons?: ButtonAction[];
}

export type MessageContent =
  | { kind: 'text'; text: string; quickReplies?: QuickReply[] }
  | { kind: 'buttons'; text: string; buttons: ButtonAction[] }
  | { kind: 'cards'; cards: CardContent[] }
  | { kind: 'image'; url: string; caption?: string }
  | { kind: 'video'; url: string; caption?: string }
  | { kind: 'audio'; url: string }
  | { kind: 'file'; url: string; filename?: string }
  | { kind: 'sticker'; sticker: 'heart' }
  | { kind: 'reaction'; reaction: 'love'; messageId: string }
  | { kind: 'media_share'; mediaId: string }
  | { kind: 'template'; templateId: string };

// ---------------------------------------------------------------------------
// Flow graph
// ---------------------------------------------------------------------------

export type ComparisonOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'lt'
  | 'exists'
  | 'not_exists'
  | 'in'
  | 'not_in';

export interface ConditionClause {
  /** `tag`, `field:<name>`, `follows`, `has_email`, `has_phone`, `window_open`, `message`, `hour`. */
  subject: string;
  op: ComparisonOp;
  value?: string | number | string[];
}

export interface ConditionGroup {
  /** All clauses must pass (`and`) or at least one must (`or`). */
  mode: 'and' | 'or';
  clauses: ConditionClause[];
}

export type FlowNode =
  | { id: string; type: 'start'; next?: string }
  | { id: string; type: 'send'; content: MessageContent; next?: string; typingMs?: number }
  | {
      id: string;
      type: 'ask';
      content: MessageContent;
      /** Contact field the reply is stored in. */
      saveTo: string;
      /** Reject replies that don't look like this. */
      expect?: 'text' | 'email' | 'phone' | 'number' | 'url';
      retryMessage?: string;
      maxRetries?: number;
      timeoutHours?: number;
      next?: string;
      onTimeout?: string;
    }
  | {
      id: string;
      type: 'lead_card';
      leadCardId: string;
      next?: string;
      onSkip?: string;
    }
  | {
      id: string;
      /**
       * "Ask for follow" gate. Instagram exposes no follower-status endpoint, so
       * this asks the contact to follow and confirm with a button tap; the tap is
       * what unlocks the next step. `verify` records the claim for auditing.
       */
      type: 'ask_follow';
      message: string;
      followButtonTitle: string;
      confirmButtonTitle: string;
      profileUrl?: string;
      /** Re-ask this many times before giving up and continuing anyway. */
      maxReminders?: number;
      reminderDelayMinutes?: number;
      next?: string;
      onDecline?: string;
    }
  | { id: string; type: 'condition'; condition: ConditionGroup; whenTrue?: string; whenFalse?: string }
  | { id: string; type: 'delay'; ms: number; next?: string }
  | {
      id: string;
      /** A/B split. Weights are normalized; the branch chosen is recorded on the run. */
      type: 'split';
      branches: { key: string; weight: number; next?: string }[];
    }
  | { id: string; type: 'tag'; add?: string[]; remove?: string[]; next?: string }
  | { id: string; type: 'set_field'; field: string; value: string; next?: string }
  | {
      id: string;
      type: 'ai_reply';
      /** Extra instruction layered on the account's brand voice. */
      instruction?: string;
      useKnowledgeBase?: boolean;
      maxWords?: number;
      fallbackText?: string;
      next?: string;
    }
  | { id: string; type: 'comment_reply'; text: string | string[]; next?: string }
  | { id: string; type: 'comment_action'; action: 'hide' | 'unhide' | 'delete' | 'like'; next?: string }
  | { id: string; type: 'notify'; channel: 'email' | 'webhook'; target: string; message?: string; next?: string }
  | {
      id: string;
      type: 'http';
      url: string;
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      headers?: Record<string, string>;
      body?: string;
      saveResponseTo?: string;
      next?: string;
    }
  | { id: string; type: 'subscribe'; sequenceId: string; next?: string }
  | { id: string; type: 'unsubscribe'; sequenceId?: string; next?: string }
  | { id: string; type: 'assign'; userId: string | null; next?: string }
  | { id: string; type: 'handover'; note?: string; next?: string }
  | { id: string; type: 'goto'; target: string }
  | { id: string; type: 'end'; reason?: string };

export type FlowNodeType = FlowNode['type'];

export interface FlowDefinition {
  version: 1;
  entry: string;
  nodes: FlowNode[];
  /** Canvas coordinates, purely cosmetic. */
  layout?: Record<string, { x: number; y: number }>;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export type RunStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface RunContext {
  /** Values interpolated into message text as {{first_name}} etc. */
  vars: Record<string, string | number | boolean | null>;
  /** Node the run is parked on while waiting for a reply or a delay. */
  waitingFor?: { nodeId: string; kind: 'reply' | 'delay' | 'postback'; expiresAt?: string };
  visited: string[];
  splitChoices?: Record<string, string>;
}

export type MessageDirection = 'in' | 'out';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

// ---------------------------------------------------------------------------
// Comment moderation
// ---------------------------------------------------------------------------

export type CommentVerdict =
  | 'genuine'
  | 'question'
  | 'praise'
  | 'spam'
  | 'scam'
  | 'self_promo'
  | 'competitor'
  | 'insult'
  | 'hate'
  | 'nsfw'
  | 'unknown';

export type ModerationAction = 'none' | 'hide' | 'delete' | 'flag' | 'reply';

export interface ModerationDecision {
  verdict: CommentVerdict;
  action: ModerationAction;
  confidence: number;
  reason: string;
  /** Set when a human should look before we act. */
  needsReview?: boolean;
}

// ---------------------------------------------------------------------------
// Scheduling / publishing
// ---------------------------------------------------------------------------

export type PostKind = 'image' | 'video' | 'reel' | 'carousel' | 'story';
export type PublishStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface MediaItem {
  url: string;
  type: 'image' | 'video';
  /** For carousels: per-item user tags. */
  userTags?: { username: string; x?: number; y?: number }[];
}

// ---------------------------------------------------------------------------
// Link in bio
// ---------------------------------------------------------------------------

export type BioBlockType =
  | 'link'
  | 'socials'
  | 'header'
  | 'text'
  | 'image'
  | 'video'
  | 'divider'
  | 'email_capture'
  | 'whatsapp'
  | 'product'
  | 'faq'
  | 'embed';

export interface BioBlock {
  id: string;
  type: BioBlockType;
  enabled: boolean;
  position: number;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type MetricKey =
  | 'dms_sent'
  | 'dms_delivered'
  | 'dms_read'
  | 'dms_failed'
  | 'comments_received'
  | 'comments_replied'
  | 'comments_hidden'
  | 'comments_deleted'
  | 'triggers_fired'
  | 'link_clicks'
  | 'leads_captured'
  | 'follows_asked'
  | 'follows_confirmed'
  | 'conversations_started'
  | 'ai_calls'
  | 'ai_credits';

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
}

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

export function roleAtLeast(role: Role | string | null | undefined, required: Role): boolean {
  const r = ROLE_RANK[(role as Role) ?? 'viewer'] ?? 0;
  return r >= ROLE_RANK[required];
}
