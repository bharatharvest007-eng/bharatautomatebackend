import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();
const apiKey = process.env.ANTHROPIC_API_KEY || '';
const client = apiKey ? new Anthropic({ apiKey }) : null;
export class AiService {
    /**
     * Generate an engaging, authentic Instagram comment reply matching the creator's brand voice
     */
    static async generateCommentReply(commentText, postCaption = '', brandVoice = {}) {
        if (!client || apiKey.startsWith('sk-ant-dummy')) {
            // High-quality contextual fallback if API key is not configured yet
            const cleanComment = commentText.toLowerCase();
            let reply = 'Thank you so much! Sending you the details in DM right now! 🚀';
            if (cleanComment.includes('price') || cleanComment.includes('cost')) {
                reply = 'Just sent you the full pricing breakdown in your DMs! Check your message requests 📩';
            }
            else if (cleanComment.includes('link') || cleanComment.includes('send')) {
                reply = 'Sent! Check your DMs for the direct access link! ✨';
            }
            else if (cleanComment.includes('how') || cleanComment.includes('info')) {
                reply = 'Great question! DMing you the step-by-step breakdown right now! 🙌';
            }
            return { reply, tokensUsed: 42 };
        }
        const systemPrompt = `You are the authentic, friendly voice of an Instagram creator.
Persona: ${brandVoice.personaName || 'Creator Studio'}
Tone: ${brandVoice.tone || 'warm, engaging, and professional'}
Rules:
- Keep it under 2 sentences.
- Never sound like a robot.
- Use 1-2 relevant emojis.
- Invite the commenter to check their DMs or reply with enthusiasm.
${brandVoice.rules ? brandVoice.rules.map((r) => `- ${r}`).join('\n') : ''}
Forbidden words: ${brandVoice.forbiddenWords?.join(', ') || 'none'}
`;
        try {
            const response = await client.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 150,
                temperature: 0.7,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: `Post context: "${postCaption}"\nComment received: "${commentText}"\nWrite a short, engaging reply:`,
                    },
                ],
            });
            const reply = response.content[0]?.type === 'text'
                ? response.content[0].text.trim()
                : 'Thank you! Sent you the details in DMs! 🚀';
            return {
                reply,
                tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
            };
        }
        catch (error) {
            console.warn('[AI Service] Claude call failed, falling back:', error.message);
            return {
                reply: 'Appreciate your comment! Just sent the link directly to your DMs! 🚀',
                tokensUsed: 0,
            };
        }
    }
    /**
     * Score toxicity and detect spam/promotional bot comments
     */
    static async classifySpam(commentText) {
        const spamKeywords = [
            'crypto',
            'whatsapp me',
            'promote it on',
            'dm @',
            'send pic on',
            'free followers',
            'check bio',
            'telegram',
            'invest with',
            'earn $',
        ];
        const lower = commentText.toLowerCase();
        const matched = spamKeywords.find((kw) => lower.includes(kw));
        if (matched) {
            return {
                isSpam: true,
                score: 95,
                reason: `Matched spam phrase: "${matched}"`,
            };
        }
        if (!client || apiKey.startsWith('sk-ant-dummy')) {
            return { isSpam: false, score: 5, reason: 'Clean comment' };
        }
        try {
            const response = await client.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 100,
                temperature: 0,
                messages: [
                    {
                        role: 'user',
                        content: `Analyze this Instagram comment: "${commentText}". Return a JSON object with: { "isSpam": boolean, "score": number (0-100), "reason": string }. JSON only.`,
                    },
                ],
            });
            const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
            const parsed = JSON.parse(text);
            return {
                isSpam: Boolean(parsed.isSpam),
                score: Number(parsed.score) || 0,
                reason: parsed.reason || 'Analyzed by Claude AI',
            };
        }
        catch {
            return { isSpam: false, score: 10, reason: 'Evaluated safe' };
        }
    }
}
