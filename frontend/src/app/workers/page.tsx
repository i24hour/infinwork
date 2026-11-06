'use client';

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import {
    getScoreAtTime,
    getScoreBreakdownAtTime,
    type GithubPointsSnapshot,
    type ChainPointsSnapshot,
    type ScoreTask,
} from '@/lib/score';
import {
    fetchWithCache,
    getCachedData,
    getInitialIsLightTheme,
    prefetchJson,
} from '@/lib/client-cache';

const DAY_MS = 24 * 60 * 60 * 1000;

function useIsLightTheme() {
    const [isLightTheme, setIsLightTheme] = useState<boolean>(() => getInitialIsLightTheme());

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

interface WorkerStats {
    publicId?: string;
    /** Legacy cached payloads used the email as the id. */
    userId?: string;
    username?: string;
    image?: string;
    totalTasks: number;
    completedTasks: number;
    runningTasks?: number;
    lastActive: string;
    tasks: ScoreTask[];
    gamificationPoints?: number;
    gamificationPointsLastUpdatedAt?: string | null;
    githubPointsHistory?: GithubPointsSnapshot[] | null;
    chainPoints?: number;
    chainPointsHistory?: ChainPointsSnapshot[] | null;
}

interface WorkersApiResponse {
    workers?: WorkerStats[];
    totalSignup?: number;
}

type WorkerFilter = 'all' | 'running' | 'completed';

const FILTERS: Array<{ id: WorkerFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'running', label: 'Running' },
    { id: 'completed', label: 'Completed' },
];

const getPublicId = (worker: WorkerStats) => worker.publicId || worker.userId || 'anonymous';

const getWorkerScore = (worker: WorkerStats, now: number) =>
    getScoreAtTime(
        worker.tasks || [],
        now,
        worker.gamificationPoints || 0,
        worker.gamificationPointsLastUpdatedAt || null,
        worker.githubPointsHistory || null,
        worker.chainPoints || 0,
        worker.chainPointsHistory || null
    );

const getWorkerBreakdown = (worker: WorkerStats, now: number) =>
    getScoreBreakdownAtTime(
        worker.tasks || [],
        now,
        worker.gamificationPoints || 0,
        worker.gamificationPointsLastUpdatedAt || null,
        worker.githubPointsHistory || null,
        worker.chainPoints || 0,
        worker.chainPointsHistory || null
    );

function buildSparkline(worker: WorkerStats): number[] {
    const now = Date.now();
    const points: number[] = [];
    for (let i = 13; i >= 0; i--) {
        points.push(getWorkerScore(worker, now - i * DAY_MS));
    }
    return points;
}

