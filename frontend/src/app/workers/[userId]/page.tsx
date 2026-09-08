'use client';

import { useState, useEffect, useCallback, use, useMemo } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import dynamic from 'next/dynamic';
import { LiveTimer } from '@/components/LiveTimer';
import { getScoreAtTime, type GithubPointsSnapshot, type ChainPointsSnapshot } from '@/lib/score';

const PerformanceChart = dynamic(
    () => import('@/components/PerformanceChart').then(mod => mod.PerformanceChart),
    { ssr: false, loading: () => <div className="h-[500px] bg-black rounded-2xl border border-white/10 flex items-center justify-center text-zinc-500">Loading chart...</div> }
);
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

// Use same types as ITimeTracker
interface ITimeTask {
    id: string;
    _id?: string;
    title: string;
    description: string;
    startTime: number;
    pausedElapsed: number;
    enabled: boolean;
    completed: boolean;
    completedAt?: number;
    cancelledAt?: number;
    targetTime?: number;
    isPublic?: boolean;
    milestones?: Milestone[];
    events?: { type: 'start' | 'pause' | 'complete'; timestamp: number; }[];
}

interface Milestone {
    id: string;
    text: string;
    completed: boolean;
    completedAt?: number;
    createdAt: number;
    createdAtElapsed: number;
}

