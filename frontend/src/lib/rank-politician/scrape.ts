export interface ScrapedPostCandidate {
    externalId: string;
    text: string;
    postUrl?: string;
    postedAt?: Date;
    rawMarkdown?: string;
}

export type ScrapeProviderName = 'jina' | 'firecrawl' | 'google-news-rss';

export interface FirecrawlScrapeResult {
    markdown: string;
    links: string[];
    provider?: ScrapeProviderName;
    raw?: unknown;
}

const STATUS_URL_RE =
    /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)/i;

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v2/scrape';
const FIRECRAWL_CREDITS_URL = 'https://api.firecrawl.dev/v2/team/credit-usage';
const JINA_READER_BASE_URL = 'https://r.jina.ai/';
const DEFAULT_TIMEOUT_MS = 45000;
const TWITTER_EPOCH_MS = BigInt('1288834974657');
const SNOWFLAKE_SHIFT = BigInt(22);

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

/**
 * Decode an X/Twitter Snowflake status ID into its exact UTC creation Date.
 * Every status ID since Nov 2010 encodes `(timestampMs - 1288834974657) << 22`.
 */
export function decodeSnowflakeTimestamp(statusId: string): Date | undefined {
    if (!/^\d{15,22}$/.test(statusId)) return undefined;
    try {
        const idBig = BigInt(statusId);
        const timestampMs = Number((idBig >> SNOWFLAKE_SHIFT) + TWITTER_EPOCH_MS);
        if (!Number.isFinite(timestampMs) || timestampMs < 1288834974657) return undefined;
        return new Date(timestampMs);
    } catch {
        return undefined;
    }
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
        .replace(/\[Video\s*\d*\]\([^)]+\)/gi, ' ')
        .replace(/\[\]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/^>\s?/gm, '')
        .replace(/https?:\/\/t\.co\/\S+/gi, ' ')
        .replace(/blob:https?:\/\/\S+/gi, ' ')
        .replace(/\b\d{1,2}:\d{2}(?:\s*\/\s*\d{1,2}:\d{2})?\b/g, ' ')
        .replace(/\bShow more\b/gi, ' ')
        .replace(/\b(?:\d+(?:\.\d+)?[KMB]?\s+){2,4}\d+(?:\.\d+)?[KMB]?\s*$/g, ' ')
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
    if (/^(home|explore|notifications|messages|profile|repost|reply|like|share|follow|following|followers|pinned)$/i.test(normalized)) {
        return true;
    }
    if (/^\d+\s+(replies|reposts|likes|views|quotes)$/i.test(normalized)) return true;
    if (/^likes:\s*\d+/i.test(normalized)) return true;
    if (/^@\w+$/.test(normalized)) return true;
    if (/^(log in|sign up|continue with|see what’s happening|don’t miss what’s happening)/i.test(normalized)) {
        return true;
    }
    return false;
}

function hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
}

