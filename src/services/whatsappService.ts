import axios from 'axios';
import type { ButtonAction, ListSection, MessageContent } from '../types/index.js';

/**
 * WhatsApp Business Cloud API.
 *
 * Everything here is scoped by `phoneNumberId`, not a user id — WhatsApp has
 * no separate "business account" endpoint the way Instagram does; the phone
 * number *is* the sender. Every send needs the phone's own access token
 * (a System User token generated in Meta Business Manager with
 * `whatsapp_business_messaging` + `whatsapp_business_management`).
 *
 * The single hardest rule to get right: WhatsApp only lets you send free-form
 * text within 24h of the user's last message. Outside that window — including
 * the very first message ever, always — only an approved template will send.
 * `sendMessage` below enforces the shape; it does not know the clock, so the
 * caller (flowEngine) is responsible for checking the window first.
 */

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface WaSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  code?: number;
  data?: any;
}

function client(accessToken: string) {
  return axios.create({
    baseURL: GRAPH_BASE,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    timeout: 20_000,
  });
}

function unwrapError(error: any): { message: string; code?: number } {
  const metaError = error?.response?.data?.error;
  return { message: metaError?.message || error?.message || 'Unknown WhatsApp API error', code: metaError?.code };
}

export class WhatsAppService {
  /**
   * Verify a token + phone number pair actually work, and pull back the
   * number's own profile — this is what "Test connection" calls.
   */
  static async validatePhoneNumber(phoneNumberId: string, accessToken: string) {
    try {
      const res = await client(accessToken).get(`/${phoneNumberId}`, {
        params: {
          fields:
            'verified_name,display_phone_number,quality_rating,platform_type,throughput,messaging_limit_tier',
        },
      });
      return { valid: true, data: res.data };
    } catch (error: any) {
      const { message, code } = unwrapError(error);
      return { valid: false, error: message, code };
    }
  }

  // ---------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------

