import connectDB from '@/lib/mongodb';
import Politician from '@/models/Politician';
import PoliticianPost from '@/models/PoliticianPost';
import { POLITICIAN_SEEDS, toPoliticianDocument } from '@/lib/rank-politician/seed';
import { recomputePoliticianStats } from '@/lib/rank-politician/pipeline';

export interface PoliticianSeedSyncResult {
    seeded: number;
    handleResets: number;
    deactivated: number;
    totalActive: number;
    totalInactive: number;
}

/**
 * Keep the DB in sync with the cabinet seed list.
 *
 * The cron calls this so corrected X handles and newly added ministers are
 * applied automatically on deploy. A changed handle resets the profile to
 * "never" and deletes posts scraped from the old account, which makes the same
 * cron run re-scrape it with the correct handle.
 */
export async function syncPoliticianSeeds(
    options: { recomputeAllStats?: boolean } = {}
): Promise<PoliticianSeedSyncResult> {
    await connectDB();

    let seeded = 0;
    let handleResets = 0;
    const activeSlugs = POLITICIAN_SEEDS.map((seed) => seed.slug);

    for (const seed of POLITICIAN_SEEDS) {
        const doc = toPoliticianDocument(seed);
        const existing = await Politician.findOne({ slug: doc.slug }).lean() as any;
        const isNew = !existing;
        const handleChanged = Boolean(
            existing?.xHandle &&
            existing.xHandle.toLowerCase() !== doc.xHandle.toLowerCase()
        );

        if (handleChanged) {
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

        if (saved && (handleChanged || isNew || options.recomputeAllStats)) {
            await recomputePoliticianStats(String(saved._id));
        }

        seeded++;
        if (handleChanged) handleResets++;
    }

    const deactivateResult = await Politician.updateMany(
        { slug: { $nin: activeSlugs } },
        { $set: { isActive: false } }
    );
    const [totalActive, totalInactive] = await Promise.all([
        Politician.countDocuments({ isActive: true }),
        Politician.countDocuments({ isActive: false }),
    ]);

    return {
        seeded,
        handleResets,
        deactivated: deactivateResult.modifiedCount,
        totalActive,
        totalInactive,
    };
}
