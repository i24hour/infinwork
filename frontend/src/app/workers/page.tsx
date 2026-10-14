'use client';

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { getScoreAtTime, type GithubPointsSnapshot, type ChainPointsSnapshot, type ScoreTask } from '@/lib/score';
import {
    fetchWithCache,
    getCachedData,
    getInitialIsLightTheme,
    prefetchJson,
} from '@/lib/client-cache';

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
    userId: string;
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

const WorkerCard = memo(function WorkerCard({
    worker,
    rank,
    currentScore,
    isLightTheme,
}: {
    worker: WorkerStats;
    rank: number;
    currentScore: number;
    isLightTheme: boolean;
}) {
    const encodedUserId = encodeURIComponent(worker.userId);
    return (
        <Link
            href={`/workers/${encodedUserId}`}
            prefetch={true}
            onMouseEnter={() => prefetchJson(`/api/workers/${encodedUserId}/tasks`, 15000)}
        >
            <motion.div
                whileHover={{ y: -4, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className="bg-black border border-white/10 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-4 hover:border-zinc-700 transition-colors cursor-pointer group w-full"
            >
                <div className="flex items-center gap-4 flex-1 min-w-0 md:max-w-[300px]">
                    {/* Rank Number */}
                    <div className="flex flex-col items-center justify-center shrink-0 w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-zinc-400 font-bold text-sm">
                        #{rank}
                    </div>

                    <div className="w-12 h-12 rounded-full bg-white/10 flex shrink-0 items-center justify-center text-white font-bold text-xl uppercase ring-1 ring-white/20 group-hover:bg-white/10 transition-colors overflow-hidden">
                        {worker.image ? (
                            <img src={worker.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                            worker.username?.charAt(0) || worker.userId.charAt(0)
                        )}
                    </div>
                    <div className="flex-1 min-w-[150px] overflow-hidden">
                        <h3 className={`text-lg font-medium truncate ${isLightTheme ? 'text-zinc-900' : 'text-zinc-200'}`} title={worker.username || worker.userId}>
                            {worker.username || worker.userId.split('@')[0]}
                        </h3>
                        <p className={`text-xs truncate ${isLightTheme ? 'text-zinc-700' : 'text-zinc-500'}`} title="Email hidden for privacy">
                            {worker.userId.split('@')[0].slice(0, 3)}••••@•••.com
                        </p>
                    </div>
                </div>

                <div className="flex flex-row flex-wrap justify-end gap-3 mt-auto md:ml-auto">
                    <div className="bg-black rounded-xl px-4 py-2 border border-white/10 flex flex-col justify-center min-w-[90px] flex-1 md:flex-none">
                        <span className={`block text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isLightTheme ? 'text-zinc-700' : 'text-zinc-500'}`}>Total Tasks</span>
                        <span className={`block text-2xl font-bold leading-none ${isLightTheme ? 'text-zinc-900' : 'text-zinc-300'}`}>
                            {worker.totalTasks}
                        </span>
                    </div>
                    <div className="bg-black rounded-xl px-4 py-2 border border-white/10 flex flex-col justify-center min-w-[90px] flex-1 md:flex-none">
                        <span className={`block text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isLightTheme ? 'text-zinc-700' : 'text-zinc-400'}`}>Running</span>
                        <span className={`block text-2xl font-bold leading-none ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                            {worker.runningTasks || 0}
                        </span>
                    </div>
                    <div className="bg-black rounded-xl px-4 py-2 border border-white/10 flex flex-col justify-center min-w-[90px] flex-1 md:flex-none">
                        <span className={`block text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isLightTheme ? 'text-zinc-700' : 'text-zinc-400'}`}>Completed</span>
                        <span className={`block text-2xl font-bold leading-none ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                            {worker.completedTasks}
                        </span>
                    </div>
                    <div className={`bg-black rounded-xl px-4 py-2 border flex flex-col justify-center min-w-[110px] flex-1 md:flex-none relative overflow-hidden ${currentScore < 0 ? 'border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.12)]' : 'border-[#4CAF50]/30 shadow-[0_0_15px_rgba(76,175,80,0.1)]'}`}>
                        <div className={`absolute inset-0 bg-gradient-to-br ${currentScore < 0 ? 'from-red-500/8' : 'from-[#4CAF50]/5'} to-transparent`}></div>
                        <span className={`block text-[10px] uppercase tracking-wider font-bold mb-0.5 relative ${currentScore < 0 ? 'text-red-400' : 'text-[#4CAF50]'}`}>Live Score</span>
                        <span className={`block text-2xl font-bold leading-none font-mono tracking-tight relative ${currentScore < 0 ? 'text-red-400' : 'text-white'}`}>
                            {currentScore.toFixed(2)}
                        </span>
                    </div>
                </div>
            </motion.div>
        </Link>
    );
});

function LiveWorkerList({ initialWorkers }: { initialWorkers: WorkerStats[] }) {
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const isLightTheme = useIsLightTheme();

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const sortedWorkers = useMemo(() => {
        const withScores = initialWorkers.map((w) => {
            const score = getScoreAtTime(
                w.tasks || [],
                currentTime,
                w.gamificationPoints || 0,
                w.gamificationPointsLastUpdatedAt || null,
                w.githubPointsHistory || null,
                w.chainPoints || 0,
                w.chainPointsHistory || null
            );
            return { worker: w, currentScore: score };
        });

        return withScores.sort((a, b) => b.currentScore - a.currentScore);
    }, [initialWorkers, currentTime]);

    return (
        <div className="flex flex-col gap-4 max-w-4xl">
            {sortedWorkers.length === 0 ? (
                <p className="text-zinc-500">No workers found yet. Tasks need to be created first.</p>
            ) : (
                sortedWorkers.map(({ worker, currentScore }, index) => (
                    <WorkerCard
                        key={worker.userId}
                        worker={worker}
                        rank={index + 1}
                        currentScore={currentScore}
                        isLightTheme={isLightTheme}
                    />
                ))
            )}
        </div>
    );
}

export default function WorkersPage() {
    const initialCached = getCachedData<WorkersApiResponse>('/api/workers');
    const [workers, setWorkers] = useState<WorkerStats[]>(() => initialCached?.workers || []);
    const [totalSignup, setTotalSignup] = useState<number>(() => initialCached?.totalSignup || 0);
    const [loading, setLoading] = useState<boolean>(() => !initialCached);
    const [error, setError] = useState<string | null>(null);
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
            fetchWorkers();
        }, 15000);

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

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full">
                <div className="space-y-8">
                    {/* Header Section */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h1 className={`text-3xl font-bold tracking-tight mb-2 ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>Workers Directory</h1>
                            <p className={isLightTheme ? 'text-zinc-700' : 'text-zinc-400'}>Overview of all active users and their task statistics.</p>
                        </div>
                        <Link href="/itime" prefetch={true}>
                            <LiquidButton className="text-white">
                                + Add Task
                            </LiquidButton>
                        </Link>
                    </div>

                    {/* Dashboard Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-black border border-white/10 rounded-2xl p-6">
                            <h3 className={`text-sm font-medium mb-2 ${isLightTheme ? 'text-zinc-700' : 'text-zinc-400'}`}>Total Workers</h3>
                            <p className={`text-3xl font-semibold ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>{totalSignup}</p>
                        </div>
                    </div>

                    {/* Workers Grid */}
                    <div>
                        {loading ? (
                            <div className="flex py-12 items-center justify-center w-full max-w-3xl">
                                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white/50"></div>
                            </div>
                        ) : error && workers.length === 0 ? (
                            <div className="flex flex-col py-12 items-center justify-center text-white gap-4 w-full max-w-3xl bg-black border border-white/10 rounded-2xl">
                                <p className="text-white">Error: {error}</p>
                                <LiquidButton
                                    onClick={() => fetchWorkers(true)}
                                    className="px-4 py-2 text-white"
                                    size="default"
                                >
                                    Retry
                                </LiquidButton>
                            </div>
                        ) : (
                            <LiveWorkerList initialWorkers={workers} />
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
