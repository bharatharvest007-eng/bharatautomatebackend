/**
 * STUB: implemented by D5 (AI Agent, Knowledge, Moderation, Brand Voice).
 *
 * Classifies inbound comments and messages (spam, toxicity, intent,
 * sentiment, urgency, language). Until D5 lands, every message is classified
 * as neutral, non-spam 'other', so callers never hide or route anything.
 */
export async function classifyInbound(_input) {
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
