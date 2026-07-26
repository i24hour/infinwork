'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import {
    categoryClass,
    categoryLabel,
    formatRelativeTime,
    publicScoreReason,
    publicScrapeError,
    scrapeStatusClass,
    scrapeStatusLabel,
} from '@/lib/rank-politician/ui';

function useIsLightTheme() {
    const [isLightTheme, setIsLightTheme] = useState(false);

    useEffect(() => {
        const root = document.documentElement;
        const syncTheme = () => setIsLightTheme(root.getAttribute('data-theme') === 'light');

        syncTheme();
        const observer = new MutationObserver(syncTheme);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    return isLightTheme;
}

interface PoliticianDetail {
    id: string;
    name: string;
    slug: string;
    party: string;
    state: string | null;
    portfolio: string;
    portfolioTopics: string[];
    xHandle: string;
    xProfileUrl: string;
    avatarUrl: string | null;
    lastScrapeStatus: string;
    lastScrapedAt: string | null;
    lastScrapeError: string | null;
    stats: {
        netScore: number;
        onPortfolioPct: number;
        postCount: number;
        onPortfolioCount?: number;
        relatedCount?: number;
        offTopicCount?: number;
        attackCount?: number;
        personalCount?: number;
        unknownCount?: number;
    };
}

interface ScoredPost {
    id: string;
    text: string;
    postedAt: string | null;
    postUrl: string | null;
    category: string;
    score: number;
    scoreReason: string | null;
}

type CategoryFilter = 'all' | 'on_portfolio' | 'related' | 'off_topic' | 'attack' | 'personal' | 'unknown';

export default function RankPoliticianDetailPage() {
    const params = useParams();
    const slug = typeof params?.slug === 'string' ? params.slug : '';
    const isLightTheme = useIsLightTheme();
    const { data: session, status: authStatus } = useSession();

    const [isAdmin, setIsAdmin] = useState(false);
    const [politician, setPolitician] = useState<PoliticianDetail | null>(null);
    const [posts, setPosts] = useState<ScoredPost[]>([]);
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [scrapeLoading, setScrapeLoading] = useState(false);
    const [actionMessage, setActionMessage] = useState<string | null>(null);

    const fetchDetail = useCallback(async () => {
        if (!slug) return;
        try {
            setError(null);
            const response = await fetch(`/api/rank-politician/${encodeURIComponent(slug)}`);
            if (response.status === 404) throw new Error('Politician not found');
            if (!response.ok) throw new Error('Failed to fetch politician');
            const data = await response.json();
            setPolitician(data.politician);
            setPosts(data.posts || []);
        } catch (err: any) {
            console.error('Error fetching politician detail:', err);
            setError(err.message || 'Error fetching data');
        } finally {
            setLoading(false);
        }
    }, [slug]);

    useEffect(() => {
        setLoading(true);
        fetchDetail();
    }, [fetchDetail]);

    useEffect(() => {
        if (authStatus !== 'authenticated' || !session?.user?.email) {
            setIsAdmin(false);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/user/settings');
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) setIsAdmin(Boolean(data.isAdmin));
            } catch {
                if (!cancelled) setIsAdmin(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [authStatus, session?.user?.email]);

    const filteredPosts = useMemo(() => {
        if (categoryFilter === 'all') return posts;
        return posts.filter((post) => post.category === categoryFilter);
    }, [categoryFilter, posts]);

    const categoryBreakdown = useMemo(() => {
        if (!politician) return [];
        const stats = politician.stats;
        return [
            { key: 'on_portfolio', label: 'On portfolio', count: stats.onPortfolioCount || 0 },
            { key: 'related', label: 'Not portfolio', count: stats.relatedCount || 0 },
            { key: 'off_topic', label: 'Off topic', count: stats.offTopicCount || 0 },
            { key: 'attack', label: 'Attack', count: stats.attackCount || 0 },
            { key: 'personal', label: 'Personal', count: stats.personalCount || 0 },
            { key: 'unknown', label: 'Unknown', count: stats.unknownCount || 0 },
        ];
    }, [politician]);

    const maxCategoryCount = Math.max(1, ...categoryBreakdown.map((item) => item.count));

    const scrapeThisPolitician = async () => {
        if (!politician) return;
        setScrapeLoading(true);
        setActionMessage(null);
        try {
            const response = await fetch('/api/rank-politician/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: 1, slugs: [politician.slug] }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Scrape failed');
            const result = data.results?.[0];
            setActionMessage(
                result
                    ? `${result.status}: ${result.postsUpserted || 0} posts upserted` +
                          (result.error ? ` (${result.error})` : '')
                    : 'Scrape finished'
            );
            await fetchDetail();
        } catch (err: any) {
            setActionMessage(err.message || 'Scrape failed');
        } finally {
            setScrapeLoading(false);
        }
    };

    const muted = isLightTheme ? 'text-zinc-700' : 'text-zinc-400';
    const heading = isLightTheme ? 'text-zinc-900' : 'text-white';
    const panel = 'bg-black border border-white/10 rounded-2xl';

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full">
                <div className="space-y-6 max-w-4xl">
                    <Link href="/rank-politician" className={`text-sm ${muted} hover:text-white transition-colors`}>
                        ← Back to rankings
                    </Link>

                    {loading ? (
                        <div className="flex py-12 items-center justify-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white/50" />
                        </div>
                    ) : error ? (
                        <div className={`${panel} p-8 flex flex-col items-center gap-4`}>
                            <p className="text-white">Couldn&apos;t load this politician.</p>
                            <p className={`text-sm ${muted}`}>{error}</p>
                            <div className="flex gap-3">
                                <LiquidButton onClick={fetchDetail} className="px-4 py-2 text-white">
                                    Retry
                                </LiquidButton>
                                <Link href="/rank-politician">
                                    <LiquidButton className="px-4 py-2 text-white">Back to list</LiquidButton>
                                </Link>
                            </div>
                        </div>
                    ) : politician ? (
                        <>
                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h1 className={`text-3xl font-bold tracking-tight ${heading}`}>
                                            {politician.name}
                                        </h1>
                                        <span
                                            className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${scrapeStatusClass(politician.lastScrapeStatus)}`}
                                        >
                                            {scrapeStatusLabel(politician.lastScrapeStatus)}
                                        </span>
                                    </div>
                                    <p className={`text-xl font-semibold ${heading}`}>
                                        {politician.portfolio}
                                    </p>
                                    <p className={muted}>
                                        {politician.party}
                                        {politician.state ? ` · ${politician.state}` : ''}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-3 text-sm">
                                        <a
                                            href={politician.xProfileUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-zinc-300 hover:text-white underline underline-offset-2"
                                        >
                                            @{politician.xHandle}
                                        </a>
                                        <span className={muted}>
                                            Last scrape: {formatRelativeTime(politician.lastScrapedAt)}
                                        </span>
                                    </div>
                                </div>
                                {isAdmin && (
                                    <LiquidButton
                                        className="text-white"
                                        disabled={scrapeLoading}
                                        onClick={scrapeThisPolitician}
                                    >
                                        {scrapeLoading ? 'Scraping…' : 'Scrape this profile'}
                                    </LiquidButton>
                                )}
                            </div>

                            {actionMessage && (
                                <div className={`${panel} px-4 py-3 text-sm text-zinc-300`}>
                                    {actionMessage}
                                </div>
                            )}

                            {politician.lastScrapeStatus === 'error' &&
                                publicScrapeError(politician.lastScrapeError) && (
                                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                    Last scrape error: {publicScrapeError(politician.lastScrapeError)}
                                </div>
                            )}

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className={`${panel} p-4`}>
                                    <p className={`text-xs uppercase tracking-wider mb-1 ${muted}`}>Net score</p>
                                    <p className={`text-2xl font-bold font-mono ${heading}`}>
                                        {politician.stats.netScore > 0
                                            ? `+${politician.stats.netScore}`
                                            : politician.stats.netScore}
                                    </p>
                                </div>
                                <div className={`${panel} p-4`}>
                                    <p className={`text-xs uppercase tracking-wider mb-1 ${muted}`}>On-portfolio</p>
                                    <p className={`text-2xl font-bold ${heading}`}>
                                        {politician.stats.onPortfolioPct.toFixed(1)}%
                                    </p>
                                </div>
                                <div className={`${panel} p-4`}>
                                    <p className={`text-xs uppercase tracking-wider mb-1 ${muted}`}>Posts</p>
                                    <p className={`text-2xl font-bold ${heading}`}>
                                        {politician.stats.postCount}
                                    </p>
                                </div>
                                <div className={`${panel} p-4`}>
                                    <p className={`text-xs uppercase tracking-wider mb-1 ${muted}`}>Scrape</p>
                                    <p className={`text-lg font-semibold ${heading}`}>
                                        {scrapeStatusLabel(politician.lastScrapeStatus)}
                                    </p>
                                </div>
                            </div>

                            <div className={`${panel} p-5 space-y-4`}>
                                <p className={`text-sm font-medium ${heading}`}>Category breakdown</p>
                                {politician.stats.postCount === 0 ? (
                                    <p className={`text-sm ${muted}`}>
                                        No scored posts yet. Scrape this profile to populate categories.
                                    </p>
                                ) : (
                                    <div className="space-y-3">
                                        {categoryBreakdown.map((item) => (
                                            <button
                                                key={item.key}
                                                onClick={() =>
                                                    setCategoryFilter(
                                                        categoryFilter === item.key
                                                            ? 'all'
                                                            : (item.key as CategoryFilter)
                                                    )
                                                }
                                                className="w-full text-left space-y-1"
                                            >
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className={muted}>{item.label}</span>
                                                    <span className={heading}>{item.count}</span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full bg-white/40"
                                                        style={{
                                                            width: `${Math.max(
                                                                item.count > 0 ? 6 : 0,
                                                                (item.count / maxCategoryCount) * 100
                                                            )}%`,
                                                        }}
                                                    />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {politician.portfolioTopics?.length > 0 && (
                                <div className={`${panel} p-5`}>
                                    <p className={`text-sm font-medium mb-3 ${heading}`}>Portfolio topics</p>
                                    <div className="flex flex-wrap gap-2">
                                        {politician.portfolioTopics.map((topic) => (
                                            <span
                                                key={topic}
                                                className="text-xs px-2.5 py-1 rounded-md border border-white/10 text-zinc-300"
                                            >
                                                {topic}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <h2 className={`text-xl font-semibold ${heading}`}>Scored posts</h2>
                                    <select
                                        value={categoryFilter}
                                        onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                                        className="rounded-xl bg-black border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 w-full sm:w-auto"
                                    >
                                        <option value="all">All categories</option>
                                        <option value="on_portfolio">On portfolio</option>
                                        <option value="related">Not portfolio</option>
                                        <option value="off_topic">Off topic</option>
                                        <option value="attack">Attack</option>
                                        <option value="personal">Personal</option>
                                        <option value="unknown">Unknown</option>
                                    </select>
                                </div>

                                {posts.length === 0 ? (
                                    <div className={`${panel} p-6 space-y-3`}>
                                        <p className={muted}>
                                            No posts yet. Wait for the daily cron, or scrape this profile if you&apos;re an admin.
                                        </p>
                                        {isAdmin && (
                                            <LiquidButton
                                                className="text-white"
                                                disabled={scrapeLoading}
                                                onClick={scrapeThisPolitician}
                                            >
                                                {scrapeLoading ? 'Scraping…' : 'Scrape this profile'}
                                            </LiquidButton>
                                        )}
                                    </div>
                                ) : filteredPosts.length === 0 ? (
                                    <div className={`${panel} p-6 space-y-2`}>
                                        <p className={muted}>No posts in this category.</p>
                                        <button
                                            onClick={() => setCategoryFilter('all')}
                                            className={`text-sm underline underline-offset-2 ${muted} hover:text-white`}
                                        >
                                            Show all posts
                                        </button>
                                    </div>
                                ) : (
                                    filteredPosts.map((post) => (
                                        <div key={post.id} className={`${panel} p-4 space-y-2`}>
                                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                                <span
                                                    className={`px-2 py-0.5 rounded border ${categoryClass(post.category)}`}
                                                >
                                                    {categoryLabel(post.category)}
                                                </span>
                                                <span
                                                    className={`font-mono font-semibold ${
                                                        post.score >= 0 ? 'text-[#4CAF50]' : 'text-red-400'
                                                    }`}
                                                >
                                                    {post.score > 0 ? `+${post.score}` : post.score}
                                                </span>
                                                {post.postedAt && (
                                                    <span className={muted}>
                                                        {new Date(post.postedAt).toLocaleString()}
                                                    </span>
                                                )}
                                            </div>
                                            <p className={`text-sm whitespace-pre-wrap ${isLightTheme ? 'text-zinc-800' : 'text-zinc-200'}`}>
                                                {post.text}
                                            </p>
                                            {publicScoreReason(post.scoreReason) && (
                                                <p className={`text-xs ${muted}`}>
                                                    {publicScoreReason(post.scoreReason)}
                                                </p>
                                            )}
                                            {post.postUrl && (
                                                <a
                                                    href={post.postUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-zinc-300 hover:text-white underline underline-offset-2"
                                                >
                                                    View on X
                                                </a>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </>
                    ) : null}
                </div>
            </main>
        </div>
    );
}