function parsePostedAt(block: string, statusId?: string): Date | undefined {
    const match = block.match(/Posted:\s*([^\n]+)/i);
    if (match) {
        const raw = match[1].replace(/\\/g, '').trim();
        const date = new Date(raw);
        if (!Number.isNaN(date.getTime())) return date;
    }
    if (statusId) {
        return decodeSnowflakeTimestamp(statusId);
    }
    return undefined;
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
 * Parse Jina Reader Markdown where each tweet is rendered as a bullet item (`* ...`)
 * or contains inline `[time](https://x.com/<handle>/status/<id>)` status links.
 */
function parseJinaBulletPosts(
    normalizedHandle: string,
    markdown: string
): Map<string, ScrapedPostCandidate> {
    const candidates = new Map<string, ScrapedPostCandidate>();

    // Split on top-level markdown list bullets (`*   `) that Jina emits for X timeline items
    const bulletItems = markdown.split(/(?:^|\n)\*\s{1,4}/);

    for (const rawBullet of bulletItems) {
        const bullet = rawBullet.split(/\n##\s+/)[0] || rawBullet;
        if (!bullet.trim()) continue;

        // Find all status links in this bullet (a bullet can contain a quote-tweet, so take the first matching handle status)
        const statusRegex = new RegExp(
            `\\[[^\\]]*\\]\\((https?:\\/\\/(?:www\\.)?(?:x\\.com|twitter\\.com)\\/(${normalizedHandle})\\/status\\/(\\d+))(?:\\/(?:photo|video)\\/\\d+)?\\)`,
            'ig'
        );

        let statusMatch: RegExpExecArray | null = null;
        let statusId = '';
        let matchEndIndex = -1;

        while ((statusMatch = statusRegex.exec(bullet)) !== null) {
            const fullLink = statusMatch[0];
            // Prefer the main timestamp link (not `/photo/1` or `/video/1`)
            if (!/\/(?:photo|video)\/\d+\)$/i.test(fullLink)) {
                statusId = statusMatch[3];
                matchEndIndex = statusMatch.index + fullLink.length;
                break;
            }
            if (!statusId) {
                statusId = statusMatch[3];
                matchEndIndex = statusMatch.index + fullLink.length;
            }
        }

        if (statusId && matchEndIndex >= 0) {
            let bodySlice = bullet.slice(matchEndIndex);
            // Stop before any quoted tweet or engagement counter link (`[12](https://x.com/compose/post?in_reply_to=...)`)
            const replyIdx = bodySlice.search(/\[\d*\]\(https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/compose\/post\?in_reply_to=/i);
            if (replyIdx >= 0) {
                bodySlice = bodySlice.slice(0, replyIdx);
            }

            const cleaned = cleanPostText(bodySlice);
            if (cleaned.length >= 16 && !isNoiseLine(cleaned)) {
                const externalId = `x:${normalizedHandle}:${statusId}`;
                candidates.set(externalId, {
                    externalId,
                    text: cleaned.slice(0, 4000),
                    postUrl: `https://x.com/${normalizedHandle}/status/${statusId}`,
                    postedAt: decodeSnowflakeTimestamp(statusId),
                    rawMarkdown: bullet.slice(0, 2500),
                });
                continue;
            }
        }

        // Handle Jina bullets where X didn't attach the status permalink (e.g., video/pinned posts with avatar link)
        const avatarPrefixRe = new RegExp(
            `\\[!\\[Image[^\\]]*\\]\\([^)]+\\)\\]\\(https?:\\/\\/(?:www\\.)?(?:x\\.com|twitter\\.com)\\/${normalizedHandle}\\)`,
            'i'
        );
        const avatarMatch = bullet.match(avatarPrefixRe);
        if (avatarMatch && avatarMatch.index !== undefined) {
            const afterAvatar = bullet.slice(avatarMatch.index + avatarMatch[0].length);
            const cleaned = cleanPostText(afterAvatar);
            if (cleaned.length >= 20 && !isNoiseLine(cleaned)) {
                const externalId = `x:${normalizedHandle}:block:${hashText(cleaned)}`;
                if (!candidates.has(externalId)) {
                    candidates.set(externalId, {
                        externalId,
                        text: cleaned.slice(0, 4000),
                        postUrl: `https://x.com/${normalizedHandle}`,
                        rawMarkdown: bullet.slice(0, 2500),
                    });
                }
            }
        }
    }

    return candidates;
}

/**
 * Parse X posts from either Firecrawl Markdown (`### 1. Post`) or Jina Reader Markdown (`* ...`).
 */
export function parsePostsFromFirecrawl(
    handle: string,
    markdown: string,
    links: string[] = []
): ScrapedPostCandidate[] {
    const normalizedHandle = handle.replace(/^@/, '').toLowerCase();
    const candidates = new Map<string, ScrapedPostCandidate>();

    // Path 1: Firecrawl structured `### 1. Post` sections
    const sections = markdown
        .split(/(?=^###\s*\d+\.\s*Post)/im)
        .filter((s) => /^###\s*\d+\.\s*Post/i.test(s.trim()));

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
            postedAt: parsePostedAt(section, statusId),
            rawMarkdown: section.slice(0, 2500),
        });
    }

    // Path 2: Jina Reader bullet items (`* [![Image]...] [@Handle] [5m](https://x.com/Handle/status/ID) ...`)
    if (candidates.size === 0) {
        const jinaCandidates = parseJinaBulletPosts(normalizedHandle, markdown);
        for (const [id, item] of jinaCandidates) {
            candidates.set(id, item);
        }
    }

    // Path 3: Status URLs from links + nearby text/blockquotes in full markdown
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
            const fallbackSlice = window
                .replace(/^https?:\/\/\S+\)?/, '')
                .split(/\n\*\s+/)[0];
            const text = cleanPostText(quoteMatch?.[1] || fallbackSlice || '');
            if (!text || text.length < 16 || isNoiseLine(text)) continue;

            const externalId = `x:${normalizedHandle}:${statusId}`;
            candidates.set(externalId, {
                externalId,
                text: text.slice(0, 4000),
                postUrl: `https://x.com/${normalizedHandle}/status/${statusId}`,
                postedAt: decodeSnowflakeTimestamp(statusId),
                rawMarkdown: window.slice(0, 2500),
            });
        }
    }

    // Path 4: Last resort markdown blocks
    if (candidates.size === 0 && markdown.trim()) {
        const mainTimeline = markdown.split(/\n##\s+See\s+/i)[0] || markdown;
        const blocks = mainTimeline
            .split(/\n{2,}/)
            .map((block) => cleanPostText(block))
            .filter(
                (block) =>
                    block.length >= 40 &&
                    !isNoiseLine(block) &&
                    !/^latest posts$/i.test(block) &&
                    !/^(title|url source|markdown content):/i.test(block)
            );

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

/**
 * Scrape an X profile using Jina Reader (`https://r.jina.ai/https://x.com/<handle>`).
 * Works completely free without any API key (or optionally accepts `JINA_API_KEY` for higher rate limits).
 */
export async function scrapeXProfileWithJina(
    profileUrl: string,
    jinaApiKey: string = process.env.JINA_API_KEY || ''
): Promise<FirecrawlScrapeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'X-With-Links-Summary': 'true',
            'X-Wait-For-Selector': 'article',
        };
        if (jinaApiKey) {
            headers.Authorization = `Bearer ${jinaApiKey}`;
        }

        const response = await fetch(`${JINA_READER_BASE_URL}${profileUrl}`, {
            method: 'GET',
            headers,
            cache: 'no-store',
            signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') || '';
        if (!response.ok) {
            throw new Error(`Jina Reader failed (${response.status})`);
        }

        if (contentType.includes('application/json')) {
            const payload = await response.json().catch(() => ({}));
            const data = payload?.data || {};
            const markdown = typeof data.content === 'string' ? data.content : '';
            const linksObj = data.links && typeof data.links === 'object' ? data.links : {};
            const links = Object.values(linksObj).filter(
                (v): v is string => typeof v === 'string'
            );
            return {
                markdown,
                links,
                provider: 'jina',
                raw: payload,
            };
        }

        const markdown = await response.text();
        const links = Array.from(
            markdown.matchAll(/https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+/gi),
            (m) => m[0]
        );
        return {
            markdown,
            links,
            provider: 'jina',
        };
    } finally {
        clearTimeout(timeout);
    }
}

function decodeXmlEntities(input: string): string {
    return input
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Zero-cost RSS fallback via Google News RSS for a minister + portfolio keywords.
 * Used only when both Jina Reader and Firecrawl cannot extract posts from X.
 */
export async function fetchPoliticianPostsFromGoogleNewsRss(options: {
    name: string;
    xHandle: string;
    portfolio?: string;
}): Promise<ScrapedPostCandidate[]> {
    const normalizedHandle = options.xHandle.replace(/^@/, '').toLowerCase();
    const query = `"${options.name}"`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; InfinworkBot/1.0)',
                Accept: 'application/rss+xml, application/xml, text/xml',
            },
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`Google News RSS failed (${res.status})`);
        }

        const xml = await res.text();
        const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));
        const candidates: ScrapedPostCandidate[] = [];

        for (const match of items.slice(0, 15)) {
            const itemXml = match[1];
            const rawTitle = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
            const rawLink = itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
            const rawPubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';

            const title = decodeXmlEntities(rawTitle).replace(/\s+-\s+[^-]+$/, '').trim();
            if (!title || title.length < 20) continue;

            const postedAt = rawPubDate ? new Date(rawPubDate.trim()) : undefined;
            const validDate = postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined;
            const externalId = `rss:${normalizedHandle}:${hashText(title)}`;

            candidates.push({
                externalId,
                text: title.slice(0, 4000),
                postUrl: decodeXmlEntities(rawLink) || `https://x.com/${normalizedHandle}`,
                postedAt: validDate,
                rawMarkdown: title,
            });
        }

        return candidates;
    } finally {
        clearTimeout(timeout);
    }
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
            provider: 'firecrawl',
            raw: payload,
        };
    } finally {
        clearTimeout(timeout);
    }
}
