export type PostCategory =
    | 'on_portfolio'
    | 'related'
    | 'off_topic'
    | 'attack'
    | 'personal'
    | 'unknown';

/**
 * Positive credit only for the politician's assigned department portfolio.
 * Role titles (PM, CM, party leader) do not expand scoring — only listed departments.
 * Generic politics/governance ("related") gets 0 points so it never boosts rank.
 */
export const CATEGORY_POINTS: Record<PostCategory, number> = {
    on_portfolio: 2,
    related: 0,
    off_topic: -1,
    attack: -2,
    personal: -1,
    unknown: 0,
};

export interface ClassifiedPost {
    category: PostCategory;
    score: number;
    scoreReason: string;
}

export interface AggregateStatsInput {
    category: PostCategory;
    score: number;
}

export interface PoliticianAggregateStats {
    netScore: number;
    onPortfolioPct: number;
    postCount: number;
    scoredPostCount: number;
    onPortfolioCount: number;
    relatedCount: number;
    offTopicCount: number;
    attackCount: number;
    personalCount: number;
    unknownCount: number;
}

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

function normalizeText(text: string): string {
    return text
        .toLowerCase()
        // Keep letters + combining marks (needed for Hindi matras) + numbers.
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isUsableKeyword(keyword: string): boolean {
    if (!keyword) return false;
    // Hindi words are often two characters ("जल"). Latin tokens shorter than
    // three letters ("it", "sc", "st") sit inside ordinary English words.
    if (/\p{Script=Devanagari}/u.test(keyword)) return keyword.length >= 2;
    return keyword.length >= 3;
}

function keywordMatches(text: string, keyword: string): boolean {
    const normalizedKeyword = keyword.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!isUsableKeyword(normalizedKeyword)) return false;
    const escaped = normalizedKeyword
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/ /g, '\\s+');
    return new RegExp(
        `(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`,
        'u'
    ).test(text);
}

function countKeywordHits(text: string, keywords: string[]): string[] {
    const seen = new Set<string>();
    const hits: string[] = [];
    for (const keyword of keywords) {
        const key = String(keyword || '').trim().toLowerCase();
        if (!key || seen.has(key) || !keywordMatches(text, key)) continue;
        seen.add(key);
        hits.push(key);
    }
    return hits;
}

export function classifyPost(text: string, portfolioTopics: string[] = []): ClassifiedPost {
    const normalized = normalizeText(text || '');

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

export function aggregatePoliticianStats(posts: AggregateStatsInput[]): PoliticianAggregateStats {
    const stats: PoliticianAggregateStats = {
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

export function sortPoliticiansForLeaderboard<
    T extends { stats?: { onPortfolioPct?: number; netScore?: number; postCount?: number } }
>(
    politicians: T[],
    sortBy: 'onPortfolioPct' | 'netScore' = 'netScore'
): T[] {
    return [...politicians].sort((a, b) => {
        const aPct = a.stats?.onPortfolioPct ?? 0;
        const bPct = b.stats?.onPortfolioPct ?? 0;
        const aNet = a.stats?.netScore ?? 0;
        const bNet = b.stats?.netScore ?? 0;
        const aPosts = a.stats?.postCount ?? 0;
        const bPosts = b.stats?.postCount ?? 0;

        if (sortBy === 'netScore') {
            if (bNet !== aNet) return bNet - aNet;
            if (bPct !== aPct) return bPct - aPct;
            return bPosts - aPosts;
        }

        if (bPct !== aPct) return bPct - aPct;
        if (bNet !== aNet) return bNet - aNet;
        return bPosts - aPosts;
    });
}
