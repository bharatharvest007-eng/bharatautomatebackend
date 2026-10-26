/**
 * STUB: implemented by D5 (AI Agent, Knowledge, Moderation, Brand Voice).
 *
 * The AI sales/support agent that drafts replies to DMs and comments. The
 * foundation ships this compiling stub so the engine, widget and inbox can
 * call it today; it always declines ('none'), which callers treat as "no AI
 * reply" and fall back to their non-AI behavior.
 */
export async function runAgentReply(_input) {
    return { reply: null, confidence: 0, action: 'none', reason: 'not implemented' };
}
