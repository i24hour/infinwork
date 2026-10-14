/**
 * Sync portfolio fields from seed for key ministers and rescore every politician's posts.
 * Positive credit is only for assigned department portfolio topics.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
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

const PORTFOLIO_OVERRIDES = {
    'narendra-modi': {
        portfolio: 'Personnel / Atomic Energy / Space',
        portfolioTopics: [
            'personnel', 'public grievances', 'pensions', 'administrative reforms',
            'department of personnel', 'dopt', 'lokpal', 'cvc',
            'atomic energy', 'nuclear energy', 'nuclear power', 'dae',
            'space programme', 'space program', 'space mission', 'space research',
            'indian space', 'isro', 'department of space', 'satellite launch',
            'satellite', 'gslv', 'pslv',
            'परमाणु', 'अंतरिक्ष', 'कार्मिक', 'पेंशन',
        ],
    },
};

function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isUsableKeyword(keyword) {
    if (!keyword) return false;
    if (/\p{Script=Devanagari}/u.test(keyword)) return keyword.length >= 2;
    return keyword.length >= 3;
}

function keywordMatches(text, keyword) {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!isUsableKeyword(normalizedKeyword)) return false;
    const escaped = normalizedKeyword
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/ /g, '\\s+');
    return new RegExp(
        `(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`,
        'u'
    ).test(text);
}

function countKeywordHits(text, keywords) {
    const seen = new Set();
    const hits = [];
    for (const keyword of keywords) {
        const key = String(keyword || '').trim().toLowerCase();
        if (!key || seen.has(key) || !keywordMatches(text, key)) continue;
        seen.add(key);
        hits.push(key);
    }
    return hits;
}

const CATEGORY_POINTS = {
    on_portfolio: 2,
    related: 0,
    off_topic: -1,
    attack: -2,
    personal: -1,
    unknown: 0,
};

const RELATED_KEYWORDS = [
    'policy', 'scheme', 'yojana', 'budget', 'parliament', 'lok sabha', 'rajya sabha',
    'cabinet', 'ministry', 'development', 'infrastructure', 'governance', 'reform',
    'citizen', 'public service', 'implementation', 'notification', 'bill', 'act',
    'vikas', 'sarkar', 'mantralaya', 'sansad', 'karyakram',
    'make in india', 'cabinet', 'agreement', 'msme', 'farmers', 'farmer',
    'सरकार', 'मंजूरी', 'विकास', 'किसान', 'योजना', 'इंफ्रास्ट्रक्चर', 'कनेक्टिविटी',
];

const ATTACK_KEYWORDS = [
    'corrupt', 'corruption', 'liar', 'shame', 'exposed', 'scandal', 'scam',
    'hypocrite', 'failed', 'destroying', 'anti-national', 'jungleraj',
    'chor', 'jhutha', 'nakli', 'fail', 'blast', 'attack on',
];

const PERSONAL_KEYWORDS = [
    'birthday', 'wedding', 'family', 'wishing', 'congratulations', 'festival',
    'diwali', 'holi', 'eid', 'christmas', 'new year', 'good morning',
    'selfie', 'vacation', 'my son', 'my daughter', 'blessed',
    'janamdin', 'shubhkamnaye', 'badhai',
];

const OFF_TOPIC_KEYWORDS = [
    'movie', 'cricket', 'ipl', 'bollywood', 'viral', 'meme', 'football',
    'entertainment', 'song', 'trending reel', 'celebrity',
];

function classifyPost(text, portfolioTopics = []) {
    const normalized = normalizeText(text);

    if (!normalized || normalized.length < 12) {
        return {
            category: 'unknown',
            score: CATEGORY_POINTS.unknown,
            scoreReason: 'Post too short or empty to classify',
        };
    }

    const topicHits = countKeywordHits(normalized, portfolioTopics);
    const relatedHits = countKeywordHits(normalized, RELATED_KEYWORDS);
    const attackHits = countKeywordHits(normalized, ATTACK_KEYWORDS);
    const personalHits = countKeywordHits(normalized, PERSONAL_KEYWORDS);
    const offTopicHits = countKeywordHits(normalized, OFF_TOPIC_KEYWORDS);

    if (topicHits.length >= 1) {
        return {
            category: 'on_portfolio',
            score: CATEGORY_POINTS.on_portfolio,
            scoreReason: `Matched portfolio topics: ${topicHits.slice(0, 4).join(', ')}`,
        };
    }

    if (attackHits.length >= 1 && relatedHits.length === 0) {
        return {
            category: 'attack',
            score: CATEGORY_POINTS.attack,
            scoreReason: `Attack/rhetoric signals: ${attackHits.slice(0, 3).join(', ')}`,
        };
    }

    if (personalHits.length >= 1 && relatedHits.length === 0) {
        return {
            category: 'personal',
            score: CATEGORY_POINTS.personal,
            scoreReason: `Personal/greeting signals: ${personalHits.slice(0, 3).join(', ')}`,
        };
    }

    if (offTopicHits.length >= 1 && relatedHits.length === 0) {
        return {
            category: 'off_topic',
            score: CATEGORY_POINTS.off_topic,
            scoreReason: `Off-topic signals: ${offTopicHits.slice(0, 3).join(', ')}`,
        };
    }

    if (relatedHits.length >= 1) {
        return {
            category: 'related',
            score: CATEGORY_POINTS.related,
            scoreReason: `Political/governance but not assigned portfolio: ${relatedHits.slice(0, 3).join(', ')}`,
        };
    }

    return {
        category: 'unknown',
        score: CATEGORY_POINTS.unknown,
        scoreReason: 'No clear portfolio or noise signals',
    };
}

function aggregatePoliticianStats(posts) {
    const stats = {
        netScore: 0,
        onPortfolioPct: 0,
        postCount: posts.length,
        scoredPostCount: 0,
        onPortfolioCount: 0,
        relatedCount: 0,
        offTopicCount: 0,
        attackCount: 0,
        personalCount: 0,
        unknownCount: 0,
        lastScoredAt: new Date(),
    };

    for (const post of posts) {
        stats.netScore += post.score;

        switch (post.category) {
            case 'on_portfolio':
                stats.onPortfolioCount++;
                stats.scoredPostCount++;
                break;
            case 'related':
                stats.relatedCount++;
                stats.scoredPostCount++;
                break;
            case 'off_topic':
                stats.offTopicCount++;
                stats.scoredPostCount++;
                break;
            case 'attack':
                stats.attackCount++;
                stats.scoredPostCount++;
                break;
            case 'personal':
                stats.personalCount++;
                stats.scoredPostCount++;
                break;
            default:
                stats.unknownCount++;
                break;
        }
    }

    const classifiedForPct =
        stats.onPortfolioCount +
        stats.relatedCount +
        stats.offTopicCount +
        stats.attackCount +
        stats.personalCount;

    stats.onPortfolioPct =
        classifiedForPct > 0
            ? Math.round((stats.onPortfolioCount / classifiedForPct) * 1000) / 10
            : 0;

    stats.netScore = Math.round(stats.netScore * 100) / 100;
    return stats;
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');

    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const politicians = db.collection('politicians');
    const posts = db.collection('politicianposts');

    for (const [slug, update] of Object.entries(PORTFOLIO_OVERRIDES)) {
        const topics = update.portfolioTopics.map((t) => t.toLowerCase());
        await politicians.updateOne(
            { slug },
            {
                $set: {
                    portfolio: update.portfolio,
                    portfolioTopics: topics,
                    updatedAt: new Date(),
                },
            }
        );
        console.log(`Updated portfolio for ${slug}: ${update.portfolio}`);
    }

    const allPoliticians = await politicians.find({ isActive: { $ne: false } }).toArray();
    console.log(`Rescoring ${allPoliticians.length} politicians...`);

    for (const politician of allPoliticians) {
        const topics = (politician.portfolioTopics || []).map((t) => String(t).toLowerCase());
        const politicianPosts = await posts.find({ politicianId: politician._id }).toArray();

        const classifiedRows = [];
        for (const post of politicianPosts) {
            const classified = classifyPost(post.text || '', topics);
            await posts.updateOne(
                { _id: post._id },
                {
                    $set: {
                        category: classified.category,
                        score: classified.score,
                        scoreReason: classified.scoreReason,
                        updatedAt: new Date(),
                    },
                }
            );
            classifiedRows.push(classified);
        }

        const stats = aggregatePoliticianStats(classifiedRows);
        await politicians.updateOne(
            { _id: politician._id },
            { $set: { stats, updatedAt: new Date() } }
        );

        console.log(
            `${politician.slug}: posts=${stats.postCount} on=${stats.onPortfolioPct}% net=${stats.netScore}`
        );
    }

    await mongoose.disconnect();
    console.log('Done.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
