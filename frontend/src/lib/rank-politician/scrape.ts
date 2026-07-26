export interface ScrapedPostCandidate {
    externalId: string;
    text: string;
    postUrl?: string;
    postedAt?: Date;
    rawMarkdown?: string;
}

export interface FirecrawlScrapeResult {
    markdown: string;
    links: string[];
    raw?: unknown;
}

const STATUS_URL_RE =
    /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)/i;

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v2/scrape';
const FIRECRAWL_CREDITS_URL = 'https://api.firecrawl.dev/v2/team/credit-usage';
const DEFAULT_TIMEOUT_MS = 45000;

export class FirecrawlCreditError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FirecrawlCreditError';
    }
}

export function isFirecrawlCreditError(error: unknown): boolean {
    if (error instanceof FirecrawlCreditError) return true;
    const message = String((error as any)?.message || error || '').toLowerCase();
    return message.includes('insufficient credits') || message.includes('not enough credits');
}

export interface FirecrawlCreditUsage {
    remainingCredits: number;
    planCredits?: number;
    billingPeriodStart?: string;
    billingPeriodEnd?: string;
}

/** Read remaining Firecrawl credits before spending any scrape calls. */
export async function getFirecrawlCreditUsage(
    apiKey: string = process.env.FIRECRAWL_API_KEY || ''
): Promise<FirecrawlCreditUsage | null> {
    if (!apiKey) return null;

    try {
        const response = await fetch(FIRECRAWL_CREDITS_URL, {
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) return null;

        const data = payload?.data || {};
        const remaining = Number(data.remainingCredits);
        if (!Number.isFinite(remaining)) return null;

        return {
            remainingCredits: remaining,
            planCredits: Number.isFinite(Number(data.planCredits))
                ? Number(data.planCredits)
                : undefined,
            billingPeriodStart: data.billingPeriodStart,
            billingPeriodEnd: data.billingPeriodEnd,
        };
    } catch {
        return null;
    }
}

function cleanPostText(text: string): string {
    return text
        .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/^>\s?/gm, '')
        .replace(/https?:\/\/t\.co\/\S+/gi, ' ')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\\([.\\-])/g, '$1')
        .replace(/[*_`~]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isNoiseLine(line: string): boolean {
    const normalized = line.toLowerCase().trim();
    if (!normalized) return true;
    if (normalized.length < 8) return true;
    if (/^(home|explore|notifications|messages|profile|repost|reply|like|share|follow|following|followers)$/i.test(normalized)) {
        return true;
    }
    if (/^\d+\s+(replies|reposts|likes|views|quotes)$/i.test(normalized)) return true;
    if (/^likes:\s*\d+/i.test(normalized)) return true;
    if (/^@\w+$/.test(normalized)) return true;
    return false;
}

function hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
}

function parsePostedAt(block: string): Date | undefined {
    const match = block.match(/Posted:\s*([^\n]+)/i);
    if (!match) return undefined;
    const raw = match[1].replace(/\\/g, '').trim();
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function extractBlockquoteText(block: string): string {
    const quoteLines = block
        .split('\n')
        .filter((line) => /^\s*>/.test(line))
        .map((line) => line.replace(/^\s*>\s?/, ''));

    if (quoteLines.length > 0) {
        return cleanPostText(quoteLines.join('\n'));
    }

    // Fallback: text after URL line, before likes/retweets footer.
    const withoutHeader = block
        .replace(/^###\s*\d+\.\s*Post[^\n]*/i, '')
        .replace(/Posted:[^\n]*/i, '')
        .replace(/URL:[^\n]*/i, '')
        .replace(/Likes:[^\n]*/i, '');

    return cleanPostText(withoutHeader);
}

/**
 * Firecrawl X profiles usually return:
 * ### 1. Post
 * Posted: ...
 * URL: https://x.com/.../status/...
 *
 * > tweet text
 *
 * Likes: N | Retweets: N
 */
export function parsePostsFromFirecrawl(
    handle: string,
    markdown: string,
    links: string[] = []
): ScrapedPostCandidate[] {
    const normalizedHandle = handle.replace(/^@/, '').toLowerCase();
    const candidates = new Map<string, ScrapedPostCandidate>();

    const sections = markdown.split(/(?=^###\s*\d+\.\s*Post)/im).filter(Boolean);

    for (const section of sections) {
        if (!/Post/i.test(section) || !/status\/\d+/i.test(section)) continue;

        const urlMatch = section.match(STATUS_URL_RE);
        if (!urlMatch) continue;

        const statusHandle = urlMatch[1].toLowerCase();
        const statusId = urlMatch[2];
        if (statusHandle !== normalizedHandle) continue;

        const text = extractBlockquoteText(section);
        if (!text || text.length < 16) continue;
        if (/^(\d+\.\s*)?post\s+posted:/i.test(text)) continue;

        const externalId = `x:${normalizedHandle}:${statusId}`;
        candidates.set(externalId, {
            externalId,
            text: text.slice(0, 4000),
            postUrl: `https://x.com/${normalizedHandle}/status/${statusId}`,
            postedAt: parsePostedAt(section),
            rawMarkdown: section.slice(0, 2500),
        });
    }

    // Secondary path: status URLs from links + nearby blockquotes in full markdown.
    if (candidates.size === 0) {
        const allUrls = new Set<string>(links.filter(Boolean));
        for (const match of markdown.matchAll(
            /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+/gi
        )) {
            allUrls.add(match[0]);
        }

        for (const url of allUrls) {
            const match = url.match(STATUS_URL_RE);
            if (!match) continue;
            const statusHandle = match[1].toLowerCase();
            const statusId = match[2];
            if (statusHandle !== normalizedHandle) continue;

            const urlIndex = markdown.search(
                new RegExp(
                    `https?:\\/\\/(?:www\\.)?(?:x\\.com|twitter\\.com)\\/${normalizedHandle}\\/status\\/${statusId}`,
                    'i'
                )
            );
            if (urlIndex < 0) continue;

            const window = markdown.slice(urlIndex, Math.min(markdown.length, urlIndex + 1200));
            const quoteMatch = window.match(/(?:^|\n)((?:>.*(?:\n|$))+)/);
            const text = cleanPostText(quoteMatch?.[1] || '');
            if (!text || text.length < 16) continue;

            const externalId = `x:${normalizedHandle}:${statusId}`;
            candidates.set(externalId, {
                externalId,
                text: text.slice(0, 4000),
                postUrl: `https://x.com/${normalizedHandle}/status/${statusId}`,
                rawMarkdown: window.slice(0, 2500),
            });
        }
    }

    // Last resort: markdown blocks.
    if (candidates.size === 0 && markdown.trim()) {
        const blocks = markdown
            .split(/\n{2,}/)
            .map((block) => cleanPostText(block))
            .filter((block) => block.length >= 40 && !isNoiseLine(block) && !/^latest posts$/i.test(block));

        for (const text of blocks.slice(0, 20)) {
            const externalId = `x:${normalizedHandle}:block:${hashText(text)}`;
            if (candidates.has(externalId)) continue;
            candidates.set(externalId, {
                externalId,
                text: text.slice(0, 4000),
                postUrl: `https://x.com/${normalizedHandle}`,
                rawMarkdown: text.slice(0, 2500),
            });
        }
    }

    return Array.from(candidates.values()).slice(0, 40);
}

