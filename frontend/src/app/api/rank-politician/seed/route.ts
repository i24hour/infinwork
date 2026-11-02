import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin';
import connectDB from '@/lib/mongodb';
import Politician from '@/models/Politician';
import PoliticianPost from '@/models/PoliticianPost';
import {
    CABINET_MINISTER_COUNT,
    POLITICIAN_SEEDS,
    toPoliticianDocument,
} from '@/lib/rank-politician/seed';
import { recomputePoliticianStats } from '@/lib/rank-politician/pipeline';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const admin = await requireAdminSession();
        if (!admin.ok) {
            return NextResponse.json({ error: admin.error }, { status: admin.status });
        }

        await connectDB();

        let upserted = 0;
        const results: Array<{ slug: string; status: string }> = [];
        const activeSlugs = POLITICIAN_SEEDS.map((s) => s.slug);

        for (const seed of POLITICIAN_SEEDS) {
            const doc = toPoliticianDocument(seed);
            const existing = await Politician.findOne({ slug: doc.slug }).lean() as any;
            const handleChanged = Boolean(
                existing?.xHandle &&
                existing.xHandle.toLowerCase() !== doc.xHandle.toLowerCase()
            );

            if (handleChanged) {
                // Posts scraped from the old (wrong) handle belong to a
                // different account. Delete them rather than mixing spam or
                // unrelated content into the minister's score.
                await PoliticianPost.deleteMany({ politicianId: existing._id });
            }

            const update: Record<string, any> = {
                $set: {
                    name: doc.name,
                    party: doc.party,
                    state: doc.state,
                    portfolio: doc.portfolio,
                    portfolioTopics: doc.portfolioTopics,
                    xHandle: doc.xHandle,
                    xProfileUrl: doc.xProfileUrl,
                    isActive: true,
                    ...(handleChanged
                        ? {
                            lastScrapeStatus: 'never',
                            lastScrapedAt: null,
                            lastScrapeError: null,
                            stats: doc.stats,
                        }
                        : {}),
                },
                ...(handleChanged
                    ? {}
                    : {
                        $setOnInsert: {
                            lastScrapeStatus: 'never',
                            stats: doc.stats,
                        },
                    }),
            };

            const saved = await Politician.findOneAndUpdate(
                { slug: doc.slug },
                update,
                { upsert: true, new: true }
            );
            // Recompute from real status posts so old news/profile-shell rows
            // stop inflating the leaderboard immediately.
            if (saved) {
                await recomputePoliticianStats(String(saved._id));
            }
            upserted++;
            results.push({
                slug: doc.slug,
                status: handleChanged ? 'updated-handle-reset' : 'seeded',
            });
        }

        // Rank Politician is cabinet-only for now — deactivate everyone else.
        const deactivateResult = await Politician.updateMany(
            { slug: { $nin: activeSlugs } },
            { $set: { isActive: false } }
        );

        const totalActive = await Politician.countDocuments({ isActive: true });
        const totalInactive = await Politician.countDocuments({ isActive: false });

        return NextResponse.json({
            message: `Seeded ${upserted} cabinet ministers; deactivated ${deactivateResult.modifiedCount} non-cabinet profiles`,
            upserted,
            deactivated: deactivateResult.modifiedCount,
            cabinetTarget: CABINET_MINISTER_COUNT,
            totalActive,
            totalInactive,
            results,
        });
    } catch (error: any) {
        console.error('Error seeding politicians:', error);
        return NextResponse.json(
            { error: error?.message || 'Failed to seed politicians' },
            { status: 500 }
        );
    }
}
