import connectDB from '@/lib/mongodb';
import Politician, { type IPolitician } from '@/models/Politician';
import PoliticianPost from '@/models/PoliticianPost';
import {
    aggregatePoliticianStats,
    classifyPost,
    type ClassifiedPost,
    type PostCategory,
} from '@/lib/rank-politician/score';
import { classifyPostWithLlm } from '@/lib/rank-politician/classify-llm';
import { isLlmConfigured } from '@/lib/llm';
import {
    fetchPoliticianPostsFromGoogleNewsRss,
    getFirecrawlCreditUsage,
    isFirecrawlCreditError,
    parsePostsFromFirecrawl,
    scrapeXProfileWithFirecrawl,
    scrapeXProfileWithJina,
    type ScrapedPostCandidate,
    type ScrapeProviderName,
} from '@/lib/rank-politician/scrape';

// Cabinet-only set (~30). Keep batches small so each cron run finishes well inside serverless limits.
export const RANK_POLITICIAN_BATCH_SIZE = 8;
/** Skip re-scrape if last success was fresher than this. */
export const SCRAPE_COOLDOWN_HOURS = 20;
/** Do not use Firecrawl unless at least this many Firecrawl credits remain. */
export const MIN_FIRECRAWL_CREDITS = 5;
/** Parallel profile scrapes inside one batch. */
const SCRAPE_CONCURRENCY = 3;
/** Parallel LLM classifications per politician. */
const CLASSIFY_CONCURRENCY = 6;
/** Non-credit scrape errors wait this long before retrying. */
const ERROR_RETRY_HOURS = 6;

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const runners = Math.min(Math.max(concurrency, 1), items.length);
    await Promise.all(
        Array.from({ length: runners }, async () => {
            while (cursor < items.length) {
                const index = cursor++;
                results[index] = await worker(items[index], index);
            }
        })
    );
    return results;
}

function scrapePriority(status?: string | null): number {
    switch (status) {
        case 'never':
            return 0;
        case 'partial':
            return 1;
        case 'error':
            // Credit/auth failures should not jump the queue ahead of never-scraped.
            return 2;
        case 'success':
            return 3;
        default:
            return 0;
    }
}

function isFreshSuccess(politician: { lastScrapeStatus?: string; lastScrapedAt?: Date | string | null }) {
    if (politician.lastScrapeStatus !== 'success' || !politician.lastScrapedAt) return false;
    const ageMs = Date.now() - new Date(politician.lastScrapedAt).getTime();
    return ageMs < SCRAPE_COOLDOWN_HOURS * 60 * 60 * 1000;
}

function isCreditErrorMessage(message?: string | null) {
    return /insufficient credits|not enough credits|firecrawl/i.test(String(message || ''));
}

function isInErrorBackoff(politician: { lastScrapeStatus?: string; lastScrapedAt?: Date | string | null; lastScrapeError?: string | null }) {
    if (politician.lastScrapeStatus !== 'error' || !politician.lastScrapedAt) return false;
    // Previous Firecrawl/credit errors should be retried immediately now that Jina Reader + RSS are enabled.
    if (isCreditErrorMessage(politician.lastScrapeError)) return false;
    const ageMs = Date.now() - new Date(politician.lastScrapedAt).getTime();
    return ageMs < ERROR_RETRY_HOURS * 60 * 60 * 1000;
}

export interface PoliticianScrapeSummary {
    slug: string;
    xHandle: string;
    status: 'success' | 'error' | 'skipped';
    provider?: ScrapeProviderName;
    postsFound: number;
    postsUpserted: number;
    scoredBy?: 'llm' | 'keyword' | 'mixed';
    error?: string;
}

export interface RankPoliticianRunResult {
    ranAt: string;
    firecrawlConfigured: boolean;
    llmConfigured: boolean;
    creditsRemaining: number | null;
    creditGuardTriggered: boolean;
    processed: number;
    successCount: number;
    errorCount: number;
    skippedCount: number;
    results: PoliticianScrapeSummary[];
}

async function recomputePoliticianStats(politicianId: string) {
    const posts = await PoliticianPost.find({ politicianId })
        .select('category score')
        .lean();

    const stats = aggregatePoliticianStats(
        posts.map((post: any) => ({
            category: (post.category || 'unknown') as PostCategory,
            score: Number(post.score || 0),
        }))
    );

    await Politician.findByIdAndUpdate(politicianId, {
        $set: {
            stats: {
                ...stats,
                lastScoredAt: new Date(),
            },
        },
    });

    return stats;
}