  /** Free-form text — only deliverable inside the 24h customer-service window. */
  static async sendText(phoneNumberId: string, to: string, text: string, accessToken: string): Promise<WaSendResult> {
    return this.post(phoneNumberId, accessToken, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text, preview_url: true },
    });
  }

  /** An approved template — the only way to start a conversation or reach past 24h. */
  static async sendTemplate(
    phoneNumberId: string,
    to: string,
    templateName: string,
    language: string,
    accessToken: string,
    params?: Record<string, string>,
  ): Promise<WaSendResult> {
    const components = params && Object.keys(params).length
      ? [
          {
            type: 'body',
            parameters: Object.values(params).map((value) => ({ type: 'text', text: value })),
          },
        ]
      : undefined;

    return this.post(phoneNumberId, accessToken, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        ...(components ? { components } : {}),
      },
    });
  }

  /** Up to 3 quick-reply buttons — the WhatsApp analogue of Instagram's button template. */
  static async sendInteractiveButtons(
    phoneNumberId: string,
    to: string,
    bodyText: string,
    buttons: ButtonAction[],
    accessToken: string,
  ): Promise<WaSendResult> {
    const replyButtons = buttons
      .filter((b) => b.type === 'postback')
      .slice(0, 3)
      .map((b) => ({ type: 'reply', reply: { id: (b as any).payload, title: b.title.slice(0, 20) } }));

    if (replyButtons.length === 0) {
      // WhatsApp's button type only understands taps that come back to us; a
      // url/phone/email action has to ride in the body text instead.
      const links = buttons
        .map((b) => ('url' in b ? b.url : 'phone' in b ? `tel:${b.phone}` : 'email' in b ? `mailto:${b.email}` : null))
        .filter(Boolean);
      const text = [bodyText, ...links].join('\n');
      return this.sendText(phoneNumberId, to, text, accessToken);
    }

    return this.post(phoneNumberId, accessToken, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons: replyButtons },
      },
    });
  }

  /** A scrollable picker — up to 10 rows. Better than buttons for menus (main-menu equivalent). */
  static async sendInteractiveList(
    phoneNumberId: string,
    to: string,
    bodyText: string,
    buttonLabel: string,
    sections: ListSection[],
    accessToken: string,
  ): Promise<WaSendResult> {
    return this.post(phoneNumberId, accessToken, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonLabel.slice(0, 20),
          sections: sections.slice(0, 10).map((s) => ({
            title: s.title?.slice(0, 24),
            rows: s.rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              description: r.description?.slice(0, 72),
            })),
          })),
        },
      },
    });
  }

  /** One or more products from a connected Commerce Catalog. Needs `catalogId` on the account. */
  static async sendCatalogProducts(
    phoneNumberId: string,
    to: string,
    catalogId: string,
    productIds: string[],
    bodyText: string | undefined,
    accessToken: string,
  ): Promise<WaSendResult> {
    const action =
      productIds.length === 1
        ? { catalog_id: catalogId, product_retailer_id: productIds[0] }
        : { catalog_id: catalogId, sections: [{ title: 'Products', product_items: productIds.map((id) => ({ product_retailer_id: id })) }] };

    return this.post(phoneNumberId, accessToken, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: productIds.length === 1 ? 'product' : 'product_list',
        body: bodyText ? { text: bodyText } : undefined,
        action,
      },
    });
  }

  static async sendLocationRequest(phoneNumberId: string, to: string, text: string, accessToken: string): Promise<WaSendResult> {
    return this.post(phoneNumberId, accessToken, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: { type: 'location_request_message', body: { text }, action: { name: 'send_location' } },
    });
  }

  static async sendMedia(
    phoneNumberId: string,
    to: string,
    kind: 'image' | 'video' | 'audio' | 'document',
    url: string,
    accessToken: string,
    caption?: string,
  ): Promise<WaSendResult> {
    return this.post(phoneNumberId, accessToken, {
      messaging_product: 'whatsapp',
      to,
      type: kind,
      [kind]: { link: url, ...(caption && kind !== 'audio' ? { caption } : {}) },
    });
  }

  /** Dispatch our generic MessageContent union to the right WhatsApp send call. */
  static async sendContent(
    phoneNumberId: string,
    to: string,
    content: MessageContent,
    accessToken: string,
    catalogId?: string,
  ): Promise<WaSendResult> {
    switch (content.kind) {
      case 'text':
        return this.sendText(phoneNumberId, to, content.text, accessToken);
      case 'buttons':
        return this.sendInteractiveButtons(phoneNumberId, to, content.text, content.buttons, accessToken);
      case 'whatsapp_template':
        return this.sendTemplate(phoneNumberId, to, content.templateName, content.language, accessToken, content.params);
      case 'interactive_list':
        return this.sendInteractiveList(phoneNumberId, to, content.text, content.buttonLabel, content.sections, accessToken);
      case 'catalog':
        return this.sendCatalogProducts(
          phoneNumberId,
          to,
          content.catalogId || catalogId || '',
          content.productIds,
          content.bodyText,
          accessToken,
        );
      case 'location_request':
        return this.sendLocationRequest(phoneNumberId, to, content.text, accessToken);
      case 'image':
        return this.sendMedia(phoneNumberId, to, 'image', content.url, accessToken, content.caption);
      case 'video':
        return this.sendMedia(phoneNumberId, to, 'video', content.url, accessToken, content.caption);
      case 'audio':
        return this.sendMedia(phoneNumberId, to, 'audio', content.url, accessToken);
      case 'file':
        return this.sendMedia(phoneNumberId, to, 'document', content.url, accessToken);
      case 'cards': {
        // WhatsApp has no carousel template type for freeform sends; the closest
        // faithful rendering is one message per card.
        let last: WaSendResult = { success: true };
        for (const card of content.cards) {
          const text = [card.title, card.subtitle].filter(Boolean).join('\n');
          last = card.buttons?.length
            ? await this.sendInteractiveButtons(phoneNumberId, to, text, card.buttons, accessToken)
            : await this.sendText(phoneNumberId, to, text, accessToken);
        }
        return last;
      }
      default:
        return { success: false, error: `Message kind "${content.kind}" is not sendable over WhatsApp` };
    }
  }

  private static async post(phoneNumberId: string, accessToken: string, body: Record<string, unknown>): Promise<WaSendResult> {
    try {
      const res = await client(accessToken).post(`/${phoneNumberId}/messages`, body);
      return { success: true, messageId: res.data?.messages?.[0]?.id, data: res.data };
    } catch (error: any) {
      const { message, code } = unwrapError(error);
      console.error('[WhatsApp] send failed:', message);
      return { success: false, error: message, code };
    }
  }

  // ---------------------------------------------------------------------
  // Conversation mechanics
  // ---------------------------------------------------------------------

  /** Blue ticks. Also the recommended way to acknowledge receipt of an inbound message. */
  static async markRead(phoneNumberId: string, messageId: string, accessToken: string): Promise<void> {
    try {
      await client(accessToken).post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch (error: any) {
      console.warn('[WhatsApp] markRead failed:', unwrapError(error).message);
    }
  }

  /** A media id (from an inbound message) resolves to a short-lived CDN URL. */
  static async resolveMediaUrl(mediaId: string, accessToken: string): Promise<{ url: string; mimeType: string } | null> {
    try {
      const res = await client(accessToken).get(`/${mediaId}`);
      return { url: res.data.url, mimeType: res.data.mime_type };
    } catch (error: any) {
      console.warn('[WhatsApp] resolveMediaUrl failed:', unwrapError(error).message);
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------

  /** Every template registered on this WABA, with its current review status. */
  static async listTemplates(wabaId: string, accessToken: string) {
    try {
      const res = await client(accessToken).get(`/${wabaId}/message_templates`, {
        params: { fields: 'id,name,language,category,status,components,rejected_reason', limit: 200 },
      });
      return { success: true, templates: res.data?.data ?? [] };
    } catch (error: any) {
      const { message } = unwrapError(error);
      return { success: false, error: message, templates: [] };
    }
  }

  // ---------------------------------------------------------------------
  // Webhook subscription
  // ---------------------------------------------------------------------

  /**
   * Subscribe our app to this WABA's events. Unlike Instagram (subscribed per
   * account) WhatsApp subscribes per Business Account, and the app itself must
   * already have a webhook registered for the `whatsapp_business_account` object
   * at the app level (done once, in Meta's dashboard or via the app subscriptions
   * endpoint — see meta.routes.ts).
   */
  static async subscribeApp(wabaId: string, accessToken: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await client(accessToken).post(`/${wabaId}/subscribed_apps`);
      return { success: res.data?.success !== false };
    } catch (error: any) {
      return { success: false, error: unwrapError(error).message };
    }
  }

  static async listPhoneNumbers(wabaId: string, accessToken: string) {
    try {
      const res = await client(accessToken).get(`/${wabaId}/phone_numbers`, {
        params: { fields: 'id,display_phone_number,verified_name,quality_rating,platform_type' },
      });
      return { success: true, numbers: res.data?.data ?? [] };
    } catch (error: any) {
      return { success: false, error: unwrapError(error).message, numbers: [] };
    }
  }
}
