/**
 * STUB: implemented by D5 (AI Agent, Knowledge, Moderation, Brand Voice).
 *
 * Classifies inbound comments and messages (spam, toxicity, intent,
 * sentiment, urgency, language). Until D5 lands, every message is classified
 * as neutral, non-spam 'other', so callers never hide or route anything.
 */

export type Intent = 'purchase' | 'pricing' | 'support' | 'complaint' | 'question' | 'praise' | 'collab' | 'spam' | 'other';

export interface InboundClassification {
  isSpam: boolean;
  toxic: boolean;
  intent: Intent;
  /** -1 (negative) … 1 (positive). */
  sentiment: number;
  urgency: 'low' | 'normal' | 'high';
  language: string;
  /** 0..1 */
  confidence: number;
  reason?: string;
}

export async function classifyInbound(_input: { orgId: string; accountId: string; text: string; kind: 'comment' | 'message'; platform: string }): Promise<InboundClassification> {
  return {
    isSpam: false,
    toxic: false,
    intent: 'other',
    sentiment: 0,
    urgency: 'normal',
    language: 'und',
    confidence: 0,
    reason: 'not implemented',
  };
}
