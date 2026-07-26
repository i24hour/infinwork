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
    getFirecrawlCreditUsage,
    isFirecrawlCreditError,
    parsePostsFromFirecrawl,
    scrapeXProfileWithFirecrawl,
} from '@/lib/rank-politician/scrape';

// Cabinet-only set (~30). Keep batches small so one bad run cannot burn credits.
export const RANK_POLITICIAN_BATCH_SIZE = 8;
/** Skip re-scrape if last success was fresher than this (saves credits). */
export const SCRAPE_COOLDOWN_HOURS = 20;
/** Do not start a batch unless at least this many Firecrawl credits remain. */
export const MIN_FIRECRAWL_CREDITS = 5;

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

function isNonRetriableCreditError(message?: string | null) {
    return /insufficient credits|not enough credits/i.test(String(message || ''));
}

export interface PoliticianScrapeSummary {
    slug: string;
    xHandle: string;
    status: 'success' | 'error' | 'skipped';
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
): Promise<ClassifiedPost & { scoredBy: 'llm' | 'keyword' | 'fallback' }> {
    if (isLlmConfigured()) {
        try {
            return await classifyPostWithLlm(text, {
                politicianName: politician.name,
                portfolio: politician.portfolio || '',
                portfolioTopics: politician.portfolioTopics || [],
            });
        } catch (error: any) {
            // Prefer no false keyword boosts when LLM is the intended scorer.
            return {
                category: 'unknown',
                score: 0,
                scoreReason: `LLM failed, left unscored: ${String(error?.message || error).slice(0, 180)}`,
                scoredBy: 'fallback',
            };
        }
    }

    const keyword = classifyPost(text, politician.portfolioTopics || []);
    return { ...keyword, scoredBy: 'keyword' };
}

async function upsertScoredPosts(
    politician: IPolitician & { _id: any },
    candidates: ReturnType<typeof parsePostsFromFirecrawl>
): Promise<{ upserted: number; scoredBy: 'llm' | 'keyword' | 'mixed' }> {
    let upserted = 0;
    const methods = new Set<'llm' | 'keyword' | 'fallback'>();

    for (const candidate of candidates) {
        const classification = await classifyCandidate(candidate.text, politician);
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
    }

    const scoredBy: 'llm' | 'keyword' | 'mixed' =
        methods.size === 1 && methods.has('llm')
            ? 'llm'
            : methods.size === 1 && methods.has('keyword')
              ? 'keyword'
              : 'mixed';

    return { upserted, scoredBy };
}

