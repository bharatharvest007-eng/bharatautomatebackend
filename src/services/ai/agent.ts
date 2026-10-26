/**
 * STUB: implemented by D5 (AI Agent, Knowledge, Moderation, Brand Voice).
 *
 * The AI sales/support agent that drafts replies to DMs and comments. The
 * foundation ships this compiling stub so the engine, widget and inbox can
 * call it today; it always declines ('none'), which callers treat as "no AI
 * reply" and fall back to their non-AI behavior.
 */

export interface AgentInput {
  orgId: string;
  accountId: string;
  channel: 'instagram' | 'facebook' | 'whatsapp' | 'widget';
  message: string;
  conversationId?: string;
  contactId?: string;
  history?: { role: 'user' | 'assistant'; text: string }[];
  instruction?: string;
  useKnowledgeBase?: boolean;
  maxWords?: number;
  context?: 'dm' | 'comment';
}

export interface AgentOutput {
  reply: string | null;
  confidence: number;
  action: 'send' | 'approve' | 'handoff' | 'none';
  reason?: string;
  language?: string;
  capturedLead?: boolean;
}

export async function runAgentReply(_input: AgentInput): Promise<AgentOutput> {
  return { reply: null, confidence: 0, action: 'none', reason: 'not implemented' };
}
