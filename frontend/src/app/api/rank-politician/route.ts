import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Politician from '@/models/Politician';
import { sortPoliticiansForLeaderboard } from '@/lib/rank-politician/score';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        await connectDB();

        const { searchParams } = new URL(request.url);
        const party = searchParams.get('party')?.trim();
        const q = searchParams.get('q')?.trim();
        const scrapeStatus = searchParams.get('scrapeStatus')?.trim()?.toLowerCase();
        const sortByParam = searchParams.get('sortBy');
        const sortBy = sortByParam === 'onPortfolioPct' ? 'onPortfolioPct' : 'netScore';

        const filter: Record<string, unknown> = { isActive: true };
        if (party && party.toLowerCase() !== 'all') {
            filter.party = new RegExp(`^${party.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        }
        if (
            scrapeStatus &&
            scrapeStatus !== 'all' &&
            ['never', 'success', 'error', 'partial'].includes(scrapeStatus)
        ) {
            // `$in: [..., null]` also matches a missing field, which the UI
            // labels as "Not scraped".
            filter.lastScrapeStatus = scrapeStatus === 'never'
                ? { $in: ['never', null] }
                : scrapeStatus;
        }
        if (q) {
            const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [
                { name: { $regex: escaped, $options: 'i' } },
                { portfolio: { $regex: escaped, $options: 'i' } },
                { xHandle: { $regex: escaped, $options: 'i' } },
                { state: { $regex: escaped, $options: 'i' } },
            ];
        }

        const politicians = await Politician.find(filter).lean();
        const sorted = sortPoliticiansForLeaderboard(politicians as any[], sortBy);

        const parties = await Politician.distinct('party', { isActive: true });
        const allActive = await Politician.find({ isActive: true })
            .select('lastScrapeStatus stats.netScore stats.postCount stats.onPortfolioPct')
            .lean();

        // Rank globally, before party/search/status filters, so a search result
        // shows the politician's real position instead of "#1" in its own slice.
        const globallySorted = sortPoliticiansForLeaderboard(allActive as any[], sortBy);
        const rankById = new Map<string, number>(
            globallySorted.map((politician: any, index: number) => [String(politician._id), index + 1])
        );

        const withPosts = allActive.filter((p: any) => (p.stats?.postCount || 0) > 0).length;
        const scrapeSuccess = allActive.filter((p: any) => p.lastScrapeStatus === 'success').length;
        const scrapeError = allActive.filter((p: any) => p.lastScrapeStatus === 'error').length;
        const scrapePartial = allActive.filter((p: any) => p.lastScrapeStatus === 'partial').length;
        const neverScraped = allActive.filter(
            (p: any) => !p.lastScrapeStatus || p.lastScrapeStatus === 'never'
        ).length;
        const scoredForAvg = allActive.filter((p: any) => (p.stats?.postCount || 0) > 0);
        const avgOnPortfolioPct =
            scoredForAvg.length > 0
                ? Math.round(
                      (scoredForAvg.reduce(
                          (sum: number, p: any) => sum + (p.stats?.onPortfolioPct || 0),
                          0
                      ) /
                          scoredForAvg.length) *
                          10
                  ) / 10
                : 0;

        return NextResponse.json({
            politicians: sorted.map((p: any) => ({
                id: String(p._id),
                name: p.name,
                slug: p.slug,
                party: p.party,
                state: p.state || null,
                portfolio: p.portfolio,
                xHandle: p.xHandle,
                xProfileUrl: p.xProfileUrl,
                avatarUrl: p.avatarUrl || null,
                lastScrapedAt: p.lastScrapedAt || null,
                lastScrapeStatus: p.lastScrapeStatus || 'never',
                lastScrapeError: p.lastScrapeError || null,
                stats: {
                    netScore: Number(p.stats?.netScore ?? 0),
                    onPortfolioPct: Number(p.stats?.onPortfolioPct ?? 0),
                    postCount: Number(p.stats?.postCount ?? 0),
                    scoredPostCount: Number(p.stats?.scoredPostCount ?? 0),
                },
                rank: rankById.get(String(p._id)) ?? 0,
            })),
            total: sorted.length,
            parties: (parties as string[]).sort((a, b) => a.localeCompare(b)),
            sortBy,
            meta: {
                totalActive: allActive.length,
                withPosts,
                scrapeSuccess,
                scrapeError,
                scrapePartial,
                neverScraped,
                avgOnPortfolioPct,
            },
        });
    } catch (error: any) {
        console.error('Error fetching rank-politician leaderboard:', error);
        return NextResponse.json(
            { error: 'Failed to fetch politician rankings' },
            { status: 500 }
        );
    }
}
