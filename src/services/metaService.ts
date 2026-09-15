import axios from 'axios';
import crypto from 'crypto';

const GRAPH_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

/**
 * Pick the right Graph host for a token.
 *
 * Tokens issued by Instagram Business Login are only valid against
 * graph.instagram.com; Page access tokens from Facebook Login are only valid
 * against graph.facebook.com. Calling the wrong host fails with a confusing
 * OAuth error, so we route on the token's own prefix: Instagram user tokens
 * start with "IG", Facebook/Page tokens with "EAA".
 */
function graphBase(accessToken?: string): string {
  return accessToken?.startsWith('IG') ? INSTAGRAM_GRAPH_BASE : GRAPH_API_BASE;
}

export interface MetaSendDmOptions {
  recipientIgsid: string;
  accessToken: string;
  text?: string;
  buttons?: Array<{ title: string; payload?: string; url?: string }>;
  tag?: 'HUMAN_AGENT';
  /**
   * Send as a private reply to this comment instead of a normal DM.
   *
   * This matters for the core comment-to-DM flow: Instagram only lets you DM
   * someone who has messaged you in the last 24h. A commenter usually has not,
   * so addressing the comment is the only way the first message gets through.
   */
  commentId?: string;
}

export class MetaService {
  /**
   * Verify signature on incoming Meta Webhooks (X-Hub-Signature-256)
   */
  static verifySignature(payload: string, signatureHeader?: string, appSecret?: string): boolean {
    if (!signatureHeader || !appSecret) return false;
    const [algo, signature] = signatureHeader.split('=');
    if (algo !== 'sha256' || !signature) return false;
    const hmac = crypto.createHmac('sha256', appSecret);
    const digest = hmac.update(payload, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
  }

  /**
   * Send Direct Message to an Instagram user via Meta Graph API v21.0
   */
  static async sendDirectMessage(options: MetaSendDmOptions) {
    const { recipientIgsid, accessToken, text, buttons, tag, commentId } = options;

    let messagePayload: Record<string, any> = {};

    if (buttons && buttons.length > 0) {
      messagePayload = {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: text || 'Tap below to continue:',
            buttons: buttons.map((b) => {
              if (b.url) {
                return { type: 'web_url', url: b.url, title: b.title };
              }
              return { type: 'postback', title: b.title, payload: b.payload || b.title };
            }),
          },
        },
      };
    } else {
      messagePayload = { text: text || '' };
    }

    const body: Record<string, any> = {
      recipient: commentId ? { comment_id: commentId } : { id: recipientIgsid },
      message: messagePayload,
    };

    if (tag === 'HUMAN_AGENT') {
      body.messaging_type = 'MESSAGE_TAG';
      body.tag = 'HUMAN_AGENT';
    }