function ScoreSparkline({ points }: { points: number[] }) {
    if (points.length < 2) return null;

    const width = 96;
    const height = 28;
    const pad = 3;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const path = points
        .map((value, index) => {
            const x = (index / (points.length - 1)) * width;
            const y = height - pad - ((value - min) / range) * (height - pad * 2);
            return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(' ');
    const positive = points[points.length - 1] >= 0;

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-7 w-24 shrink-0 overflow-visible"
            aria-hidden="true"
        >
            <path
                d={path}
                fill="none"
                stroke={positive ? '#4CAF50' : '#ef4444'}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

const rankTone = (rank: number, isLightTheme: boolean) => {
    if (rank === 1) return 'border-amber-400/50 bg-amber-400/10 text-amber-300';
    if (rank === 2) return 'border-zinc-300/40 bg-zinc-300/10 text-zinc-300';
    if (rank === 3) return 'border-orange-400/40 bg-orange-400/10 text-orange-300';
    return isLightTheme
        ? 'border-black/10 bg-black/5 text-zinc-600'
        : 'border-white/10 bg-white/5 text-zinc-400';
};

const PodiumCard = memo(function PodiumCard({
    worker,
    rank,
    score,
    isLightTheme,
}: {
    worker: WorkerStats;
    rank: number;
    score: number;
    isLightTheme: boolean;
}) {
    const publicId = getPublicId(worker);
    const sparkline = useMemo(() => buildSparkline(worker), [worker]);
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';

    return (
        <Link
            href={`/workers/${encodeURIComponent(publicId)}`}
            prefetch
            className="group block"
            onMouseEnter={() => prefetchJson(`/api/workers/${encodeURIComponent(publicId)}/tasks`, 15000)}
        >
            <motion.div
                whileHover={{ y: -4 }}
                className={`relative overflow-hidden rounded-3xl border p-5 transition-colors ${rankTone(rank, isLightTheme)}`}
            >
                <div className="absolute right-3 top-3 text-2xl" aria-hidden="true">
                    {medal}
                </div>
                <div className="flex items-center gap-3">
                    <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border text-lg font-bold uppercase ring-2 ${
                            isLightTheme ? 'border-black/10 bg-black/5 text-zinc-800 ring-black/5' : 'border-white/15 bg-white/10 text-white ring-white/10'
                        }`}
                    >
                        {worker.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={worker.image} alt="" className="h-full w-full object-cover" />
                        ) : (
                            worker.username?.charAt(0) || publicId.charAt(0)
                        )}
                    </div>
                    <div className="min-w-0">
                        <p className={`truncate text-base font-semibold ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                            {worker.username || 'Anonymous'}
                        </p>
                        <p className={`truncate text-xs ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                            @{publicId}
                        </p>
                    </div>
                </div>
                <div className="mt-5 flex items-end justify-between gap-3">
                    <div>
                        <p className={`text-[10px] font-semibold uppercase tracking-widest ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                            Live score
                        </p>
                        <p className={`font-mono text-3xl font-bold tracking-tight ${score < 0 ? 'text-red-400' : isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                            {score.toFixed(2)}
                        </p>
                    </div>
                    <ScoreSparkline points={sparkline} />
                </div>
            </motion.div>
        </Link>
    );
});

const WorkerCard = memo(function WorkerCard({
    worker,
    rank,
    currentScore,
    breakdown,
    isLightTheme,
    isCurrentUser,
}: {
    worker: WorkerStats;
    rank: number;
    currentScore: number;
    breakdown: ReturnType<typeof getWorkerBreakdown>;
    isLightTheme: boolean;
    isCurrentUser: boolean;
}) {
    const publicId = getPublicId(worker);
    const encodedUserId = encodeURIComponent(publicId);
    const sparkline = useMemo(() => buildSparkline(worker), [worker]);
    const hasPenalty = breakdown.idlePenalty > 0;

    return (
        <Link
            href={`/workers/${encodedUserId}`}
            prefetch
            onMouseEnter={() => prefetchJson(`/api/workers/${encodedUserId}/tasks`, 15000)}
        >
            <motion.div
                whileHover={{ y: -3, scale: 1.005 }}
                whileTap={{ scale: 0.995 }}
                className={`group w-full rounded-2xl border p-4 transition-colors ${
                    isCurrentUser
                        ? isLightTheme
                            ? 'border-black/30 bg-black/[0.04]'
                            : 'border-white/30 bg-white/[0.06]'
                        : isLightTheme
                            ? 'border-black/10 bg-white hover:border-black/20'
                            : 'border-white/10 bg-black hover:border-zinc-700'
                }`}
            >
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-4 md:max-w-[320px]">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${rankTone(rank, isLightTheme)}`}>
                            #{rank}
                        </div>

                        <div className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xl font-bold uppercase ring-1 ${isLightTheme ? 'border-black/10 bg-black/5 text-zinc-800 ring-black/5' : 'border-white/20 bg-white/10 text-white ring-white/20'}`}>
                            {worker.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={worker.image} alt="" className="h-full w-full object-cover" />
                            ) : (
                                worker.username?.charAt(0) || publicId.charAt(0)
                            )}
                        </div>

                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className={`truncate text-lg font-medium ${isLightTheme ? 'text-zinc-900' : 'text-zinc-200'}`} title={worker.username || publicId}>
                                    {worker.username || 'Anonymous'}
                                </h3>
                                {isCurrentUser && (
                                    <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                                        You
                                    </span>
                                )}
                            </div>
                            <p className={`truncate text-xs ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                                @{publicId}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-row flex-wrap justify-end gap-3 md:ml-auto">
                        <div className={`flex min-w-[90px] flex-1 flex-col justify-center rounded-xl border px-4 py-2 md:flex-none ${isLightTheme ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-black'}`}>
                            <span className={`mb-0.5 block text-[10px] font-semibold uppercase tracking-wider ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                                Total Tasks
                            </span>
                            <span className={`block text-2xl font-bold leading-none ${isLightTheme ? 'text-zinc-900' : 'text-zinc-300'}`}>
                                {worker.totalTasks}
                            </span>
                        </div>
                        <div className={`flex min-w-[90px] flex-1 flex-col justify-center rounded-xl border px-4 py-2 md:flex-none ${isLightTheme ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-black'}`}>
                            <span className={`mb-0.5 block text-[10px] font-semibold uppercase tracking-wider ${isLightTheme ? 'text-zinc-600' : 'text-zinc-400'}`}>
                                Running
                            </span>
                            <span className={`block text-2xl font-bold leading-none ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                                {worker.runningTasks || 0}
                            </span>
                        </div>
                        <div className={`flex min-w-[90px] flex-1 flex-col justify-center rounded-xl border px-4 py-2 md:flex-none ${isLightTheme ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-black'}`}>
                            <span className={`mb-0.5 block text-[10px] font-semibold uppercase tracking-wider ${isLightTheme ? 'text-zinc-600' : 'text-zinc-400'}`}>
                                Completed
                            </span>
                            <span className={`block text-2xl font-bold leading-none ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                                {worker.completedTasks}
                            </span>
                        </div>
                        <div className={`relative flex min-w-[120px] flex-1 flex-col justify-center overflow-hidden rounded-xl border px-4 py-2 md:flex-none ${currentScore < 0 ? 'border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'border-[#4CAF50]/30 shadow-[0_0_15px_rgba(76,175,80,0.08)]'}`}>
                            <div className={`absolute inset-0 bg-gradient-to-br ${currentScore < 0 ? 'from-red-500/8' : 'from-[#4CAF50]/5'} to-transparent`} />
                            <span className={`relative mb-0.5 block text-[10px] font-bold uppercase tracking-wider ${currentScore < 0 ? 'text-red-400' : 'text-[#4CAF50]'}`}>
                                Live Score
                            </span>
                            <span className={`relative block font-mono text-2xl font-bold leading-none tracking-tight ${currentScore < 0 ? 'text-red-400' : isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                                {currentScore.toFixed(2)}
                            </span>
                            <div className="relative mt-1">
                                <ScoreSparkline points={sparkline} />
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-[10px] ${isLightTheme ? 'border-black/10 text-zinc-600' : 'border-white/10 text-zinc-500'}`}>
                    <span>Tasks <strong className={isLightTheme ? 'text-zinc-900' : 'text-zinc-300'}>{breakdown.penalizedBaseScore.toFixed(2)}</strong></span>
                    <span>GitHub <strong className={isLightTheme ? 'text-zinc-900' : 'text-zinc-300'}>{breakdown.githubPoints.toLocaleString()}</strong></span>
                    <span>Chain <strong className={isLightTheme ? 'text-zinc-900' : 'text-zinc-300'}>{breakdown.chainPoints.toLocaleString()}</strong></span>
                    <span className={hasPenalty ? 'text-red-400' : ''}>
                        Idle penalty <strong>-{breakdown.idlePenalty.toFixed(2)}</strong>
                    </span>
                </div>
            </motion.div>
        </Link>
    );
});

function LiveWorkerList({
    initialWorkers,
    filter,
    query,
    currentUsername,
}: {
    initialWorkers: WorkerStats[];
    filter: WorkerFilter;
    query: string;
    currentUsername?: string;
}) {
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const isLightTheme = useIsLightTheme();

    useEffect(() => {
        // Scores move by about 0.01 every 10 seconds. A 1s tick resorted every
        // card and made the leaderboard feel stuck.
        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            setCurrentTime(Date.now());
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    const sortedWorkers = useMemo(() => {
        return initialWorkers
            .map((worker) => ({
                worker,
                score: getWorkerScore(worker, currentTime),
                breakdown: getWorkerBreakdown(worker, currentTime),
            }))
            .sort((a, b) => b.score - a.score);
    }, [initialWorkers, currentTime]);

    const filteredWorkers = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        return sortedWorkers.filter(({ worker }) => {
            if (normalizedQuery) {
                const haystack = `${worker.username || ''} ${getPublicId(worker)}`.toLowerCase();
                if (!haystack.includes(normalizedQuery)) return false;
            }
            if (filter === 'running') return (worker.runningTasks || 0) > 0;
            if (filter === 'completed') return worker.completedTasks > 0 && (worker.runningTasks || 0) === 0;
            return true;
        });
    }, [filter, query, sortedWorkers]);

    const showPodium = filter === 'all' && !query.trim() && filteredWorkers.length >= 3;
    const listWorkers = showPodium ? filteredWorkers.slice(3) : filteredWorkers;

    return (
        <div className="flex flex-col gap-5 max-w-5xl">
            {showPodium && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {filteredWorkers.slice(0, 3).map(({ worker, score }, index) => (
                        <PodiumCard
                            key={getPublicId(worker)}
                            worker={worker}
                            rank={index + 1}
                            score={score}
                            isLightTheme={isLightTheme}
                        />
                    ))}
                </div>
            )}

            {filteredWorkers.length === 0 ? (
                <div className={`rounded-2xl border p-10 text-center ${isLightTheme ? 'border-black/10 bg-white' : 'border-white/10 bg-black'}`}>
                    <div className="mb-3 text-4xl">🏁</div>
                    <p className={`text-lg font-medium ${isLightTheme ? 'text-zinc-900' : 'text-zinc-200'}`}>
                        {initialWorkers.length === 0 ? 'No workers yet' : 'No workers match this view'}
                    </p>
                    <p className={`mt-1 text-sm ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                        {initialWorkers.length === 0
                            ? 'Tasks need to be created before the leaderboard appears.'
                            : 'Try clearing the search or switching the filter.'}
                    </p>
                    {initialWorkers.length === 0 && (
                        <Link href="/itime" className="mt-5 inline-block">
                            <LiquidButton className="text-white">Start a task</LiquidButton>
                        </Link>
                    )}
                </div>
            ) : (
                listWorkers.map(({ worker, score, breakdown }, index) => (
                    <WorkerCard
                        key={getPublicId(worker)}
                        worker={worker}
                        rank={showPodium ? index + 4 : index + 1}
                        currentScore={score}
                        breakdown={breakdown}
                        isLightTheme={isLightTheme}
                        isCurrentUser={Boolean(currentUsername) && worker.username === currentUsername}
                    />
                ))
            )}
        </div>
    );
}

export default function WorkersPage() {
    const initialCached = getCachedData<WorkersApiResponse>('/api/workers');
    const initialSettings = getCachedData<{ username?: string }>('/api/user/settings');
    const [workers, setWorkers] = useState<WorkerStats[]>(() => initialCached?.workers || []);
    const [totalSignup, setTotalSignup] = useState<number>(() => initialCached?.totalSignup || 0);
    const [loading, setLoading] = useState<boolean>(() => !initialCached);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<WorkerFilter>('all');
    const [query, setQuery] = useState('');
    const isLightTheme = useIsLightTheme();

    const fetchWorkers = useCallback(async (force: boolean = false) => {
        try {
            setError(null);
            const data = await fetchWithCache<WorkersApiResponse>('/api/workers', {
                dedupingIntervalMs: 3000,
                force,
            });
            setWorkers(data.workers || []);
            setTotalSignup(data.totalSignup || 0);
        } catch (err: unknown) {
            console.error('Error fetching workers:', err);
            const message = err instanceof Error ? err.message : 'Error fetching data';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchWorkers();

        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            fetchWorkers();
        }, 60000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchWorkers();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchWorkers]);

    const totalRunning = useMemo(
        () => workers.reduce((sum, worker) => sum + (worker.runningTasks || 0), 0),
        [workers]
    );

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full">
                <div className="space-y-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className={`mb-2 text-[10px] font-bold uppercase tracking-[0.25em] ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                                Live directory
                            </p>
                            <h1 className={`text-3xl font-bold tracking-tight ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                                Workers
                            </h1>
                            <p className={`mt-1 ${isLightTheme ? 'text-zinc-700' : 'text-zinc-400'}`}>
                                Every task, commit and chain block in one live score.
                            </p>
                        </div>
                        <Link href="/itime" prefetch>
                            <LiquidButton className="text-white">+ Add Task</LiquidButton>
                        </Link>
                    </div>

                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 max-w-5xl">
                        {[
                            { label: 'Workers', value: totalSignup, tone: 'default' },
                            { label: 'Running now', value: totalRunning, tone: 'green' },
                            { label: 'Tasks tracked', value: workers.reduce((sum, worker) => sum + worker.totalTasks, 0), tone: 'default' },
                            { label: 'Refresh', value: '60s', tone: 'default' },
                        ].map((stat) => (
                            <div
                                key={stat.label}
                                className={`rounded-2xl border p-4 md:p-5 ${isLightTheme ? 'border-black/10 bg-white' : 'border-white/10 bg-black'}`}
                            >
                                <p className={`text-[10px] font-semibold uppercase tracking-widest ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                                    {stat.label}
                                </p>
                                <p className={`mt-2 truncate text-2xl font-bold ${stat.tone === 'green' ? 'text-[#4CAF50]' : isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                                    {stat.value}
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/5 p-1">
                            {FILTERS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setFilter(item.id)}
                                    className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                                        filter === item.id
                                            ? isLightTheme
                                                ? 'bg-black text-white'
                                                : 'bg-white text-black'
                                            : isLightTheme
                                                ? 'text-zinc-600 hover:text-zinc-900'
                                                : 'text-zinc-400 hover:text-white'
                                    }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search workers..."
                            className="app-input max-w-xs py-2 text-sm"
                            aria-label="Search workers"
                        />
                    </div>

                    <div>
                        {loading ? (
                            <div className="flex max-w-5xl flex-col gap-3">
                                {[1, 2, 3].map((item) => (
                                    <div key={item} className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
                                ))}
                            </div>
                        ) : error && workers.length === 0 ? (
                            <div className="flex max-w-5xl flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-black p-12 text-white">
                                <p>Error: {error}</p>
                                <LiquidButton onClick={() => fetchWorkers(true)} className="px-4 py-2 text-white">
                                    Retry
                                </LiquidButton>
                            </div>
                        ) : (
                            <LiveWorkerList
                                initialWorkers={workers}
                                filter={filter}
                                query={query}
                                currentUsername={initialSettings?.username}
                            />
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