export async function scrapeXProfileWithFirecrawl(
    profileUrl: string,
    apiKey: string = process.env.FIRECRAWL_API_KEY || ''
): Promise<FirecrawlScrapeResult> {
    if (!apiKey) {
        throw new Error('FIRECRAWL_API_KEY is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
        const response = await fetch(FIRECRAWL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                url: profileUrl,
                formats: ['markdown', 'links'],
                onlyMainContent: true,
                waitFor: 2000,
                timeout: 40000,
            }),
            signal: controller.signal,
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message =
                payload?.error ||
                payload?.message ||
                `Firecrawl scrape failed (${response.status})`;
            if (/insufficient credits|not enough credits/i.test(String(message))) {
                throw new FirecrawlCreditError(String(message));
            }
            throw new Error(message);
        }

        if (payload?.success === false) {
            const message = payload?.error || 'Firecrawl returned success=false';
            if (/insufficient credits|not enough credits/i.test(String(message))) {
                throw new FirecrawlCreditError(String(message));
            }
            throw new Error(message);
        }

        const data = payload?.data || {};
        return {
            markdown: typeof data.markdown === 'string' ? data.markdown : '',
            links: Array.isArray(data.links) ? data.links.filter((l: unknown) => typeof l === 'string') : [],
            raw: payload,
        };
    } finally {
        clearTimeout(timeout);
    }
}
