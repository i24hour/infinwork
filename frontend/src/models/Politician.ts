import mongoose from 'mongoose';

export type PoliticianScrapeStatus = 'never' | 'success' | 'error' | 'partial';

export interface IPoliticianStats {
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
    lastScoredAt?: Date;
}

export interface IPolitician {
    _id?: string;
    name: string;
    slug: string;
    party: string;
    state?: string;
    portfolio: string;
    portfolioTopics: string[];
    xHandle: string;
    xProfileUrl: string;
    avatarUrl?: string;
    isActive: boolean;
    lastScrapedAt?: Date;
    lastScrapeStatus: PoliticianScrapeStatus;
    lastScrapeError?: string;
    /** Number of posts upserted by the most recent scrape attempt. */
    lastScrapePostCount?: number;
    /** Provider used by the most recent successful attempt (admin/debug only). */
    lastScrapeProvider?: string;
    stats: IPoliticianStats;
    createdAt?: Date;
    updatedAt?: Date;
}

const PoliticianStatsSchema = new mongoose.Schema<IPoliticianStats>(
    {
        netScore: { type: Number, default: 0 },
        onPortfolioPct: { type: Number, default: 0 },
        postCount: { type: Number, default: 0 },
        scoredPostCount: { type: Number, default: 0 },
        onPortfolioCount: { type: Number, default: 0 },
        relatedCount: { type: Number, default: 0 },
        offTopicCount: { type: Number, default: 0 },
        attackCount: { type: Number, default: 0 },
        personalCount: { type: Number, default: 0 },
        unknownCount: { type: Number, default: 0 },
        lastScoredAt: { type: Date },
    },
    { _id: false }
);

const PoliticianSchema = new mongoose.Schema<IPolitician>(
    {
        name: { type: String, required: true, trim: true },
        slug: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
            trim: true,
        },
        party: { type: String, required: true, trim: true, index: true },
        state: { type: String, trim: true },
        portfolio: { type: String, required: true, trim: true },
        portfolioTopics: [{ type: String, trim: true, lowercase: true }],
        xHandle: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        xProfileUrl: { type: String, required: true, trim: true },
        avatarUrl: { type: String, trim: true },
        isActive: { type: Boolean, default: true, index: true },
        lastScrapedAt: { type: Date },
        lastScrapeStatus: {
            type: String,
            enum: ['never', 'success', 'error', 'partial'],
            default: 'never',
        },
        lastScrapeError: { type: String },
        lastScrapePostCount: { type: Number, default: 0 },
        lastScrapeProvider: { type: String },
        stats: {
            type: PoliticianStatsSchema,
            default: () => ({
                netScore: 0,
                onPortfolioPct: 0,
                postCount: 0,
                scoredPostCount: 0,
                onPortfolioCount: 0,
                relatedCount: 0,
                offTopicCount: 0,
                attackCount: 0,
                personalCount: 0,
                unknownCount: 0,
            }),
        },
    },
    { timestamps: true }
);

PoliticianSchema.index({ 'stats.onPortfolioPct': -1, 'stats.netScore': -1 });
PoliticianSchema.index({ 'stats.netScore': -1 });

const Politician =
    mongoose.models.Politician || mongoose.model<IPolitician>('Politician', PoliticianSchema);

export default Politician;
