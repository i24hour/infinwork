/**
 * Sync Mongo to cabinet-only seed: activate 30 cabinet ministers, deactivate the rest.
 *
 *   cd frontend && npx tsx scripts/sync-cabinet-only.ts
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import {
    CABINET_MINISTER_COUNT,
    POLITICIAN_SEEDS,
    toPoliticianDocument,
} from '../src/lib/rank-politician/seed';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path: string) {
    try {
        const text = readFileSync(path, 'utf8');
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq < 0) continue;
            const key = trimmed.slice(0, eq).trim();
            let value = trimmed.slice(eq + 1).trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }
            if (!process.env[key]) process.env[key] = value;
        }
    } catch {
        // optional
    }
}

loadEnv(resolve(__dirname, '../../.env.local'));
loadEnv(resolve(__dirname, '../.env.local'));
loadEnv(resolve(__dirname, '../../.vercel/.env.production.local'));

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');

    await mongoose.connect(process.env.MONGODB_URI);
    const politicians = mongoose.connection.collection('politicians');
    const activeSlugs = POLITICIAN_SEEDS.map((s) => s.slug);

    let upserted = 0;
    for (const seed of POLITICIAN_SEEDS) {
        const doc = toPoliticianDocument(seed);
        await politicians.updateOne(
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
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    lastScrapeStatus: 'never',
                    stats: doc.stats,
                    createdAt: new Date(),
                },
            },
            { upsert: true }
        );
        upserted++;
        console.log(`active: ${doc.slug} — ${doc.portfolio}`);
    }

    const deactivate = await politicians.updateMany(
        { slug: { $nin: activeSlugs } },
        { $set: { isActive: false, updatedAt: new Date() } }
    );

    const totalActive = await politicians.countDocuments({ isActive: true });
    const totalInactive = await politicians.countDocuments({ isActive: false });

    console.log(
        JSON.stringify(
            {
                cabinetTarget: CABINET_MINISTER_COUNT,
                upserted,
                deactivated: deactivate.modifiedCount,
                totalActive,
                totalInactive,
            },
            null,
            2
        )
    );

    await mongoose.disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
