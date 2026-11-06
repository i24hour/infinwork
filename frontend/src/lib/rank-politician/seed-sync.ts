import connectDB from '@/lib/mongodb';
import Politician from '@/models/Politician';
import PoliticianPost from '@/models/PoliticianPost';
import {
    POLITICIAN_SEEDS,
    STATE_MINISTER_COUNT,
    UNION_CABINET_MINISTER_COUNT,
    toPoliticianDocument,
} from '@/lib/rank-politician/seed';
import { recomputePoliticianStats } from '@/lib/rank-politician/pipeline';

export interface PoliticianSeedSyncResult {
    seeded: number;
    inserted: number;
    updated: number;
    handleResets: number;
    deactivated: number;
    totalActive: number;
    totalInactive: number;
    unionCabinetTarget: number;
    stateMinisterTarget: number;
    withXHandle: number;
    withoutXHandle: number;
}

/**
 * Keep the DB in sync with the Union Cabinet + state council seed lists.
 *
 * The cron calls this so corrected X handles and newly added ministers are
 * applied automatically on deploy. A changed handle resets the profile to
 * "never" (or "unavailable" if the handle was removed) and deletes posts
 * scraped from the old account. This lets the same cron run re-scrape it with
 * the correct handle.
 */
export async function syncPoliticianSeeds(
    options: { recomputeAllStats?: boolean } = {}
): Promise<PoliticianSeedSyncResult> {
    await connectDB();

    // xHandle is optional for ministers without a public X account, so the
    // unique index must be sparse. syncIndexes migrates older deployments.
    await Politician.syncIndexes();

    const existing = (await Politician.find({})
        .select('slug xHandle stats.postCount')
        .lean()) as Array<{
        _id: unknown;
        slug: string;
        xHandle?: string;
        stats?: { postCount?: number };
    }>;
    const existingBySlug = new Map(existing.map((politician) => [politician.slug, politician]));

    const activeSlugs = POLITICIAN_SEEDS.map((seed) => seed.slug);
    let handleResets = 0;
    let withXHandle = 0;
    let withoutXHandle = 0;
    const resetPoliticianIds: unknown[] = [];
    const bulkOps: Parameters<typeof Politician.bulkWrite>[0] = [];

    for (const seed of POLITICIAN_SEEDS) {
        const doc = toPoliticianDocument(seed);
        const previous = existingBySlug.get(doc.slug);
        const previousHandle = String(previous?.xHandle || '').toLowerCase();
        const nextHandle = String(doc.xHandle || '').toLowerCase();
        const handleChanged = Boolean(previous) && previousHandle !== nextHandle;

        if (doc.xHandle) withXHandle++;
        else withoutXHandle++;

        if (handleChanged && previous?._id) {
            resetPoliticianIds.push(previous._id);
            handleResets++;
        }

        const update: Record<string, any> = {
            $set: {
                name: doc.name,
                party: doc.party,
                state: doc.state,
                level: doc.level,
                office: doc.office,
                portfolio: doc.portfolio,
                portfolioTopics: doc.portfolioTopics,
                xProfileUrl: doc.xProfileUrl || '',
                isActive: true,
            },
        };

        if (doc.avatarUrl) {
            update.$set.avatarUrl = doc.avatarUrl;
        }

        if (doc.xHandle) {
            update.$set.xHandle = doc.xHandle;
        } else {
            update.$unset = { xHandle: 1 };
        }

        if (!previous) {
            update.$setOnInsert = {
                lastScrapeStatus: doc.lastScrapeStatus,
                lastScrapeError: doc.lastScrapeError,
                stats: doc.stats,
            };
        } else if (handleChanged) {
            update.$set.lastScrapeStatus = doc.lastScrapeStatus;
            update.$set.lastScrapeError = doc.lastScrapeError;
            update.$set.lastScrapedAt = null;
            update.$set.lastScrapePostCount = 0;
            update.$set.lastScrapeProvider = null;
            update.$set.stats = doc.stats;
        } else if (!doc.xHandle && previous) {
            // A pre-existing no-handle row should not be advertised as
            // "not scraped" — it has no X account to scrape.
            update.$set.lastScrapeStatus = 'unavailable';
            update.$set.lastScrapeError = 'No public X handle on record';
            update.$set.lastScrapePostCount = 0;
        }

        bulkOps.push({
            updateOne: {
                filter: { slug: doc.slug },
                update,
                upsert: true,
            },
        });
    }

    if (resetPoliticianIds.length > 0) {
        await PoliticianPost.deleteMany({ politicianId: { $in: resetPoliticianIds } });
    }

    const bulkResult = await Politician.bulkWrite(bulkOps, { ordered: false });

    if (options.recomputeAllStats) {
        const handled = (await Politician.find({
            $or: [{ xHandle: { $exists: true, $nin: [null, ''] } }, { 'stats.postCount': { $gt: 0 } }],
        })
            .select('_id')
            .lean()) as Array<{ _id: unknown }>;
        for (const politician of handled) {
            await recomputePoliticianStats(String(politician._id));
        }
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
        seeded: POLITICIAN_SEEDS.length,
        inserted: bulkResult.upsertedCount,
        updated: bulkResult.modifiedCount,
        handleResets,
        deactivated: deactivateResult.modifiedCount,
        totalActive,
        totalInactive,
        unionCabinetTarget: UNION_CABINET_MINISTER_COUNT,
        stateMinisterTarget: STATE_MINISTER_COUNT,
        withXHandle,
        withoutXHandle,
    };
}
