import { CATEGORY_POINTS, type ClassifiedPost, type PostCategory } from './score';
import { isLlmConfigured, llmCompletion } from '@/lib/llm';

const VALID_CATEGORIES: PostCategory[] = [
    'on_portfolio',
    'related',
    'off_topic',
    'attack',
    'personal',
    'unknown',
];

export interface LlmClassifyContext {
    politicianName: string;
    portfolio: string;
    portfolioTopics?: string[];
}

function extractJsonObject(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
        // ignore
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        try {
            return JSON.parse(fenced[1].trim()) as Record<string, unknown>;
        } catch {
            // ignore
        }
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
            // ignore
        }
    }

    return null;
}

function buildSystemPrompt(): string {
    return `You classify Indian politicians' public social media posts for a portfolio-focus scoreboard.

Rules:
- Score ONLY against the politician's ASSIGNED department portfolio (listed below). Role titles (PM, CM, party leader, "leadership") do NOT expand the portfolio.
- Mentioning a state name, "development", "vikas", "governance", or thanking someone does NOT make a post on-portfolio by itself.
- Birthday wishes, greetings, thank-you notes, festivals, family = personal (even if they mention the state or "growth").
- Attacks, blame, corruption allegations without portfolio substance = attack.
- Movies/sports/celebrity fluff = off_topic.
- Generic politics/governance not about their assigned departments = related.
- If unclear = unknown.

Return ONLY compact JSON:
{"category":"on_portfolio|related|off_topic|attack|personal|unknown","reason":"short explanation"}`;
}

function buildUserPrompt(text: string, ctx: LlmClassifyContext): string {
    const topics = (ctx.portfolioTopics || []).slice(0, 40).join(', ');
    return `Politician: ${ctx.politicianName}
Assigned portfolio (departments only): ${ctx.portfolio || '(none)'}
Portfolio topic hints: ${topics || '(none)'}

Post:
"""
${text.slice(0, 2500)}
"""

Classify this post.`;
}

/**
 * Classify a post with the configured LLM (default: Bedrock Kimi K2.5).
 * Points still come from CATEGORY_POINTS — LLM only chooses the category.
 */
export async function classifyPostWithLlm(
    text: string,
    ctx: LlmClassifyContext
): Promise<ClassifiedPost & { scoredBy: 'llm' }> {
    if (!isLlmConfigured()) {
        throw new Error('LLM not configured');
    }

    const result = await llmCompletion({
        messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: buildUserPrompt(text, ctx) },
        ],
        temperature: 0.1,
        maxTokens: 220,
        json: true,
    });

    const parsed = extractJsonObject(result.content);
    const rawCategory = String(parsed?.category || '')
        .toLowerCase()
        .trim() as PostCategory;

    const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : 'unknown';
    const reason =
        typeof parsed?.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim().slice(0, 280)
            : 'Classified from post content';

    return {
        category,
        score: CATEGORY_POINTS[category],
        // Keep public-facing reasons vendor-neutral (implementation details live in code).
        scoreReason: reason,
        scoredBy: 'llm',
    };
}
