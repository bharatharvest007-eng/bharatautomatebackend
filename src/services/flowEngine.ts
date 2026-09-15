import * as models from '../models/index.js';
import { MetaService } from './metaService.js';
import { AiService } from './aiService.js';

export interface WebhookCommentEvent {
  accountId: string;
  commentId: string;
  mediaId: string;
  userIgsid: string;
  username: string;
  commentText: string;
}

export class FlowEngine {
  /**
   * Process an incoming comment against active automations
   */
  static async processComment(event: WebhookCommentEvent) {
    const { accountId, commentId, userIgsid, username, commentText } = event;

    // 1. Fetch account.
    // Meta's webhook identifies the account by its Instagram user id, but the
    // dashboard and the test simulator pass our own document _id. Accept both,
    // or every real webhook silently dies here as "Account not found".
    const account =
      (await models.SocialAccount.findOne({ igUserId: String(accountId) })) ??
      (await models.SocialAccount.findById(accountId));

    if (!account) {
      console.warn(`[FlowEngine] No connected account matches "${accountId}" (igUserId or _id)`);
      return { matched: false, reason: 'Account not found' };
    }

    // Automations are stored against our document _id, not the Instagram id.
    const localAccountId = account._id;

    // 2. Check Spam Protection first
    const spamCheck = await AiService.classifySpam(commentText);
    if (spamCheck.isSpam) {
      console.log(`[FlowEngine] Spam detected (${spamCheck.score}%): "${commentText}". Auto-hiding.`);
      await MetaService.hideOrDeleteComment(commentId, 'hide', account.accessToken);
      return { matched: false, reason: 'Spam comment auto-hidden' };
    }

    // 3. Find active automations for this account
    const found = await models.Automation.find({
      accountId: localAccountId,
      status: 'live',
    }).lean();

    // A trigger attached to this specific post beats an account-wide one, so a
    // single post can always override the general rules. Within the same
    // specificity, higher `priority` wins, then most recently updated.
    const automations = (found as any[]).sort((a, b) => {
      const aSpecific = a.mediaIds?.length ? 1 : 0;
      const bSpecific = b.mediaIds?.length ? 1 : 0;
      if (aSpecific !== bSpecific) return bSpecific - aSpecific;
      if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0);
      return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
    });

    for (const auto of automations) {
      const trigger = auto.trigger as any;
      if (!trigger) continue;

      // Per-post targeting: an automation with mediaIds only answers comments on
      // those posts. An empty list means it applies account-wide.
      const targeted: string[] = (auto as any).mediaIds ?? [];
      if (targeted.length > 0 && event.mediaId && !targeted.includes(event.mediaId)) {
        continue;
      }

      let matches = false;

      // Check Trigger Type
      if (trigger.type === 'comment' || trigger.type === 'comment_any_reel') {
        const keywords: string[] = trigger.keywords || [];
        const matchMode = trigger.matchMode || 'contains';

        if (keywords.length === 0) {
          matches = true; // All comments
        } else {
          const lowerComment = commentText.toLowerCase();
          matches = keywords.some((kw) => {
            const lowerKw = kw.toLowerCase().trim();
            if (matchMode === 'exact') {
              return lowerComment === lowerKw;
            }
            return lowerComment.includes(lowerKw);
          });
        }
      }

      if (matches) {
        console.log(`[FlowEngine] Automation "${auto.name}" triggered by comment: "${commentText}"`);

        // Execute actions defined in automation steps
        await this.executeAutomationSteps(auto, event, account);

        // Update stats atomically
        await models.Automation.updateOne(
          { _id: auto._id },
          {
            $inc: { 'metrics.sentCount': 1 },
            $set: { lastTriggeredAt: new Date() },
          }
        );

        return { matched: true, automationId: auto._id };
      }
    }

    return { matched: false, reason: 'No matching keywords' };
  }

  /**
   * Execute automation steps (Comment Reply, DM, Ask-for-Follow, Lead Card)
   */
  private static async executeAutomationSteps(
    automation: any,
    event: WebhookCommentEvent,
    account: any
  ) {
    // The builder saves actions under `flow.nodes`; older records used `steps`.
    // Reading only `steps` meant a matching automation executed nothing at all.
    const steps: any[] = automation.flow?.nodes ?? automation.steps ?? [];

    if (steps.length === 0) {
      console.warn(`[FlowEngine] Automation "${automation.name}" matched but has no actions defined`);
    }

    for (const step of steps) {
      // Action 1: Public Comment Auto-Reply
      if (step.type === 'comment_reply') {
        const variants: string[] = step.variants || [step.text || 'Check your DMs! 🚀'];
        const replyText = variants[Math.floor(Math.random() * variants.length)];
        await MetaService.replyToComment(event.commentId, replyText, account.accessToken);
      }

      // Action 2: Ask for Follow (Follower-Gating)
      if (step.type === 'ask_for_follow') {
        const isFollowing = await MetaService.checkFollowerStatus(
          account.igUserId,
          event.userIgsid,
          account.accessToken
        );

        if (!isFollowing) {
          // Send Follow Gate Prompt
          await MetaService.sendDirectMessage({
            recipientIgsid: event.userIgsid,
            accessToken: account.accessToken,
            text: step.followPromptText || `Hey @${event.username}! Please follow @${account.username} to unlock the instant download! Tap below when done:`,
            buttons: [
              { title: 'Follow Profile', url: `https://instagram.com/${account.username}` },
              { title: 'I Am Following! ✅', payload: `VERIFY_FOLLOW:${automation._id}` },
            ],
          });
          // Stop flow here until user follows and taps verified
          return;
        }
      }

      // Action 3: Send Direct Message / Resource Link
      if (step.type === 'send_dm') {
        // Address the comment, not the user: a commenter has almost never
        // messaged us first, so a plain DM would be rejected by Instagram.
        const result = await MetaService.sendDirectMessage({
          recipientIgsid: event.userIgsid,
          commentId: event.commentId,
          accessToken: account.accessToken,
          text: step.text || 'Here is your requested link! Enjoy! 🚀',
          buttons: step.buttons || [],
        });

        if (!result.success) {
          console.error(`[FlowEngine] DM failed for @${event.username}:`, result.error);
        } else {
          console.log(`[FlowEngine] DM sent to @${event.username}`);
        }
      }
    }

    // Upsert or update contact in CRM
    await models.Contact.findOneAndUpdate(
      { accountId: account._id, igsid: event.userIgsid },
      {
        $set: {
          username: event.username,
          lastInteractionAt: new Date(),
        },
        $addToSet: { tags: `auto:${automation.name.substring(0, 20)}` },
        $inc: { messageCount: 1 },
      },
      { upsert: true, returnDocument: 'after' }
    );
  }
}