export default function WorkerTasksPage({ params }: { params: Promise<{ userId: string }> }) {
    // We need to unwrap params in Next.js 15+ using React.use
    const resolvedParams = use(params);
    const userId = decodeURIComponent(resolvedParams.userId || '');

    const { data: session } = useSession();
    const router = useRouter();

    const [tasks, setTasks] = useState<ITimeTask[]>([]);
    const [userData, setUserData] = useState<{
        username: string;
        image: string | null;
        points?: number;
        githubPointsLastUpdatedAt?: string | null;
        githubPointsHistory?: GithubPointsSnapshot[] | null;
        chainPoints?: number;
        chainPointsHistory?: ChainPointsSnapshot[] | null;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedTask, setSelectedTask] = useState<ITimeTask | null>(null);
    const [scoreNow, setScoreNow] = useState(() => Date.now());
    const [gamificationPoints, setGamificationPoints] = useState(0);
    const [gamificationPointsLastUpdatedAt, setGamificationPointsLastUpdatedAt] = useState<string | null>(null);
    const [githubPointsHistory, setGithubPointsHistory] = useState<GithubPointsSnapshot[] | null>(null);
    const [chainPoints, setChainPoints] = useState(0);
    const [chainPointsHistory, setChainPointsHistory] = useState<ChainPointsSnapshot[] | null>(null);

    const fetchTasks = useCallback(async () => {
        try {
            const response = await fetch(`/api/workers/${encodeURIComponent(userId)}/tasks`);
            if (response.ok) {
                const data = await response.json();
                setTasks(data.tasks.map((t: any) => ({
                    ...t,
                    id: t._id,
                })));
                if (data.user) {
                    setUserData(data.user);
                    setGamificationPoints(data.user.points || 0);
                    setGamificationPointsLastUpdatedAt(data.user.githubPointsLastUpdatedAt || null);
                    setGithubPointsHistory(Array.isArray(data.user.githubPointsHistory) ? data.user.githubPointsHistory : null);
                    setChainPoints(data.user.chainPoints || 0);
                    setChainPointsHistory(Array.isArray(data.user.chainPointsHistory) ? data.user.chainPointsHistory : null);
                }
            } else {
                throw new Error('Failed to fetch tasks');
            }
        } catch (err: any) {
            console.error('Error fetching tasks:', err);
            setError(err.message || 'Error loading tasks');
        } finally {
            setIsLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        fetchTasks();
        
        // Poll every 10 seconds to keep data fresh for viewers
        const pollInterval = setInterval(() => {
            fetchTasks();
        }, 10000);
        
        return () => clearInterval(pollInterval);
    }, [fetchTasks]);

    useEffect(() => {
        const interval = setInterval(() => {
            setScoreNow(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        // If viewing own worker profile, redirect to personal iTime tracker to allow full editing
        if (session?.user?.email === userId || session?.user?.id === userId) {
            router.push('/itime');
        }
    }, [session, userId, router]);

    // Timer interval - update current time every second to show live progress of running tasks
    // Removed: now handled by localized LiveTimer and LiveTotalTimer components.

    const getElapsedSeconds = useCallback((task: ITimeTask, now: number = Date.now()): number => {
        // If task is completed and has legacy `completedAt`, use total duration if no events
        if (task.completed && task.completedAt && (!task.events || task.events.length === 0)) {
            const completedTime = (task.completedAt - task.startTime) / 1000;
            return Math.floor(completedTime > 0 ? completedTime : task.pausedElapsed);
        }

        if (!task.events || task.events.length === 0) {
            // Legacy fallback if no events tracking exists
            if (!task.enabled) {
                return task.pausedElapsed;
            }
            const runningSince = (now - task.startTime) / 1000;
            return Math.floor(task.pausedElapsed + runningSince);
        }

        let totalMs = 0;
        let isRunning = false;
        let lastStartTime = 0;

        for (const ev of task.events) {
            if (ev.type === 'start') {
                if (!isRunning) {
                    isRunning = true;
                    lastStartTime = ev.timestamp;
                }
            } else if (ev.type === 'pause' || ev.type === 'complete') {
                if (isRunning) {
                    totalMs += (ev.timestamp - lastStartTime);
                    isRunning = false;
                }
            }
        }

        // If it's still running right now and not completed
        if (isRunning && !task.completed) {
            totalMs += (now - lastStartTime);
        }

        // Add any migrated legacy paused Elapsed 
        if (task.events.length > 0 && task.events[0].type !== 'start') {
            totalMs += (task.pausedElapsed * 1000);
        }

        return Math.floor(totalMs / 1000);
    }, []);

    const formatElapsed = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const activeTasksCount = useMemo(() => tasks.filter((task) => task.enabled && !task.completed && !task.cancelledAt).length, [tasks]);
    const pendingTasks = useMemo(
        () => tasks
            .filter((task) => !task.completed && !task.cancelledAt)
            .sort((a, b) => Number(b.enabled) - Number(a.enabled)),
        [tasks]
    );
    const completedTasks = useMemo(() => tasks.filter((task) => task.completed), [tasks]);
    const liveScore = useMemo(
        () => getScoreAtTime(tasks, scoreNow, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory),
        [tasks, scoreNow, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory]
    );
    const liveScoreColorClass = liveScore < 0 ? 'text-red-500' : 'text-[#4CAF50]';

    if (isLoading) {
        return (
            <div className="flex flex-col md:flex-row min-h-screen bg-black">
                <Sidebar />
                <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full animate-pulse space-y-6">
                    <div className="h-10 w-48 bg-black rounded-md"></div>
                    <div className="h-32 w-full bg-black border border-white/10 rounded-2xl"></div>
                    <div className="h-64 w-full bg-black border border-white/10 rounded-2xl"></div>
                </main>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col md:flex-row min-h-screen bg-black">
                <Sidebar />
                <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full flex items-center justify-center">
                    <div className="flex flex-col items-center justify-center bg-black border border-white/10 rounded-2xl p-8 gap-4">
                        <p className="text-white">Error: {error}</p>
                        <LiquidButton onClick={() => router.push('/workers')} className="text-white">
                            Back to Workers Directory
                        </LiquidButton>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />

            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-start justify-between">
                        <div>
                            <LiquidButton
                                onClick={() => router.push('/workers')}
                                className="mb-4 text-white"
                                size="sm"
                            >
                                ← Back to Workers
                            </LiquidButton>
                            <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
                                <div className="flex items-center gap-3">
                                    {userData?.image ? (
                                        <img src={userData.image} alt="" className="w-10 h-10 rounded-full border border-white/10 shrink-0 object-cover" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-lg text-white shrink-0">
                                            {(userData?.username || userId).charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <span>{(userData?.username || userId.split('@')[0])}'s Tasks</span>
                                </div>
                                <span className="bg-black text-xs px-2 py-1 rounded text-zinc-400 font-normal self-center">Read-only View</span>
                            </h1>
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 max-w-5xl">
                    <div className="bg-black  rounded-2xl border border-white/10 p-6 flex flex-col justify-center">
                        <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-1">Total Tasks</div>
                        <div className="text-3xl sm:text-4xl font-bold text-white truncate">{tasks.length}</div>
                    </div>

                    <div className="bg-black  rounded-2xl border border-white/10 p-6 flex flex-col justify-center">
                        <div className="text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-1">Running</div>
                        <div className="text-3xl sm:text-4xl font-bold text-white truncate">{activeTasksCount}</div>
                    </div>

                    <div className="bg-black  rounded-2xl border border-white/10 p-6 flex flex-col justify-center">
                        <div className="text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-1">Completed</div>
                        <div className="text-3xl sm:text-4xl font-bold text-white truncate">{completedTasks.length}</div>
                    </div>

                    <div className="bg-black  rounded-2xl border border-white/10 p-6 flex flex-col justify-center">
                        <div className="text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-1">Score</div>
                        <div className={`text-2xl sm:text-3xl lg:text-4xl font-bold truncate tracking-tight ${liveScoreColorClass}`}>
                            {liveScore.toFixed(2)}
                        </div>
                    </div>
                </div>

                {/* Stock Performance Chart representing Workload */}
                <div className="max-w-5xl mb-8">
                    <PerformanceChart
                        tasks={tasks}
                        gamificationPoints={gamificationPoints}
                        gamificationPointsLastUpdatedAt={gamificationPointsLastUpdatedAt}
                        githubPointsHistory={githubPointsHistory}
                        chainPoints={chainPoints}
                        chainPointsHistory={chainPointsHistory}
                    />
                </div>

                {/* Active/Pending Tasks */}
                <div className="bg-black rounded-2xl border border-white/10 p-6 mb-8 max-w-5xl">
                    <h2 className="text-lg font-semibold text-white mb-4">Active Tasks</h2>

                    {pendingTasks.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="text-6xl mb-4">⏱️</div>
                            <div className="text-zinc-400 text-lg mb-2">No active tasks</div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {pendingTasks.map((task) => (
                                <div
                                    key={task.id}
                                    className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-4 space-y-3 transition-all cursor-pointer"
                                    onClick={() => setSelectedTask(task)}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="text-sm font-semibold text-white">
                                                    {task.title}
                                                </div>
                                                {!task.enabled && (
                                                    <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                                                        Paused
                                                    </span>
                                                )}
                                            </div>
                                            {task.description && (
                                                <div className="text-xs text-zinc-400">
                                                    {task.description}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-2 border-t border-white/10">
                                        <div className={`text-2xl font-mono font-bold ${task.enabled ? 'text-white' : 'text-zinc-500'}`}>
                                            <LiveTimer task={task} getElapsedSeconds={getElapsedSeconds} formatElapsed={formatElapsed} />
                                        </div>
                                        <div className="flex gap-2 text-xs">
                                            {task.enabled && (
                                                <span className="bg-white/10 text-white px-2 py-1 rounded flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-white text-black animate-pulse"></span>
                                                    Running
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Completed Tasks */}
                {completedTasks.length > 0 && (
                    <div className="bg-black rounded-2xl border border-white/10 p-6 max-w-5xl mb-8">
                        <h2 className="text-lg font-semibold text-white mb-4">Completed Tasks</h2>
                        <div className="flex flex-col gap-3">
                            {completedTasks.map((task) => (
                                <div
                                    key={task.id}
                                    onClick={() => setSelectedTask(task)}
                                    className="bg-white/5 hover:bg-white/10 border border-white/20 rounded-lg p-4 space-y-3 opacity-75 cursor-pointer transition-all"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-white mb-1 line-through decoration-white/50">
                                                {task.title}
                                            </div>
                                            {task.description && (
                                                <div className="text-xs text-zinc-400">
                                                    {task.description}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-white text-lg">✓</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-2 border-t border-white/10">
                                        <div className="text-2xl font-mono font-bold text-white">
                                            {formatElapsed(getElapsedSeconds(task))}
                                        </div>
                                        <div className="text-xs text-zinc-500">
                                            Completed
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>

            {/* Task Detail Modal - Read Only */}
            {selectedTask && (
                <div className="fixed inset-0 bg-black/95 z-[80] overflow-y-auto ">
                    {/* Header */}
                    <div className="sticky top-0 z-10 bg-black  border-b border-white/10">
                        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 md:py-6">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mb-2">
                                        <h1 className="text-2xl md:text-4xl font-bold text-white break-words">
                                            {selectedTask.title}
                                        </h1>
                                        <div className="self-start md:self-auto">
                                            {selectedTask.completed ? (
                                                <span className="bg-white/10 text-white px-3 py-1 rounded-full text-xs md:text-sm font-medium border border-white/20">
                                                    Completed
                                                </span>
                                            ) : (
                                                <span className="bg-white/10 text-white px-3 py-1 rounded-full text-xs md:text-sm font-medium border border-white/50/20">
                                                    Running
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {selectedTask.description && (
                                        <p className="text-zinc-400 text-sm md:text-lg">
                                            {selectedTask.description}
                                        </p>
                                    )}
                                </div>
                                <LiquidButton
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSelectedTask(null)}
                                    className="text-zinc-500 hover:text-white transition-colors bg-black hover:bg-black rounded-full"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </LiquidButton>
                            </div>
                        </div>
                    </div>

                    <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-12">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-12">
                            {/* Left Column - Timer & Controls */}
                            <div className="space-y-8">
                                {/* Timer Display */}
                                <div className="bg-black  rounded-2xl border border-white/10 p-4 md:p-8 overflow-hidden">
                                    <div className="text-center">
                                        <div className="text-xs md:text-sm text-zinc-400 mb-2 md:mb-4 uppercase tracking-wide">Time Recorded</div>
                                        <div className={`text-6xl sm:text-7xl md:text-8xl font-mono font-bold mb-4 md:mb-8 tracking-tighter sm:tracking-normal ${selectedTask.enabled ? 'text-white' : 'text-zinc-300'}`}>
                                            <LiveTimer task={selectedTask} getElapsedSeconds={getElapsedSeconds} formatElapsed={formatElapsed} />
                                        </div>
                                    </div>

                                    {/* Progress Bar if target time is set */}
                                    {selectedTask.targetTime && (
                                        <div className="mt-8 pt-8 border-t border-white/10">
                                            <div className="flex justify-between text-sm text-zinc-400 mb-3">
                                                <span>Progress to Target</span>
                                                <span>{formatElapsed(selectedTask.targetTime)}</span>
                                            </div>
                                            <div className="w-full bg-black rounded-full h-3 overflow-hidden">
                                                <div
                                                    className={`h-full transition-all ${getElapsedSeconds(selectedTask) >= selectedTask.targetTime
                                                        ? 'bg-white text-black'
                                                        : 'bg-white text-black'
                                                        }`}
                                                    style={{
                                                        width: `${Math.min((getElapsedSeconds(selectedTask) / selectedTask.targetTime) * 100, 100)}%`
                                                    }}
                                                />
                                            </div>
                                            <div className="text-center mt-2 text-lg font-bold text-white">
                                                {Math.min(Math.round((getElapsedSeconds(selectedTask) / selectedTask.targetTime) * 100), 100)}%
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Column - Vertical Timeline */}
                            <div className="bg-black  rounded-2xl border border-white/10 p-8">
                                <h3 className="text-xl font-semibold text-white mb-6">Milestones Log</h3>

                                {/* Vertical Timeline */}
                                <div className="relative mt-8">
                                    {selectedTask.milestones && selectedTask.milestones.length > 0 ? (
                                        <div className="space-y-0">
                                            {selectedTask.milestones.map((milestone, index) => (
                                                <div key={milestone.id} className="relative">
                                                    {/* Vertical Line - connecting to next item */}
                                                    {index < selectedTask.milestones!.length - 1 && (
                                                        <div className="absolute left-4 top-8 w-0.5 h-full bg-gradient-to-b from-white/20 to-transparent" />
                                                    )}

                                                    {/* Timeline Item */}
                                                    <div className="relative flex items-start gap-4 pb-8 group">
                                                        {/* Circle */}
                                                        <div className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center ${milestone.completed
                                                            ? 'bg-white text-black border-white/50 shadow-lg shadow-white/20'
                                                            : 'bg-black border-white/30'
                                                            }`}
                                                        >
                                                            {milestone.completed && (
                                                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </div>

                                                        {/* Content */}
                                                        <div className="flex-1 pt-1">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className={`flex-1 text-base font-medium ${milestone.completed
                                                                    ? 'text-zinc-500 line-through'
                                                                    : 'text-white'
                                                                    }`}>
                                                                    {milestone.text}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-3 mt-1">
                                                                <div className="text-xs text-zinc-500">
                                                                    Added at {formatElapsed(milestone.createdAtElapsed)}
                                                                </div>
                                                                {milestone.completed && milestone.completedAt && (
                                                                    <>
                                                                        <span className="text-zinc-700">•</span>
                                                                        <div className="text-xs text-white">
                                                                            ✓ Completed
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-12">
                                            <div className="text-4xl mb-4 opacity-50">📝</div>
                                            <div className="text-zinc-400 text-base">No milestones recorded for this task.</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
