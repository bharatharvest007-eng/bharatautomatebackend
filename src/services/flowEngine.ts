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

    // 1. Fetch account
    const account = await models.SocialAccount.findById(accountId);
    if (!account) return { matched: false, reason: 'Account not found' };

    // 2. Check Spam Protection first
    const spamCheck = await AiService.classifySpam(commentText);
    if (spamCheck.isSpam) {
      console.log(`[FlowEngine] Spam detected (${spamCheck.score}%): "${commentText}". Auto-hiding.`);
      await MetaService.hideOrDeleteComment(commentId, 'hide', account.accessToken);
      return { matched: false, reason: 'Spam comment auto-hidden' };
    }

    // 3. Find active automations for this account
    const automations = await models.Automation.find({
      accountId,
      status: 'live',
    });

    for (const auto of automations) {
      const trigger = auto.trigger as any;
      if (!trigger) continue;

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
    const steps: any[] = automation.steps || [];

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
          account.instagramBusinessId,
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
        await MetaService.sendDirectMessage({
          recipientIgsid: event.userIgsid,
          accessToken: account.accessToken,
          text: step.text || 'Here is your requested link! Enjoy! 🚀',
          buttons: step.buttons || [],
        });
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