async function classifyCandidate(
    text: string,
    politician: IPolitician & { _id: any }
): Promise<(ClassifiedPost & { scoredBy: 'llm' | 'keyword' }) | null> {
    if (isLlmConfigured()) {
        try {
            return await classifyPostWithLlm(text, {
                politicianName: politician.name,
                portfolio: politician.portfolio || '',
                portfolioTopics: politician.portfolioTopics || [],
            });
        } catch (error: any) {
            // Fall back to deterministic keyword classification if LLM call fails,
            // so posts are still scored rather than dropped.
            console.error('[rank-politician] LLM classify failed, using keyword fallback', politician.slug, error?.message || error);
        }
    }

    const keyword = classifyPost(text, politician.portfolioTopics || []);
    return { ...keyword, scoredBy: 'keyword' };
}

async function upsertScoredPosts(
    politician: IPolitician & { _id: any },
    candidates: ScrapedPostCandidate[]
): Promise<{ upserted: number; skipped: number; scoredBy: 'llm' | 'keyword' | 'mixed' }> {
    let upserted = 0;
    let skipped = 0;
    const methods = new Set<'llm' | 'keyword'>();

    await mapWithConcurrency(candidates, CLASSIFY_CONCURRENCY, async (candidate) => {
        const classification = await classifyCandidate(candidate.text, politician);
        if (!classification) {
            skipped++;
            return;
        }
        methods.add(classification.scoredBy);

        await PoliticianPost.findOneAndUpdate(
            { externalId: candidate.externalId },
            {
                $set: {
                    politicianId: politician._id,
                    text: candidate.text,
                    postedAt: candidate.postedAt,
                    postUrl: candidate.postUrl,
                    rawMarkdown: candidate.rawMarkdown,
                    category: classification.category,
                    score: classification.score,
                    scoreReason: classification.scoreReason,
                    scoredBy: classification.scoredBy,
                    scoredAt: new Date(),
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        upserted++;
    });

    const scoredBy: 'llm' | 'keyword' | 'mixed' =
        methods.size === 1 && methods.has('llm')
            ? 'llm'
            : methods.size === 1 && methods.has('keyword')
              ? 'keyword'
              : 'mixed';

    return { upserted, skipped, scoredBy };
}

/**
 * Multi-provider fetch chain:
 * 1. Jina Reader (`r.jina.ai/https://x.com/<handle>`) — free, no credits required.
 * 2. Firecrawl — used only if Jina returned 0 posts AND Firecrawl is configured with available credits.
 * 3. Google News RSS — 100% free fallback if X blocks headless browsers for a handle.
 */
async function fetchPoliticianCandidatesWithFallback(
    politician: IPolitician & { _id: any },
    options: { allowFirecrawl?: boolean } = {}
): Promise<{ candidates: ScrapedPostCandidate[]; provider: ScrapeProviderName }> {
    const errors: string[] = [];

    // Tier 1: Jina Reader (free, zero credits)
    try {
        const jinaScraped = await scrapeXProfileWithJina(politician.xProfileUrl);
        const jinaCandidates = parsePostsFromFirecrawl(
            politician.xHandle,
            jinaScraped.markdown,
            jinaScraped.links
        );
        if (jinaCandidates.length > 0) {
            return { candidates: jinaCandidates, provider: 'jina' };
        }
        errors.push('Jina returned 0 posts');
    } catch (err: any) {
        errors.push(`Jina: ${err?.message || 'failed'}`);
    }

    // Tier 2: Firecrawl (optional if configured and allowed)
    if (options.allowFirecrawl && process.env.FIRECRAWL_API_KEY) {
        try {
            const fcScraped = await scrapeXProfileWithFirecrawl(politician.xProfileUrl);
            const fcCandidates = parsePostsFromFirecrawl(
                politician.xHandle,
                fcScraped.markdown,
                fcScraped.links
            );
            if (fcCandidates.length > 0) {
                return { candidates: fcCandidates, provider: 'firecrawl' };
            }
            errors.push('Firecrawl returned 0 posts');
        } catch (err: any) {
            errors.push(`Firecrawl: ${err?.message || 'failed'}`);
        }
    }

    // Tier 3: Google News RSS fallback (free, always available)
    try {
        const rssCandidates = await fetchPoliticianPostsFromGoogleNewsRss({
            name: politician.name,
            xHandle: politician.xHandle,
            portfolio: politician.portfolio,
        });
        if (rssCandidates.length > 0) {
            return { candidates: rssCandidates, provider: 'google-news-rss' };
        }
        errors.push('RSS returned 0 items');
    } catch (err: any) {
        errors.push(`RSS: ${err?.message || 'failed'}`);
    }

    throw new Error(`All scrape providers failed (${errors.join(' | ')})`);
}

export async function scrapeAndScorePolitician(
    politician: IPolitician & { _id: any },
    options: { allowFirecrawl?: boolean } = {}
): Promise<PoliticianScrapeSummary> {
    const summary: PoliticianScrapeSummary = {
        slug: politician.slug,
        xHandle: politician.xHandle,
        status: 'success',
        postsFound: 0,
        postsUpserted: 0,
    };

    try {
        const { candidates, provider } = await fetchPoliticianCandidatesWithFallback(
            politician,
            options
        );
        summary.provider = provider;
        summary.postsFound = candidates.length;

        if (candidates.length === 0) {
            await Politician.findByIdAndUpdate(politician._id, {
                $set: {
                    lastScrapedAt: new Date(),
                    lastScrapeStatus: 'partial',
                    lastScrapeError: 'No posts parsed from any provider',
                },
            });
            summary.status = 'error';
            summary.error = 'No posts parsed from any provider';
            return summary;
        }

        const upsert = await upsertScoredPosts(politician, candidates);
        summary.postsUpserted = upsert.upserted;
        summary.scoredBy = upsert.scoredBy;

        if (upsert.upserted === 0) {
            const message = 'Could not classify any posts in this scrape';
            await Politician.findByIdAndUpdate(politician._id, {
                $set: {
                    lastScrapedAt: new Date(),
                    lastScrapeStatus: 'error',
                    lastScrapeError: message,
                },
            });
            summary.status = 'error';
            summary.error = message;
            return summary;
        }

        await recomputePoliticianStats(String(politician._id));

        await Politician.findByIdAndUpdate(politician._id, {
            $set: {
                lastScrapedAt: new Date(),
                lastScrapeStatus: 'success',
            },
            $unset: { lastScrapeError: 1 },
        });

        return summary;
    } catch (error: any) {
        const message = error?.message || 'Unknown scrape error';
        await Politician.findByIdAndUpdate(politician._id, {
            $set: {
                lastScrapedAt: new Date(),
                lastScrapeStatus: 'error',
                lastScrapeError: message.slice(0, 500),
            },
        });
        summary.status = 'error';
        summary.error = message;
        if (isFirecrawlCreditError(error)) {
            throw error;
        }
        return summary;
    }
}

export async function runRankPoliticianScrapeBatch(
    options: { limit?: number; slugs?: string[]; force?: boolean } = {}
): Promise<RankPoliticianRunResult> {
    await connectDB();

    const firecrawlConfigured = Boolean(process.env.FIRECRAWL_API_KEY);
    const llmConfigured = isLlmConfigured();
    const limit = Math.max(1, Math.min(options.limit || RANK_POLITICIAN_BATCH_SIZE, 15));
    const force = Boolean(options.force);

    // Check optional Firecrawl credits only to decide if Tier-2 Firecrawl fallback can be used.
    // Even if Firecrawl is unconfigured or has 0 credits, Jina Reader + Google News RSS run for free.
    const creditUsage = firecrawlConfigured ? await getFirecrawlCreditUsage() : null;
    const creditsRemaining =
        creditUsage && Number.isFinite(creditUsage.remainingCredits)
            ? creditUsage.remainingCredits
            : null;
    const allowFirecrawl =
        firecrawlConfigured &&
        creditsRemaining !== null &&
        creditsRemaining >= MIN_FIRECRAWL_CREDITS;

    const filter: Record<string, unknown> = { isActive: true };
    if (options.slugs?.length) {
        filter.slug = { $in: options.slugs.map((s) => s.toLowerCase()) };
    }

    const candidates = await Politician.find(filter).lean();
    const politicians = (candidates as any[])
        .filter((p) => {
            if (force) return true;
            if (isFreshSuccess(p)) return false;
            if (isInErrorBackoff(p)) return false;
            return true;
        })
        .sort((a, b) => {
            const priorityDiff =
                scrapePriority(a.lastScrapeStatus) - scrapePriority(b.lastScrapeStatus);
            if (priorityDiff !== 0) return priorityDiff;

            const aTime = a.lastScrapedAt ? new Date(a.lastScrapedAt).getTime() : 0;
            const bTime = b.lastScrapedAt ? new Date(b.lastScrapedAt).getTime() : 0;
            if (aTime !== bTime) return aTime - bTime;

            return String(a.slug || '').localeCompare(String(b.slug || ''));
        })
        .slice(0, limit);

    const results = await mapWithConcurrency(
        politicians,
        SCRAPE_CONCURRENCY,
        async (politician): Promise<PoliticianScrapeSummary> => {
            return await scrapeAndScorePolitician(politician, { allowFirecrawl });
        }
    );

    return {
        ranAt: new Date().toISOString(),
        firecrawlConfigured,
        llmConfigured,
        creditsRemaining,
        creditGuardTriggered: false,
        processed: results.length,
        successCount: results.filter((r) => r.status === 'success').length,
        errorCount: results.filter((r) => r.status === 'error').length,
        skippedCount: results.filter((r) => r.status === 'skipped').length,
        results,
    };
}

export { recomputePoliticianStats };