    try {
      const response = await axios.post(`${graphBase(accessToken)}/me/messages`, body, {
        params: { access_token: accessToken },
        headers: { 'Content-Type': 'application/json' },
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      const metaError = error.response?.data?.error;
      console.error('[Meta Graph API] sendDirectMessage failed:', metaError || error.message);
      return {
        success: false,
        error: metaError?.message || error.message,
        code: metaError?.code,
        subcode: metaError?.error_subcode,
      };
    }
  }

  /**
   * Reply to a comment publicly on Instagram
   */
  static async replyToComment(commentId: string, message: string, accessToken: string) {
    try {
      const response = await axios.post(
        `${graphBase(accessToken)}/${commentId}/replies`,
        { message },
        { params: { access_token: accessToken } }
      );
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error('[Meta Graph API] replyToComment failed:', error.response?.data?.error || error.message);
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
  }

  /**
   * Send a private reply to a comment (Direct Message initiated from comment)
   */
  static async sendPrivateCommentReply(commentId: string, message: string, accessToken: string) {
    try {
      const response = await axios.post(
        `${graphBase(accessToken)}/me/messages`,
        {
          recipient: { comment_id: commentId },
          message: { text: message },
        },
        { params: { access_token: accessToken } }
      );
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error('[Meta Graph API] sendPrivateCommentReply failed:', error.response?.data?.error || error.message);
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
  }

  /**
   * Hide or Delete a comment (For Spam Protection)
   */
  static async hideOrDeleteComment(commentId: string, action: 'hide' | 'delete', accessToken: string) {
    try {
      if (action === 'hide') {
        const response = await axios.post(
          `${graphBase(accessToken)}/${commentId}`,
          { hide: true },
          { params: { access_token: accessToken } }
        );
        return { success: true, data: response.data };
      } else {
        const response = await axios.delete(`${graphBase(accessToken)}/${commentId}`, {
          params: { access_token: accessToken },
        });
        return { success: true, data: response.data };
      }
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
  }

  /**
   * Check if an Instagram user follows the business account (Ask-for-Follow verification)
   */
  static async checkFollowerStatus(businessIgsid: string, userIgsid: string, accessToken: string): Promise<boolean> {
    try {
      const res = await axios.get(`${graphBase(accessToken)}/${businessIgsid}`, {
        params: {
          fields: `user_profile{is_user_follow_business,is_business_follow_user}`,
          access_token: accessToken,
        },
      });
      return Boolean(res.data?.user_profile?.is_user_follow_business);
    } catch {
      // Fallback: If permissions not granted, assume false to trigger Follow gate
      return false;
    }
  }

  /**
   * Sync 4 Ice Breakers with Meta Messenger Profile
   */
  static async setIceBreakers(
    iceBreakers: Array<{ question: string; payload: string }>,
    accessToken: string
  ) {
    try {
      const formatted = iceBreakers.slice(0, 4).map((ib) => ({
        question: ib.question,
        payload: ib.payload || ib.question,
      }));

      const res = await axios.post(
        `${graphBase(accessToken)}/me/messenger_profile`,
        {
          ice_breakers: [
            {
              call_to_actions: formatted,
              locale: 'default',
            },
          ],
        },
        { params: { access_token: accessToken } }
      );
      return { success: true, data: res.data };
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
  }

  /**
   * Sync Persistent Menu (up to 20 items) with Meta Messenger Profile
   */
  static async setPersistentMenu(
    menuItems: Array<{ title: string; url?: string; payload?: string }>,
    accessToken: string
  ) {
    try {
      const callToActions = menuItems.slice(0, 20).map((item) => {
        if (item.url) {
          return { type: 'web_url', title: item.title, url: item.url };
        }
        return { type: 'postback', title: item.title, payload: item.payload || item.title };
      });

      const res = await axios.post(
        `${graphBase(accessToken)}/me/messenger_profile`,
        {
          persistent_menu: [
            {
              locale: 'default',
              composer_input_disabled: false,
              call_to_actions: callToActions,
            },
          ],
        },
        { params: { access_token: accessToken } }
      );
      return { success: true, data: res.data };
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
  }

  /**
   * Validate or fetch live status of an access token
   */
  static async validateToken(accessToken: string) {
    try {
      const res = await axios.get(`${graphBase(accessToken)}/me`, {
        params: {
          fields: 'id,name,username',
          access_token: accessToken,
        },
      });
      return { valid: true, data: res.data };
    } catch (error: any) {
      return { valid: false, error: error.response?.data?.error?.message || error.message };
    }
  }

  /**
   * Build direct Instagram Login Authorization URL
   * Ref: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
   */
  /** Scopes every install needs. Content publishing is opt-in because it must be
   *  added separately under Permissions and features before it can be requested —
   *  asking for a scope the app does not have breaks the consent dialog. */
  static readonly DEFAULT_INSTAGRAM_SCOPES = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
  ];

  static buildInstagramLoginUrl(options: {
    appId: string;
    redirectUri: string;
    state?: string;
    scopes?: string[];
  }): string {
    const { appId, redirectUri, state = 'sma_ig_login' } = options;
    const scopes = (options.scopes?.length ? options.scopes : MetaService.DEFAULT_INSTAGRAM_SCOPES).join(',');

    const params = new URLSearchParams({
      enable_fb_login: '0', // Forces native Instagram login dialog (no Facebook login required)
      force_authentication: '1',
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state,
    });

    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange Instagram authorization code for long-lived 60-day token & fetch profile
   */
  static async exchangeInstagramCode(options: {
    code: string;
    appId: string;
    appSecret: string;
    redirectUri: string;
  }) {
    const { code, appId, appSecret, redirectUri } = options;

    // Step 1: Exchange code for short-lived token
    const tokenForm = new URLSearchParams();
    tokenForm.append('client_id', appId);
    tokenForm.append('client_secret', appSecret);
    tokenForm.append('grant_type', 'authorization_code');
    tokenForm.append('redirect_uri', redirectUri);
    tokenForm.append('code', code);

    const shortTokenRes = await axios.post('https://api.instagram.com/oauth/access_token', tokenForm, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const shortToken = shortTokenRes.data.access_token;
    const initialUserId = shortTokenRes.data.user_id;

    // Step 2: Exchange short-lived token for long-lived 60-day token
    const longLivedRes = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: appSecret,
        access_token: shortToken,
      },
    });

    const longLivedToken = longLivedRes.data.access_token;
    const expiresIn = longLivedRes.data.expires_in || 5184000; // 60 days in seconds

    // Step 3: Fetch profile information.
    // `user_id` is the Instagram-scoped id the Messaging API addresses; `id` is
    // the app-scoped id. Store user_id, falling back to id when it is absent.
    let username = `user_${initialUserId}`;
    let displayName = username;
    let instagramUserId = String(initialUserId);
    let accountType: string | undefined;
    let avatarUrl: string | undefined;
    let followersCount = 0;
    let followsCount = 0;
    let mediaCount = 0;
    let biography: string | undefined;
    let website: string | undefined;

    try {
      const profileRes = await axios.get(`${INSTAGRAM_GRAPH_BASE}/me`, {
        params: {
          fields:
            'user_id,id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website',
          access_token: longLivedToken,
        },
      });
      const p = profileRes.data;
      if (p) {
        instagramUserId = String(p.user_id || p.id || instagramUserId);
        username = p.username || username;
        displayName = p.name || username;
        accountType = p.account_type;
        avatarUrl = p.profile_picture_url;
        followersCount = p.followers_count ?? 0;
        followsCount = p.follows_count ?? 0;
        mediaCount = p.media_count ?? 0;
        biography = p.biography;
        website = p.website;
      }
    } catch (err: any) {
      console.warn(
        '[MetaService] Could not fetch profile from graph.instagram.com:',
        err.response?.data?.error?.message || err.message,
      );
    }

    return {
      accessToken: longLivedToken,
      expiresIn,
      instagramUserId,
      username,
      displayName,
      accountType,
      avatarUrl,
      followersCount,
      followsCount,
      mediaCount,
      biography,
      website,
    };
  }

  /**
   * Subscribe this Instagram account to webhook events. Without this no comment
   * or DM ever reaches the backend, so no automation can fire.
   */
  static async subscribeWebhooks(igUserId: string, accessToken: string) {
    const fields = [
      'comments',
      'live_comments',
      'messages',
      'messaging_postbacks',
      'messaging_seen',
      'message_reactions',
      'messaging_referral',
      'mentions',
    ].join(',');

    try {
      const res = await axios.post(
        `${graphBase(accessToken)}/${igUserId}/subscribed_apps`,
        null,
        { params: { subscribed_fields: fields, access_token: accessToken } },
      );
      return { success: res.data?.success !== false, data: res.data, fields };
    } catch (error: any) {
      const metaError = error.response?.data?.error;
      console.error('[Meta Graph API] subscribeWebhooks failed:', metaError || error.message);
      return { success: false, error: metaError?.message || error.message };
    }
  }
}
