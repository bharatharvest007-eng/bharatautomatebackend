import dotenv from 'dotenv';
import { FarmboxService } from './farmboxService.js';
import { ClaudeBudgetGuard } from './claudeGuard.js';

dotenv.config();

export interface BrandVoiceConfig {
  personaName?: string;
  tone?: string;
  rules?: string[];
  sampleReplies?: string[];
  forbiddenWords?: string[];
}

export class AiService {
  /**
   * Detects whether text contains Telugu unicode characters
   */
  static isTelugu(text: string): boolean {
    return /[\u0C00-\u0C7F]/.test(text);
  }

  /**
   * Generate an engaging, authentic reply matching Farm Box's bilingual grocery voice
   */
  static async generateCommentReply(
    commentText: string,
    postCaption: string = '',
    brandVoice: BrandVoiceConfig = {},
    instruction?: string,
  ): Promise<{ reply: string; tokensUsed: number }> {
    const isTe = this.isTelugu(commentText);
    const cleanComment = commentText.toLowerCase();

    const availableBoxes = FarmboxService.getCuratedBoxes();
    const boxSummary = availableBoxes.map((b: any) => `${b.name} (${b.nameTe}): ₹${b.priceInr}`).join(', ');

    const systemPrompt = `You are the authentic, warm, and helpful voice of Farm Box (ఫార్మ్ బాక్స్) — a farm-to-table organic grocery and fresh produce brand in Hyderabad delivering directly to homes.
Persona: ${brandVoice.personaName || 'Farm Box Fresh Produce Concierge'}
Tone: ${brandVoice.tone || 'warm, appetizing, helpful, fresh farm-to-table, bilingual in Telugu & English'}
Produce & Box Context:
- Available Boxes: ${boxSummary}
- Delivery Slots: Morning (6:00 - 9:00 AM) and Evening (5:00 - 8:00 PM)
- Produce is directly harvested from certified partner farms and delivered in eco-friendly packaging within 12 hours of harvest.

Language Instructions:
- If the user's comment is in Telugu or contains Telugu script, ALWAYS reply in natural, conversational Telugu script.
- If in English, reply in friendly English.
- If Hinglish or mixed, match the user's vibe warmly.

Formatting Rules:
- Keep the reply concise (1 to 2 sentences max).
- Never sound like a generic corporate bot. Mention fresh harvest or produce box.
- Use 1-2 fresh produce emojis (🥦, 🧺, 🥕, 🌿, ✨).
- Invite them to check their DMs for the cart link or details.
${brandVoice.rules ? brandVoice.rules.map((r) => `- ${r}`).join('\n') : ''}
Forbidden words: ${brandVoice.forbiddenWords?.join(', ') || 'crypto, click bio link'}
${instruction ? `\nExtra instruction: ${instruction}` : ''}
`;

    // Execute with Claude Haiku & $3.00 budget guard
    const aiRes = await ClaudeBudgetGuard.executeMessage({
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Post context: "${postCaption}"\nCustomer comment: "${commentText}"\nWrite a short, engaging reply:`,
        },
      ],
      maxTokens: 120,
      context: 'comment_reply',
    });

    if (aiRes?.text) {
      return {
        reply: aiRes.text.trim(),
        tokensUsed: aiRes.inputTokens + aiRes.outputTokens,
      };
    }

    // High-quality contextual offline fallback if budget reached or offline
    let reply: string;
    if (isTe) {
      if (cleanComment.includes('ధర') || cleanComment.includes('రేటు') || cleanComment.includes('ఎంత')) {
        reply = 'నమస్తే! ఫార్మ్ బాక్స్ తాజా కూరగాయల బాక్స్ కేవలం ₹399 మాత్రమే. పూర్తి వివరాలు మరియు ఆర్డర్ లింక్ మీ ఇన్ బాక్స్‌కు పంపాము! 🥦🧺';
      } else if (cleanComment.includes('డెలివరీ') || cleanComment.includes('ఎప్పుడు') || cleanComment.includes('టైమ్')) {
        reply = 'మా తాజా కూరగాయలు రోజూ ఉదయం 6:00 - 9:00 AM మరియు సాయంత్రం 5:00 - 8:00 PM స్లాట్లలో మీ ఇంటికే డెలివరీ అవుతాయి! 🚚🌱';
      } else if (cleanComment.includes('ఆర్డర్') || cleanComment.includes('కావాలి') || cleanComment.includes('పంపండి')) {
        reply = 'ధన్యవాదాలు! ఫార్మ్ బాక్స్ 1-క్లిక్ ఆర్డర్ లింక్ మీ మెసేజ్‌లలో పంపాము, చెక్ చేసుకోండి! ✨';
      } else {
        reply = 'నమస్తే! ఫార్మ్ బాక్స్ తాజా ఆర్గానిక్ పంటల వివరాలు మీ ఇన్ బాక్స్‌కు పంపాము! 🌿';
      }
    } else {
      if (cleanComment.includes('price') || cleanComment.includes('cost') || cleanComment.includes('rate')) {
        reply = 'Our Weekly Farm Fresh Vegetable Box is just ₹399 (10-12 curated items)! DMing you the complete price list and 1-click cart link now! 🥦🧺';
      } else if (cleanComment.includes('delivery') || cleanComment.includes('slot') || cleanComment.includes('time')) {
        reply = 'We deliver fresh harvest morning (6-9 AM) and evening (5-8 PM) right to your doorstep! Sent you the slot selector in DMs! 🚚🌱';
      } else if (cleanComment.includes('order') || cleanComment.includes('buy') || cleanComment.includes('box')) {
        reply = 'Awesome! Sent the direct 1-click order link to your DMs so you can customize your harvest box! ✨';
      } else if (cleanComment.includes('recipe') || cleanComment.includes('cook')) {
        reply = 'Sent the "Cook the Harvest" recipe card and ingredients cart straight to your DMs! Happy cooking! 👨‍🍳🍲';
      } else {
        reply = 'Thank you for reaching out! Just sent our fresh farm harvest catalog directly to your DMs! 🌿✨';
      }
    }

    return { reply, tokensUsed: 0 };
  }

  /**
   * Recommend personalized produce box based on customer preferences or family size
   */
  static recommendBox(familySize: number = 3, _vegetarian: boolean = true, likesFruits: boolean = true) {
    const boxes = FarmboxService.getCuratedBoxes();
    if (likesFruits && familySize >= 4) {
      return {
        recommended: boxes.find((b: any) => b.id === 'box_organic_fruits') || boxes[0],
        secondary: boxes.find((b: any) => b.id === 'box_weekly_fresh'),
        reason: 'Ideal for medium/large families looking for both daily cooking essentials and immune-boosting fresh fruits.',
      };
    }
    return {
      recommended: boxes.find((b: any) => b.id === 'box_weekly_fresh') || boxes[0],
      secondary: boxes.find((b: any) => b.id === 'box_greens_detox'),
      reason: 'Our best-selling daily farm harvest curated for 4-5 days of wholesome home cooking.',
    };
  }

  /**
   * Score toxicity and detect spam/promotional bot comments
   */
  static async classifySpam(
    commentText: string
  ): Promise<{ isSpam: boolean; score: number; reason: string }> {
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

    const aiRes = await ClaudeBudgetGuard.executeMessage({
      messages: [
        {
          role: 'user',
          content: `Analyze this Instagram or Facebook comment: "${commentText}". Return a JSON object with: { "isSpam": boolean, "score": number (0-100), "reason": string }. JSON only.`,
        },
      ],
      maxTokens: 80,
      temperature: 0,
      context: 'spam_classification',
    });

    if (aiRes?.text) {
      try {
        const parsed = JSON.parse(aiRes.text);
        return {
          isSpam: Boolean(parsed.isSpam),
          score: Number(parsed.score) || 0,
          reason: parsed.reason || 'Analyzed by Claude AI',
        };
      } catch {
        // Safe parse fallback
      }
    }

    return { isSpam: false, score: 10, reason: 'Evaluated safe' };
  }
}
