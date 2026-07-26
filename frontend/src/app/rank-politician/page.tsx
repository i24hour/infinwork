'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import {
    formatRelativeTime,
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

interface PoliticianRow {
    id: string;
    name: string;
    slug: string;
    party: string;
    state: string | null;
    portfolio: string;
    xHandle: string;
    xProfileUrl: string;
    avatarUrl: string | null;
    lastScrapedAt: string | null;
    lastScrapeStatus: string;
    lastScrapeError?: string | null;
    stats: {
        netScore: number;
        onPortfolioPct: number;
        postCount: number;
        scoredPostCount?: number;
    };
    rank: number;
}

interface LeaderboardMeta {
    totalActive: number;
    withPosts: number;
    scrapeSuccess: number;
    scrapeError: number;
    neverScraped: number;
    avgOnPortfolioPct: number;
}

type SortBy = 'onPortfolioPct' | 'netScore';
type ScrapeFilter = 'all' | 'never' | 'success' | 'error' | 'partial';

export default function RankPoliticianPage() {
    const isLightTheme = useIsLightTheme();
    const { data: session, status: authStatus } = useSession();

    const [isAdmin, setIsAdmin] = useState(false);
    const [hasAdmin, setHasAdmin] = useState(true);
    const [politicians, setPoliticians] = useState<PoliticianRow[]>([]);
    const [meta, setMeta] = useState<LeaderboardMeta | null>(null);
    const [parties, setParties] = useState<string[]>([]);
    const [party, setParty] = useState('all');
    const [scrapeStatus, setScrapeStatus] = useState<ScrapeFilter>('all');
    const [sortBy, setSortBy] = useState<SortBy>('netScore');
    const [searchInput, setSearchInput] = useState('');
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<'seed' | 'scrape' | 'claim' | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setQ(searchInput.trim()), 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const statusRes = await fetch('/api/admin/status');
                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (!cancelled) setHasAdmin(Boolean(statusData.hasAdmin));
                }
            } catch {
                // keep default
            }

            if (authStatus !== 'authenticated' || !session?.user?.email) {
                if (!cancelled) setIsAdmin(false);
                return;
            }

            try {
                const res = await fetch('/api/user/settings');
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) {
                    setIsAdmin(Boolean(data.isAdmin));
                    if (data.isAdmin) setHasAdmin(true);
                }
            } catch {
                if (!cancelled) setIsAdmin(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [authStatus, session?.user?.email]);

    const fetchLeaderboard = useCallback(async () => {
        try {
            setError(null);
            const params = new URLSearchParams({ sortBy });
            if (party !== 'all') params.set('party', party);
            if (scrapeStatus !== 'all') params.set('scrapeStatus', scrapeStatus);
            if (q) params.set('q', q);

            const response = await fetch(`/api/rank-politician?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to fetch politician rankings');
            const data = await response.json();
            setPoliticians(data.politicians || []);
            setParties(data.parties || []);
            setMeta(data.meta || null);
        } catch (err: any) {
            console.error('Error fetching rank-politician:', err);
            setError(err.message || 'Error fetching data');
        } finally {
            setLoading(false);
        }
    }, [party, q, scrapeStatus, sortBy]);

    useEffect(() => {
        setLoading(true);
        fetchLeaderboard();
    }, [fetchLeaderboard]);

    const hasActiveFilters = party !== 'all' || scrapeStatus !== 'all' || Boolean(q) || sortBy !== 'netScore';

    const clearFilters = () => {
        setParty('all');
        setScrapeStatus('all');
        setSortBy('netScore');
        setSearchInput('');
        setQ('');
    };

    const runAdminAction = async (action: 'seed' | 'scrape' | 'claim') => {
        setActionLoading(action);
        setActionMessage(null);
        try {
            if (action === 'claim') {
                const response = await fetch('/api/admin/claim-first', { method: 'POST' });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || 'Claim admin failed');
                setIsAdmin(true);
                setHasAdmin(true);
                setActionMessage('You are now the first admin (stored on your User in MongoDB).');
                return;
            }

            const response = await fetch(
                action === 'seed' ? '/api/rank-politician/seed' : '/api/rank-politician/scrape',
                {
                    method: 'POST',
                    headers: action === 'scrape' ? { 'Content-Type': 'application/json' } : undefined,
                    body: action === 'scrape' ? JSON.stringify({ limit: 10 }) : undefined,
                }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `${action} failed`);

            if (action === 'seed') {
                setActionMessage(`Seeded ${data.upserted ?? 0} politicians (${data.totalActive ?? 0} active).`);
            } else {
                setActionMessage(
                    `Scrape done: ${data.successCount ?? 0} ok, ${data.errorCount ?? 0} failed, ${data.processed ?? 0} processed.`
                );
            }
            await fetchLeaderboard();
        } catch (err: any) {
            setActionMessage(err.message || `${action} failed`);
        } finally {
            setActionLoading(null);
        }
    };

    const emptyHint = useMemo(() => {
        if ((meta?.totalActive || 0) === 0) {
            return 'No politicians in the database yet. Seed the starter list to begin.';
        }
        if (hasActiveFilters) {
            return 'No politicians match these filters. Clear filters to see the full list.';
        }
        return 'No politicians to show.';
    }, [hasActiveFilters, meta?.totalActive]);

    const muted = isLightTheme ? 'text-zinc-700' : 'text-zinc-400';
    const heading = isLightTheme ? 'text-zinc-900' : 'text-white';
    const panel = 'bg-black border border-white/10 rounded-2xl';

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full">
                <div className="space-y-8">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 max-w-4xl">
                        <div className="space-y-3 max-w-2xl">
                            <h1 className={`text-3xl font-bold tracking-tight ${heading}`}>
                                Rank Politician
                            </h1>
                            <p className={muted}>
                                Union Cabinet ministers only (incl. PM), ranked by how focused their
                                public posts are on assigned departments. Ranked by net score.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {authStatus === 'authenticated' && !isAdmin && !hasAdmin && (
                                <LiquidButton
                                    className="text-white"
                                    disabled={actionLoading !== null}
                                    onClick={() => runAdminAction('claim')}
                                >
                                    {actionLoading === 'claim' ? 'Claiming…' : 'Claim first admin'}
                                </LiquidButton>
                            )}
                            {isAdmin && (
                                <>
                                    <LiquidButton
                                        className="text-white"
                                        disabled={actionLoading !== null}
                                        onClick={() => runAdminAction('seed')}
                                    >
                                        {actionLoading === 'seed' ? 'Seeding…' : 'Seed list'}
                                    </LiquidButton>
                                    <LiquidButton
                                        className="text-white"
                                        disabled={actionLoading !== null}
                                        onClick={() => runAdminAction('scrape')}
                                    >
                                        {actionLoading === 'scrape' ? 'Scraping…' : 'Scrape batch'}
                                    </LiquidButton>
                                </>
                            )}
                        </div>
                    </div>

                    {actionMessage && (
                        <div className={`${panel} px-4 py-3 max-w-4xl text-sm text-zinc-300`}>
                            {actionMessage}
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl">
                        <div className={`${panel} p-5`}>
                            <h3 className={`text-sm font-medium mb-2 ${muted}`}>Active</h3>
                            <p className={`text-3xl font-semibold ${heading}`}>
                                {meta?.totalActive ?? politicians.length}
                            </p>
                        </div>
                        <div className={`${panel} p-5`}>
                            <h3 className={`text-sm font-medium mb-2 ${muted}`}>With posts</h3>
                            <p className={`text-3xl font-semibold ${heading}`}>{meta?.withPosts ?? 0}</p>
                        </div>
                        <div className={`${panel} p-5`}>
                            <h3 className={`text-sm font-medium mb-2 ${muted}`}>Avg on-portfolio</h3>
                            <p className={`text-3xl font-semibold ${heading}`}>
                                {(meta?.avgOnPortfolioPct ?? 0).toFixed(1)}%
                            </p>
                        </div>
                        <div className={`${panel} p-5`}>
                            <h3 className={`text-sm font-medium mb-2 ${muted}`}>Scrape health</h3>
                            <p className={`text-sm font-medium ${heading}`}>
                                {meta?.scrapeSuccess ?? 0} ok · {meta?.scrapeError ?? 0} fail ·{' '}
                                {meta?.neverScraped ?? 0} pending
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 max-w-4xl">
                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder="Search name, portfolio, handle..."
                                className="flex-1 rounded-xl bg-black border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
                            />
                            <select
                                value={party}
                                onChange={(e) => setParty(e.target.value)}
                                className="rounded-xl bg-black border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                            >
                                <option value="all">All parties</option>
                                {parties.map((p) => (
                                    <option key={p} value={p}>
                                        {p}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={scrapeStatus}
                                onChange={(e) => setScrapeStatus(e.target.value as ScrapeFilter)}
                                className="rounded-xl bg-black border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                            >
                                <option value="all">All scrape states</option>
                                <option value="success">Scraped</option>
                                <option value="partial">Partial</option>
                                <option value="error">Failed</option>
                                <option value="never">Not scraped</option>
                            </select>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortBy)}
                                className="rounded-xl bg-black border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                            >
                                <option value="netScore">Sort: net score</option>
                                <option value="onPortfolioPct">Sort: % on-portfolio</option>
                            </select>
                        </div>
                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                className={`text-left text-sm underline underline-offset-2 w-fit ${muted} hover:text-white`}
                            >
                                Clear filters
                            </button>
                        )}
                    </div>

                    <div>
                        {loading ? (
                            <div className="flex py-12 items-center justify-center w-full max-w-4xl">
                                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white/50" />
                            </div>
                        ) : error ? (
                            <div className={`flex flex-col py-12 items-center justify-center gap-4 w-full max-w-4xl ${panel}`}>
                                <p className="text-white">Couldn&apos;t load rankings.</p>
                                <p className={`text-sm ${muted}`}>{error}</p>
                                <LiquidButton onClick={fetchLeaderboard} className="px-4 py-2 text-white">
                                    Retry
                                </LiquidButton>
                            </div>
                        ) : politicians.length === 0 ? (
                            <div className={`${panel} p-8 max-w-4xl space-y-4`}>
                                <p className={`text-lg font-medium ${heading}`}>Nothing here yet</p>
                                <p className={`text-sm ${muted}`}>{emptyHint}</p>
                                {isAdmin && (meta?.totalActive || 0) === 0 && (
                                    <LiquidButton
                                        className="text-white"
                                        disabled={actionLoading !== null}
                                        onClick={() => runAdminAction('seed')}
                                    >
                                        {actionLoading === 'seed' ? 'Seeding…' : 'Seed starter politicians'}
                                    </LiquidButton>
                                )}
                                {hasActiveFilters && (
                                    <button
                                        onClick={clearFilters}
                                        className={`text-sm underline underline-offset-2 ${muted} hover:text-white`}
                                    >
                                        Clear filters
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4 max-w-4xl">
                                <p className={`text-sm ${muted}`}>
                                    Showing {politicians.length} politician{politicians.length === 1 ? '' : 's'}
                                </p>
                                {politicians.map((politician) => {
                                    const pct = politician.stats?.onPortfolioPct ?? 0;
                                    const net = politician.stats?.netScore ?? 0;
                                    const scorePositive = net >= 0;

                                    return (
                                        <Link
                                            href={`/rank-politician/${encodeURIComponent(politician.slug)}`}
                                            key={politician.id}
                                        >
                                            <motion.div
                                                whileHover={{ y: -4, scale: 1.01 }}
                                                whileTap={{ scale: 0.98 }}
                                                className={`${panel} p-4 flex flex-col md:flex-row md:items-center gap-4 hover:border-zinc-700 transition-colors cursor-pointer group w-full`}
                                            >
                                                <div className="flex items-center gap-4 flex-1 min-w-0 md:max-w-[360px]">
                                                    <div className="flex flex-col items-center justify-center shrink-0 w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-zinc-400 font-bold text-sm">
                                                        #{politician.rank}
                                                    </div>
                                                    <div className="w-12 h-12 rounded-full bg-white/10 flex shrink-0 items-center justify-center text-white font-bold text-xl uppercase ring-1 ring-white/20 overflow-hidden">
                                                        {politician.avatarUrl ? (
                                                            <img
                                                                src={politician.avatarUrl}
                                                                alt=""
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            politician.name.charAt(0)
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0 overflow-hidden">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <h3 className={`text-lg font-medium truncate ${isLightTheme ? 'text-zinc-900' : 'text-zinc-200'}`}>
                                                                {politician.name}
                                                            </h3>
                                                            <span
                                                                className={`shrink-0 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${scrapeStatusClass(politician.lastScrapeStatus)}`}
                                                            >
                                                                {scrapeStatusLabel(politician.lastScrapeStatus)}
                                                            </span>
                                                        </div>
                                                        <p className={`text-sm font-medium truncate mt-0.5 ${heading}`}>
                                                            {politician.portfolio}
                                                        </p>
                                                        <p className={`text-xs truncate mt-0.5 ${muted}`}>
                                                            {politician.party}
                                                            {politician.state ? ` · ${politician.state}` : ''}
                                                            {' · '}@{politician.xHandle}
                                                            {' · '}
                                                            {formatRelativeTime(politician.lastScrapedAt)}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex flex-row flex-wrap justify-end gap-3 mt-auto md:ml-auto">
                                                    <div className="bg-black rounded-xl px-4 py-2 border border-white/10 flex flex-col justify-center min-w-[90px] flex-1 md:flex-none">
                                                        <span className={`block text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${muted}`}>
                                                            Posts
                                                        </span>
                                                        <span className={`block text-2xl font-bold leading-none ${heading}`}>
                                                            {politician.stats?.postCount ?? 0}
                                                        </span>
                                                    </div>
                                                    <div className="bg-black rounded-xl px-4 py-2 border border-white/10 flex flex-col justify-center min-w-[110px] flex-1 md:flex-none">
                                                        <span className={`block text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${muted}`}>
                                                            On-portfolio
                                                        </span>
                                                        <span className={`block text-2xl font-bold leading-none ${heading}`}>
                                                            {pct.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                    <div
                                                        className={`bg-black rounded-xl px-4 py-2 border flex flex-col justify-center min-w-[110px] flex-1 md:flex-none ${
                                                            scorePositive
                                                                ? 'border-[#4CAF50]/30'
                                                                : 'border-red-500/30'
                                                        }`}
                                                    >
                                                        <span
                                                            className={`block text-[10px] uppercase tracking-wider font-bold mb-0.5 ${
                                                                scorePositive ? 'text-[#4CAF50]' : 'text-red-400'
                                                            }`}
                                                        >
                                                            Net score
                                                        </span>
                                                        <span
                                                            className={`block text-2xl font-bold leading-none font-mono tracking-tight ${
                                                                scorePositive ? 'text-white' : 'text-red-400'
                                                            }`}
                                                        >
                                                            {net > 0 ? `+${net}` : net}
                                                        </span>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        </Link>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
