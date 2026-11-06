import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Politician from '@/models/Politician';
import {
    RANK_POLITICIAN_SCORE_WINDOW_DAYS,
    sortPoliticiansForLeaderboard,
} from '@/lib/rank-politician/score';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        await connectDB();

        const { searchParams } = new URL(request.url);
        const party = searchParams.get('party')?.trim();
        const q = searchParams.get('q')?.trim();
        const levelParam = searchParams.get('level')?.trim()?.toLowerCase();
        const stateParam = searchParams.get('state')?.trim();
        const scrapeStatus = searchParams.get('scrapeStatus')?.trim()?.toLowerCase();
        const sortByParam = searchParams.get('sortBy');
        const sortBy = sortByParam === 'netScore' ? 'netScore' : 'onPortfolioPct';

        const filter: Record<string, unknown> = { isActive: true };
        if (levelParam === 'union' || levelParam === 'state') {
            filter.level = levelParam;
        }
        if (stateParam && stateParam.toLowerCase() !== 'all') {
            const escaped = stateParam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.state = new RegExp(`^${escaped}$`, 'i');
        }
        if (party && party.toLowerCase() !== 'all') {
            filter.party = new RegExp(`^${party.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        }
        if (
            scrapeStatus &&
            scrapeStatus !== 'all' &&
            ['never', 'success', 'error', 'partial', 'unavailable'].includes(scrapeStatus)
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
                { office: { $regex: escaped, $options: 'i' } },
                { xHandle: { $regex: escaped, $options: 'i' } },
                { state: { $regex: escaped, $options: 'i' } },
            ];
        }

        const politicians = await Politician.find(filter).lean();
        const sorted = sortPoliticiansForLeaderboard(politicians as any[], sortBy);

        const parties = await Politician.distinct('party', { isActive: true });
        const states = await Politician.distinct('state', { isActive: true });
        const allActive = await Politician.find({ isActive: true })
            .select('level xHandle lastScrapeStatus stats.netScore stats.postCount stats.onPortfolioPct')
            .lean();

        // Rank globally, before party/search/status filters, so a search result
        // shows the politician's real position instead of "#1" in its own slice.
        // Profiles with no scored posts in the window are unranked.
        const globallySorted = sortPoliticiansForLeaderboard(allActive as any[], sortBy);
        const rankById = new Map<string, number>();
        let rankedIndex = 0;
        for (const politician of globallySorted as any[]) {
            if ((politician.stats?.postCount || 0) > 0) {
                rankById.set(String(politician._id), ++rankedIndex);
            }
        }

        const withPosts = allActive.filter((p: any) => (p.stats?.postCount || 0) > 0).length;
        const scrapeSuccess = allActive.filter((p: any) => p.lastScrapeStatus === 'success').length;
        const scrapeError = allActive.filter((p: any) => p.lastScrapeStatus === 'error').length;
        const scrapePartial = allActive.filter((p: any) => p.lastScrapeStatus === 'partial').length;
        const scrapeUnavailable = allActive.filter(
            (p: any) => p.lastScrapeStatus === 'unavailable'
        ).length;
        const neverScraped = allActive.filter(
            (p: any) => !p.lastScrapeStatus || p.lastScrapeStatus === 'never'
        ).length;
        const withXHandle = allActive.filter((p: any) => Boolean(p.xHandle)).length;
        const unionActive = allActive.filter((p: any) => (p.level || 'union') === 'union').length;
        const stateActive = allActive.filter((p: any) => p.level === 'state').length;
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
                level: p.level || 'union',
                office: p.office || null,
                portfolio: p.portfolio,
                xHandle: p.xHandle || null,
                xProfileUrl: p.xProfileUrl || null,
                avatarUrl: p.avatarUrl || null,
                lastScrapedAt: p.lastScrapedAt || null,
                lastScrapeStatus: p.lastScrapeStatus || 'never',
                lastScrapeError: p.lastScrapeError || null,
                lastScrapePostCount:
                    typeof p.lastScrapePostCount === 'number' ? p.lastScrapePostCount : null,
                lastScrapeProvider: p.lastScrapeProvider || null,
                stats: {
                    netScore: Number(p.stats?.netScore ?? 0),
                    onPortfolioPct: Number(p.stats?.onPortfolioPct ?? 0),
                    postCount: Number(p.stats?.postCount ?? 0),
                    scoredPostCount: Number(p.stats?.scoredPostCount ?? 0),
                },
                rank: rankById.get(String(p._id)) ?? null,
            })),
            total: sorted.length,
            parties: (parties as string[]).sort((a, b) => a.localeCompare(b)),
            states: (states as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b)),
            sortBy,
            meta: {
                totalActive: allActive.length,
                unionActive,
                stateActive,
                withXHandle,
                withPosts,
                scrapeSuccess,
                scrapeError,
                scrapePartial,
                scrapeUnavailable,
                neverScraped,
                avgOnPortfolioPct,
                windowDays: RANK_POLITICIAN_SCORE_WINDOW_DAYS,
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