export async function scrapeAndScorePolitician(
    politician: IPolitician & { _id: any }
): Promise<PoliticianScrapeSummary> {
    const summary: PoliticianScrapeSummary = {
        slug: politician.slug,
        xHandle: politician.xHandle,
        status: 'success',
        postsFound: 0,
        postsUpserted: 0,
    };

    try {
        const scraped = await scrapeXProfileWithFirecrawl(politician.xProfileUrl);
        const candidates = parsePostsFromFirecrawl(
            politician.xHandle,
            scraped.markdown,
            scraped.links
        );
        summary.postsFound = candidates.length;

        if (candidates.length === 0) {
            await Politician.findByIdAndUpdate(politician._id, {
                $set: {
                    lastScrapedAt: new Date(),
                    lastScrapeStatus: 'partial',
                    lastScrapeError: 'No posts parsed from Firecrawl response',
                },
            });
            summary.status = 'error';
            summary.error = 'No posts parsed from Firecrawl response';
            return summary;
        }

        const upsert = await upsertScoredPosts(politician, candidates);
        summary.postsUpserted = upsert.upserted;
        summary.scoredBy = upsert.scoredBy;
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
        // Credit failures: do not stamp lastScrapedAt as a normal error retry signal.
        // Keep status=error so UI shows failure, but batch runner will abort immediately.
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

    const emptyBase = {
        ranAt: new Date().toISOString(),
        firecrawlConfigured,
        llmConfigured,
        creditsRemaining: null as number | null,
        creditGuardTriggered: false,
        processed: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
        results: [] as PoliticianScrapeSummary[],
    };

    if (!firecrawlConfigured) {
        return {
            ...emptyBase,
            results: [
                {
                    slug: '-',
                    xHandle: '-',
                    status: 'skipped',
                    postsFound: 0,
                    postsUpserted: 0,
                    error: 'FIRECRAWL_API_KEY is not configured',
                },
            ],
            skippedCount: 1,
        };
    }

    const creditUsage = await getFirecrawlCreditUsage();
    const creditsRemaining =
        creditUsage && Number.isFinite(creditUsage.remainingCredits)
            ? creditUsage.remainingCredits
            : null;

    if (creditsRemaining !== null && creditsRemaining < MIN_FIRECRAWL_CREDITS) {
        return {
            ...emptyBase,
            creditsRemaining,
            creditGuardTriggered: true,
            skippedCount: 1,
            results: [
                {
                    slug: '-',
                    xHandle: '-',
                    status: 'skipped',
                    postsFound: 0,
                    postsUpserted: 0,
                    error: `Firecrawl credits too low (${creditsRemaining}). Scraping paused to avoid wasted calls.`,
                },
            ],
        };
    }

    // Never request more scrapes than remaining credits (1 credit ≈ 1 profile scrape).
    const creditCappedLimit =
        creditsRemaining !== null
            ? Math.max(0, Math.min(limit, creditsRemaining - 1))
            : limit;

    if (creditCappedLimit <= 0) {
        return {
            ...emptyBase,
            creditsRemaining,
            creditGuardTriggered: true,
            skippedCount: 1,
            results: [
                {
                    slug: '-',
                    xHandle: '-',
                    status: 'skipped',
                    postsFound: 0,
                    postsUpserted: 0,
                    error: 'Not enough Firecrawl credits to scrape safely.',
                },
            ],
        };
    }

    const filter: Record<string, unknown> = { isActive: true };
    if (options.slugs?.length) {
        filter.slug = { $in: options.slugs.map((s) => s.toLowerCase()) };
    }

    const candidates = await Politician.find(filter).lean();
    const politicians = (candidates as any[])
        .filter((p) => {
            if (force) return true;
            // Skip fresh successes — don't re-burn credits every cron tick.
            if (isFreshSuccess(p)) return false;
            // Don't keep hammering profiles that already failed for no-credits.
            if (
                p.lastScrapeStatus === 'error' &&
                isNonRetriableCreditError(p.lastScrapeError)
            ) {
                return false;
            }
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
        .slice(0, creditCappedLimit);

    const results: PoliticianScrapeSummary[] = [];
    let creditGuardTriggered = false;

    for (const politician of politicians) {
        try {
            const result = await scrapeAndScorePolitician(politician);
            results.push(result);
        } catch (error: any) {
            if (isFirecrawlCreditError(error)) {
                creditGuardTriggered = true;
                results.push({
                    slug: politician.slug,
                    xHandle: politician.xHandle,
                    status: 'error',
                    postsFound: 0,
                    postsUpserted: 0,
                    error: error?.message || 'Firecrawl credits exhausted',
                });
                // Abort remaining profiles — do not spend more failed calls.
                const done = new Set(results.map((r) => r.slug));
                for (const remaining of politicians) {
                    if (done.has(remaining.slug)) continue;
                    results.push({
                        slug: remaining.slug,
                        xHandle: remaining.xHandle,
                        status: 'skipped',
                        postsFound: 0,
                        postsUpserted: 0,
                        error: 'Skipped: Firecrawl credits exhausted mid-batch',
                    });
                }
                break;
            }
            throw error;
        }
    }

    return {
        ranAt: new Date().toISOString(),
        firecrawlConfigured: true,
        llmConfigured,
        creditsRemaining,
        creditGuardTriggered,
        processed: results.length,
        successCount: results.filter((r) => r.status === 'success').length,
        errorCount: results.filter((r) => r.status === 'error').length,
        skippedCount: results.filter((r) => r.status === 'skipped').length,
        results,
    };
}

export { recomputePoliticianStats };
