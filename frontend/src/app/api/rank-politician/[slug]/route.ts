import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Politician from '@/models/Politician';
import PoliticianPost from '@/models/PoliticianPost';
import { RANK_POLITICIAN_SCORE_WINDOW_DAYS } from '@/lib/rank-politician/score';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    try {
        await connectDB();
        const { slug } = await params;

        const politician = await Politician.findOne({
            slug: slug.toLowerCase(),
            isActive: true,
        }).lean() as any;

        if (!politician) {
            return NextResponse.json({ error: 'Politician not found' }, { status: 404 });
        }

        // Only real status posts in the same rolling window used by the
        // stats. Legacy Google News headlines and profile-shell blocks are not
        // authored posts and must not be displayed as if they were. Filter in
        // the query so the 100-row limit isn't consumed by unverifiable rows.
        const windowStart = new Date(
            Date.now() - RANK_POLITICIAN_SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000
        );
        const posts = await PoliticianPost.find({
            politicianId: politician._id,
            postUrl: {
                $regex: '(?:x\\.com|twitter\\.com)\\/[^/]+\\/status\\/\\d+',
                $options: 'i',
            },
            $or: [
                { postedAt: { $gte: windowStart } },
                { postedAt: { $exists: false }, createdAt: { $gte: windowStart } },
                { postedAt: null, createdAt: { $gte: windowStart } },
            ],
        })
            .sort({ postedAt: -1, createdAt: -1 })
            .limit(100)
            .lean();

        return NextResponse.json({
            politician: {
                id: String(politician._id),
                name: politician.name,
                slug: politician.slug,
                party: politician.party,
                state: politician.state || null,
                portfolio: politician.portfolio,
                portfolioTopics: politician.portfolioTopics || [],
                xHandle: politician.xHandle,
                xProfileUrl: politician.xProfileUrl,
                avatarUrl: politician.avatarUrl || null,
                lastScrapedAt: politician.lastScrapedAt || null,
                lastScrapeStatus: politician.lastScrapeStatus || 'never',
                lastScrapeError: politician.lastScrapeError || null,
                lastScrapePostCount:
                    typeof politician.lastScrapePostCount === 'number'
                        ? politician.lastScrapePostCount
                        : null,
                lastScrapeProvider: politician.lastScrapeProvider || null,
                windowDays: RANK_POLITICIAN_SCORE_WINDOW_DAYS,
                stats: {
                    netScore: Number(politician.stats?.netScore ?? 0),
                    onPortfolioPct: Number(politician.stats?.onPortfolioPct ?? 0),
                    postCount: Number(politician.stats?.postCount ?? 0),
                    scoredPostCount: Number(politician.stats?.scoredPostCount ?? 0),
                },
            },
            posts: posts.map((post: any) => ({
                id: String(post._id),
                externalId: post.externalId,
                text: post.text,
                postedAt: post.postedAt || null,
                postUrl: post.postUrl || null,
                category: post.category,
                score: post.score,
                scoreReason: post.scoreReason || null,
                scoredBy: post.scoredBy || null,
                scoredAt: post.scoredAt || null,
            })),
        });
    } catch (error: any) {
        console.error('Error fetching politician detail:', error);
        return NextResponse.json(
            { error: 'Failed to fetch politician' },
            { status: 500 }
        );
    }
}
