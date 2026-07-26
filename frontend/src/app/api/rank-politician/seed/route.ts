import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin';
import connectDB from '@/lib/mongodb';
import Politician from '@/models/Politician';
import {
    CABINET_MINISTER_COUNT,
    POLITICIAN_SEEDS,
    toPoliticianDocument,
} from '@/lib/rank-politician/seed';

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
            await Politician.findOneAndUpdate(
                { slug: doc.slug },
                {
                    $set: {
                        name: doc.name,
                        party: doc.party,
                        state: doc.state,
                        portfolio: doc.portfolio,
                        portfolioTopics: doc.portfolioTopics,
                        xHandle: doc.xHandle,
                        xProfileUrl: doc.xProfileUrl,
                        isActive: true,
                    },
                    $setOnInsert: {
                        lastScrapeStatus: 'never',
                        stats: doc.stats,
                    },
                },
                { upsert: true, new: true }
            );
            upserted++;
            results.push({ slug: doc.slug, status: 'upserted' });
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
