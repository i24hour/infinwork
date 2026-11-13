'use client';

import { Sidebar } from '@/components/Sidebar';
import { SignInModal } from '@/components/SignInModal';
import { useSession, signOut } from 'next-auth/react';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { getScoreAtTime, type GithubPointsSnapshot, type ChainPointsSnapshot } from '@/lib/score';
import { PerformanceChart } from '@/components/LazyPerformanceChart';
import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { LiveTimer, LivePauseCountdown } from '@/components/LiveTimer';
import {
    clearAllCache,
    fetchWithCache,
    getCachedData,
    getInitialIsLightTheme,
    invalidateCache,
    setCachedData,
} from '@/lib/client-cache';

interface ITimeTask {
    id: string;
    _id?: string; // MongoDB ID
    title: string;
    description: string;
    startTime: number; // timestamp when task was started
    pausedElapsed: number; // elapsed seconds when paused
    enabled: boolean;
    completed: boolean;
    completedAt?: number; // timestamp when completed
    cancelledAt?: number;
    cancelReason?: string;
    targetTime?: number; // target time in seconds
    autoResumeAt?: number; // scheduled automatic resume timestamp
    isPublic?: boolean;
    createdAt?: string;
    updatedAt?: string;
    milestones?: Milestone[];
    events?: Array<{
        type: 'start' | 'pause' | 'complete';
        timestamp: number;
    }>;
}

const COMPLETED_TASKS_PAGE_SIZE = 10;

interface Milestone {
    id: string;
    text: string;
    completed: boolean;
    completedAt?: number;
    createdAt: number; // timestamp when milestone was added
    createdAtElapsed: number; // elapsed seconds when milestone was added
}

/** Normalise a task from the API (Mongo `_id`, lean docs, legacy milestones). */
function normalizeTask(raw: Record<string, unknown>): ITimeTask {
    const rawMilestones = Array.isArray(raw.milestones) ? raw.milestones : [];
    const milestones: Milestone[] = rawMilestones.map((entry, index) => {
        const milestone = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        const createdAt = Number(milestone.createdAt ?? milestone.timestamp ?? Date.now());
        return {
            id: String(milestone.id ?? milestone._id ?? `${createdAt}-${index}`),
            text: String(milestone.text ?? ''),
            completed: milestone.completed === true,
            completedAt: typeof milestone.completedAt === 'number' ? milestone.completedAt : undefined,
            createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
            createdAtElapsed: Number.isFinite(Number(milestone.createdAtElapsed))
                ? Number(milestone.createdAtElapsed)
                : 0,
        };
    });

    return {
        ...(raw as unknown as ITimeTask),
        id: String(raw._id ?? raw.id ?? ''),
        title: String(raw.title ?? ''),
        description: String(raw.description ?? ''),
        pausedElapsed: Number(raw.pausedElapsed ?? 0),
        milestones,
        events: Array.isArray(raw.events)
            ? (raw.events as ITimeTask['events'])
            : undefined,
    };
}

/**
 * Build a whitelisted PUT body. Sending the whole GET object leaked `userId`,
 * `createdAt` and `updatedAt` back to the API; `userId` made every write fail
 * validation, so timer state never persisted.
 */
function buildTaskPayload(task: ITimeTask): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        ...(task._id ? { _id: task._id } : {}),
        title: task.title,
        description: task.description ?? '',
        startTime: task.startTime,
        pausedElapsed: task.pausedElapsed ?? 0,
        enabled: task.enabled,
        completed: task.completed,
        isPublic: task.isPublic !== false,
        events: task.events ?? [],
        milestones: (task.milestones ?? []).map((milestone) => ({
            id: milestone.id,
            text: milestone.text,
            completed: milestone.completed,
            ...(typeof milestone.completedAt === 'number' ? { completedAt: milestone.completedAt } : {}),
            createdAt: milestone.createdAt,
            createdAtElapsed: milestone.createdAtElapsed,
        })),
        autoResumeAt: typeof task.autoResumeAt === 'number' ? task.autoResumeAt : null,
    };

    if (typeof task.completedAt === 'number') payload.completedAt = task.completedAt;
    if (typeof task.cancelledAt === 'number') payload.cancelledAt = task.cancelledAt;
    if (typeof task.targetTime === 'number') payload.targetTime = task.targetTime;
    if (typeof task.cancelReason === 'string') payload.cancelReason = task.cancelReason;

    return payload;
}

function formatCompactDuration(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${safe}s`;
}

function readGuestTasks(): ITimeTask[] {
    if (typeof window === 'undefined') return [];
    try {
        const saved = localStorage.getItem('itime_tasks');
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed)
            ? parsed.map((task) => normalizeTask(task as Record<string, unknown>))
            : [];
    } catch {
        return [];
    }
}

function TargetRing({ elapsed, target }: { elapsed: number; target: number }) {
    const pct = target > 0 ? Math.min(1, elapsed / target) : 0;
    const radius = 17;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - pct);
    const complete = pct >= 1;

    return (
        <div className="relative h-11 w-11 shrink-0" title={`${Math.round(pct * 100)}% of target`}>
            <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90" aria-hidden="true">
                <circle cx="22" cy="22" r={radius} fill="none" stroke="rgba(128,128,128,0.2)" strokeWidth="4" />
                <circle
                    cx="22"
                    cy="22"
                    r={radius}
                    fill="none"
                    stroke={complete ? '#4CAF50' : '#a1a1aa'}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className="transition-[stroke-dashoffset] duration-500"
                />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-[9px] font-bold ${complete ? 'text-[#4CAF50]' : 'text-zinc-400'}`}>
                {Math.round(pct * 100)}%
            </span>
        </div>
    );
}

function getTaskIntervals(task: ITimeTask, now: number): Array<{ start: number; end: number }> {
    if (task.events && task.events.length > 0) {
        const intervals: Array<{ start: number; end: number }> = [];
        let isRunning = false;
        let lastStart = 0;
        for (const event of task.events) {
            if (event.timestamp > now) break;
            if (event.type === 'start') {
                if (!isRunning) {
                    isRunning = true;
                    lastStart = event.timestamp;
                }
            } else if (isRunning) {
                intervals.push({ start: lastStart, end: event.timestamp });
                isRunning = false;
            }
        }
        if (isRunning && !task.completed && !task.cancelledAt) {
            intervals.push({ start: lastStart, end: now });
        }
        return intervals;
    }

    const start = task.startTime;
    if (!start) return [];
    const end = task.completedAt || (task.enabled ? now : start + (task.pausedElapsed || 0) * 1000);
    return end > start ? [{ start, end }] : [];
}

const ITimeLiveStats = memo(function ITimeLiveStats({
    tasks,
    tasksReady,
    scoreReady,
    isLightTheme,
    gamificationPoints,
    gamificationPointsLastUpdatedAt,
    githubPointsHistory,
    chainPoints,
    chainPointsHistory,
    activeTasks,
    completedCount,
    totalCount,
}: {
    tasks: ITimeTask[];
    tasksReady: boolean;
    scoreReady: boolean;
    isLightTheme: boolean;
    gamificationPoints: number;
    gamificationPointsLastUpdatedAt: string | number | null;
    githubPointsHistory: GithubPointsSnapshot[] | null;
    chainPoints: number;
    chainPointsHistory: ChainPointsSnapshot[] | null;
    activeTasks: number;
    completedCount: number;
    totalCount: number;
}) {
    const [scoreNow, setScoreNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            setScoreNow(Date.now());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const liveScore = useMemo<number | null>(
        () => scoreReady
            ? getScoreAtTime(tasks, scoreNow, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory)
            : null,
        [scoreReady, tasks, scoreNow, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory]
    );
    const liveScoreColorClass = liveScore !== null && liveScore < 0 ? 'text-red-500' : 'text-[#4CAF50]';

    const todayStats = useMemo(() => {
        const now = scoreNow;
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istNow = new Date(now + istOffset);
        const todayStart = Date.UTC(
            istNow.getUTCFullYear(),
            istNow.getUTCMonth(),
            istNow.getUTCDate()
        ) - istOffset;

        const focusSeconds = tasks.reduce((sum, task) => {
            const intervals = getTaskIntervals(task, now);
            return sum + intervals.reduce((intervalSum, interval) => {
                const start = Math.max(interval.start, todayStart);
                const end = Math.min(interval.end, now);
                return intervalSum + Math.max(0, end - start) / 1000;
            }, 0);
        }, 0);

        const doneToday = tasks.filter(
            (task) => typeof task.completedAt === 'number' && task.completedAt >= todayStart
        ).length;

        const scoreAtStart = getScoreAtTime(
            tasks,
            todayStart,
            gamificationPoints,
            gamificationPointsLastUpdatedAt,
            githubPointsHistory,
            chainPoints,
            chainPointsHistory
        );
        const scoreDelta = liveScore !== null ? liveScore - scoreAtStart : null;

        const dayKey = (timestamp: number) => {
            const date = new Date(timestamp + istOffset);
            return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        };
        const completedDays = new Set(
            tasks
                .filter((task) => typeof task.completedAt === 'number')
                .map((task) => dayKey(task.completedAt as number))
        );
        let streak = 0;
        let cursor = todayStart;
        if (!completedDays.has(dayKey(todayStart))) {
            cursor -= 24 * 60 * 60 * 1000;
        }
        while (completedDays.has(dayKey(cursor))) {
            streak += 1;
            cursor -= 24 * 60 * 60 * 1000;
        }

        return { focusSeconds, doneToday, scoreDelta, streak };
    }, [
        tasks,
        scoreNow,
        liveScore,
        gamificationPoints,
        gamificationPointsLastUpdatedAt,
        githubPointsHistory,
        chainPoints,
        chainPointsHistory,
    ]);

    return (
        <>
            <div className="grid grid-cols-2 gap-4 mb-3 md:grid-cols-4 md:gap-6">
                <div className={`rounded-2xl border p-4 md:p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                    <div className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>Focus today</div>
                    <div className={`text-2xl font-bold md:text-3xl ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                        {tasksReady ? formatCompactDuration(todayStats.focusSeconds) : '—'}
                    </div>
                </div>

                <div className={`rounded-2xl border p-4 md:p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                    <div className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>Done today</div>
                    <div className={`text-2xl font-bold md:text-3xl ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                        {tasksReady ? todayStats.doneToday : '—'}
                    </div>
                </div>

                <div className={`rounded-2xl border p-4 md:p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                    <div className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>Live score</div>
                    <div className={`font-mono text-2xl font-bold md:text-3xl ${liveScoreColorClass}`}>
                        {scoreReady && liveScore !== null ? liveScore.toFixed(2) : '—'}
                    </div>
                    {scoreReady && todayStats.scoreDelta !== null && (
                        <div className={`mt-1 text-xs font-semibold ${todayStats.scoreDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {todayStats.scoreDelta >= 0 ? '+' : ''}{todayStats.scoreDelta.toFixed(2)} today
                        </div>
                    )}
                </div>

                <div className={`rounded-2xl border p-4 md:p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                    <div className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>Streak</div>
                    <div className={`text-2xl font-bold md:text-3xl ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                        {todayStats.streak} <span className="text-sm font-normal text-zinc-500">days</span>
                    </div>
                </div>
            </div>

            <div className={`mb-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                <span>{totalCount} total tasks</span>
                <span className="text-zinc-700">·</span>
                <span>{activeTasks} running</span>
                <span className="text-zinc-700">·</span>
                <span>{completedCount} completed</span>
                <span className="text-zinc-700">·</span>
                <span>{todayStats.focusSeconds > 0 ? 'Timer running' : 'No focus logged yet'}</span>
            </div>
        </>
    );
});

export default function ITimePage() {
    const { data: session, status } = useSession();
    const { toast } = useToast();
    const { confirm } = useConfirm();
    const initialTasksCache = getCachedData<{ tasks?: Array<Omit<ITimeTask, 'id'> & { id?: string }> }>('/api/itime');
    const initialSettingsCache = getCachedData<{
        username?: string;
        points?: number;
        githubPointsLastUpdatedAt?: string | null;
        githubPointsHistory?: GithubPointsSnapshot[] | null;
        chainPoints?: number;
        chainPointsHistory?: ChainPointsSnapshot[] | null;
    }>('/api/user/settings');

    const [tasks, setTasks] = useState<ITimeTask[]>(() =>
        (initialTasksCache?.tasks ?? []).map((task) =>
            normalizeTask(task as unknown as Record<string, unknown>)
        )
    );
    const [hasLoadedTasksOnce, setHasLoadedTasksOnce] = useState<boolean>(() => Boolean(initialTasksCache?.tasks));
    const [hasLoadedProfileOnce, setHasLoadedProfileOnce] = useState<boolean>(() => Boolean(initialSettingsCache));
    const [newTitle, setNewTitle] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [selectedTask, setSelectedTask] = useState<ITimeTask | null>(null);
    const [newMilestone, setNewMilestone] = useState('');
    const [targetHours, setTargetHours] = useState('');
    const [targetMinutes, setTargetMinutes] = useState('');
    const [showSignInModal, setShowSignInModal] = useState(false);
    const [showPauseOptions, setShowPauseOptions] = useState<string | null>(null);
    const [completedTasksPage, setCompletedTasksPage] = useState(1);
    const [isLightTheme, setIsLightTheme] = useState<boolean>(() => getInitialIsLightTheme());
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        const root = document.documentElement;
        const syncTheme = () => setIsLightTheme(root.getAttribute('data-theme') === 'light');

        syncTheme();
        const observer = new MutationObserver(syncTheme);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    const playAlertSound = () => {
        try {
            const browserWindow = window as Window & {
                AudioContext?: typeof AudioContext;
                webkitAudioContext?: typeof AudioContext;
            };
            const AudioContextConstructor = browserWindow.AudioContext || browserWindow.webkitAudioContext;
            if (!AudioContextConstructor) return;
            const ctx = new AudioContextConstructor();
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.1);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.5);
        } catch (e) {
            console.error("Audio API error", e);
        }
    };

    // Fetch tasks from MongoDB for authenticated users (fire immediately even while session status is resolving)
    const fetchTasks = useCallback(async () => {
        if (status !== 'unauthenticated') {
            try {
                const data = await fetchWithCache<{
                    tasks?: Array<Omit<ITimeTask, 'id'> & { id?: string }>;
                }>('/api/itime', { dedupingIntervalMs: 2000 });
                setTasks((data.tasks ?? []).map((task) =>
                    normalizeTask(task as unknown as Record<string, unknown>)
                ));
                setSaveError(null);
                setHasLoadedTasksOnce(true);
                return;
            } catch (error) {
                if (status === 'loading') {
                    return;
                }
                console.error('Failed to fetch tasks:', error);
                setHasLoadedTasksOnce(true);
                return;
            }
        }

        // Load from localStorage for guest users
        setTasks(readGuestTasks());
        setHasLoadedTasksOnce(true);
    }, [status]);

    const persistTask = useCallback(async (task: ITimeTask): Promise<boolean> => {
        if (status !== 'authenticated' || !task._id) return true;

        try {
            const response = await fetch('/api/itime', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildTaskPayload(task)),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(
                    typeof payload?.error === 'string'
                        ? payload.error
                        : `Could not save task (${response.status})`
                );
            }

            setSaveError(null);
            return true;
        } catch (error) {
            console.error('Error saving task:', error);
            const message = error instanceof Error ? error.message : 'Could not save task';
            setSaveError(message);
            toast({ variant: 'error', title: 'Could not save task', description: message });
            // Re-sync so the UI never keeps an optimistic state the server rejected.
            invalidateCache('/api/itime');
            fetchTasks();
            return false;
        }
    }, [fetchTasks, status, toast]);

    const pauseMenuRef = useRef<HTMLDivElement>(null);
    const resumingTaskIdsRef = useRef<Set<string>>(new Set());

    const [userProfile, setUserProfile] = useState<{ username?: string; image?: string }>(() =>
        initialSettingsCache?.username ? { username: initialSettingsCache.username } : {}
    );
    const [gamificationPoints, setGamificationPoints] = useState<number>(() => initialSettingsCache?.points || 0);
    const [gamificationPointsLastUpdatedAt, setGamificationPointsLastUpdatedAt] = useState<string | null>(() =>
        initialSettingsCache?.githubPointsLastUpdatedAt || null
    );
    const [githubPointsHistory, setGithubPointsHistory] = useState<GithubPointsSnapshot[] | null>(() =>
        Array.isArray(initialSettingsCache?.githubPointsHistory) ? initialSettingsCache!.githubPointsHistory! : null
    );
    const [chainPoints, setChainPoints] = useState<number>(() => initialSettingsCache?.chainPoints || 0);
    const [chainPointsHistory, setChainPointsHistory] = useState<ChainPointsSnapshot[] | null>(() =>
        Array.isArray(initialSettingsCache?.chainPointsHistory) ? initialSettingsCache!.chainPointsHistory! : null
    );

    const fetchUserProfile = useCallback(async () => {
        try {
            const data = await fetchWithCache<{
                username?: string;
                points?: number;
                githubPointsLastUpdatedAt?: string | null;
                githubPointsHistory?: GithubPointsSnapshot[] | null;
                chainPoints?: number;
                chainPointsHistory?: ChainPointsSnapshot[] | null;
            }>('/api/user/settings', { dedupingIntervalMs: 5000 });
            if (data.username) {
                setUserProfile(prev => ({ ...prev, username: data.username }));
            }
            if (data.points !== undefined) {
                setGamificationPoints(data.points || 0);
            }
            setGamificationPointsLastUpdatedAt(data.githubPointsLastUpdatedAt || null);
            setGithubPointsHistory(Array.isArray(data.githubPointsHistory) ? data.githubPointsHistory : null);
            setChainPoints(data.chainPoints || 0);
            setChainPointsHistory(Array.isArray(data.chainPointsHistory) ? data.chainPointsHistory : null);
        } catch (err) {
            console.error('Error fetching profile:', err);
        } finally {
            setHasLoadedProfileOnce(true);
        }
    }, []);

    // Initial load — fire API fetches in parallel with NextAuth session resolution
    useEffect(() => {
        if (status === 'unauthenticated') {
            setHasLoadedProfileOnce(true);
            setGamificationPoints(0);
            setGamificationPointsLastUpdatedAt(null);
            setGithubPointsHistory(null);
            setChainPoints(0);
            setChainPointsHistory(null);
            fetchTasks();
            return;
        }

        if (!getCachedData('/api/itime')) {
            setHasLoadedTasksOnce(false);
        }
        if (!getCachedData('/api/user/settings')) {
            setHasLoadedProfileOnce(false);
        }
        fetchTasks();
        fetchUserProfile();
    }, [fetchTasks, fetchUserProfile, status]);

    useEffect(() => {
        if (status !== 'authenticated' || !session?.user?.email) return;

        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            fetchUserProfile();
        }, 60000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchUserProfile();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchUserProfile, session?.user?.email, status]);

    // Keep the task list in sync with server-side auto-cancel and other devices.
    useEffect(() => {
        if (status !== 'authenticated') return;

        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            fetchTasks();
        }, 60000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchTasks();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchTasks, status]);

    // Click outside to close pause menu
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pauseMenuRef.current && !pauseMenuRef.current.contains(event.target as Node)) {
                setShowPauseOptions(null);
            }
        };

        if (showPauseOptions) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showPauseOptions]);

    // Previous Timer Interval removed - now handled by LiveTimer components.
    // The live score clock lives in ITimeLiveStats so this page does not
    // re-render the task list and year chart every second.

    // Save tasks - client cache for authenticated, localStorage for guest
    useEffect(() => {
        if (!hasLoadedTasksOnce) return;

        if (status === 'authenticated') {
            setCachedData('/api/itime', { tasks });
            invalidateCache('/api/workers');
        } else if (status === 'unauthenticated' && typeof window !== 'undefined') {
            // Guest mode - save to localStorage
            localStorage.setItem('itime_tasks', JSON.stringify(tasks));
        }
    }, [tasks, status, hasLoadedTasksOnce]);

    const createTask = async (title: string, description: string, targetTime?: number) => {
        if (!title.trim() || status === 'loading') return;

        const now = Date.now();
        const newTask: ITimeTask = {
            id: `guest-${now}-${Math.random().toString(36).slice(2, 7)}`,
            title: title.trim(),
            description,
            startTime: now,
            pausedElapsed: 0,
            enabled: true,
            completed: false,
            isPublic: true,
            ...(targetTime ? { targetTime } : {}),
            milestones: [],
            events: [{ type: 'start', timestamp: now }],
        };

        // Guest mode is explicitly offered by the sign-in modal, so honour it:
        // tasks are stored in localStorage by the save effect below.
        if (status === 'unauthenticated') {
            setTasks((prev) => [newTask, ...prev]);
            setNewTitle('');
            setNewDescription('');
            setSaveError(null);
            toast({ variant: 'success', title: 'Task started', description: 'Saved locally in guest mode.' });
            return;
        }

        try {
            const response = await fetch('/api/itime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildTaskPayload(newTask)),
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.task) {
                throw new Error(
                    typeof payload?.error === 'string'
                        ? payload.error
                        : `Could not create task (${response.status})`
                );
            }

            const created = normalizeTask(payload.task as Record<string, unknown>);
            setTasks((prev) => [created, ...prev]);
            setNewTitle('');
            setNewDescription('');
            setSaveError(null);
            toast({
                variant: 'success',
                title: 'Task started',
                description: targetTime ? `Target set to ${Math.round(targetTime / 60)} minutes.` : undefined,
            });
        } catch (error) {
            console.error('Error saving task:', error);
            const message = error instanceof Error ? error.message : 'Could not create task';
            setSaveError(message);
            toast({ variant: 'error', title: 'Could not create task', description: message });
        }
    };

    const handleAddTask = () => createTask(newTitle, newDescription);

    const handleQuickStart = (minutes: number) =>
        createTask(newTitle || `${minutes}-minute focus`, newDescription, minutes * 60);

    const toggleTask = async (id: string, breakMinutes?: number) => {
        const task = tasks.find(t => t.id === id);
        if (!task || task.completed || task.cancelledAt) return;

        const now = Date.now();
        const isStarting = !task.enabled;
        const currentElapsed = isStarting
            ? Math.max(0, task.pausedElapsed || 0)
            : Math.max(0, getElapsedSeconds(task, now));

        // Legacy tasks have no event stream. Seed a synthetic start so the
        // accumulated pausedElapsed is not lost when the first event is added.
        const baseEvents = task.events && task.events.length > 0
            ? [...task.events]
            : [{ type: 'start' as const, timestamp: Math.max(0, now - (currentElapsed * 1000)) }];

        const updatedTask: ITimeTask = {
            ...task,
            enabled: isStarting,
            pausedElapsed: currentElapsed,
            startTime: isStarting
                ? now
                : (task.startTime || Math.max(0, now - (currentElapsed * 1000))),
            autoResumeAt: isStarting
                ? undefined
                : (breakMinutes ? now + (breakMinutes * 60000) : undefined),
            events: [
                ...baseEvents,
                { type: isStarting ? 'start' : 'pause', timestamp: now },
            ],
        };

        setTasks((prev) => prev.map(t => t.id === id ? updatedTask : t));
        await persistTask(updatedTask);
    };

    const resumeTaskFromBreak = useCallback(async (id: string) => {
        if (resumingTaskIdsRef.current.has(id)) return;
        const task = tasks.find(t => t.id === id);
        if (!task || task.enabled || task.completed || task.cancelledAt) return;

        resumingTaskIdsRef.current.add(id);
        try {
            playAlertSound();
            const now = Date.now();
            const currentElapsed = Math.max(0, task.pausedElapsed || 0);
            const baseEvents = task.events && task.events.length > 0
                ? [...task.events]
                : [{ type: 'start' as const, timestamp: Math.max(0, now - (currentElapsed * 1000)) }];

            const updatedTask: ITimeTask = {
                ...task,
                enabled: true,
                autoResumeAt: undefined,
                startTime: now,
                pausedElapsed: currentElapsed,
                events: [...baseEvents, { type: 'start', timestamp: now }],
            };

            setTasks(prev => prev.map(t => t.id === id ? updatedTask : t));
            await persistTask(updatedTask);
        } finally {
            resumingTaskIdsRef.current.delete(id);
        }
    }, [persistTask, tasks]);

    useEffect(() => {
        const activeBreaks = tasks.filter(
            t => !t.enabled && !t.completed && !t.cancelledAt && typeof t.autoResumeAt === 'number'
        );
        if (activeBreaks.length === 0) return;

        const interval = setInterval(() => {
            const now = Date.now();
            activeBreaks.forEach(task => {
                if (task.autoResumeAt && now >= task.autoResumeAt) {
                    resumeTaskFromBreak(task.id);
                }
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [tasks, resumeTaskFromBreak]);

    const deleteTask = async (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        const confirmed = await confirm({
            title: `Delete "${task.title}"?`,
            description: 'The task and its tracked time will be removed permanently.',
            confirmLabel: 'Delete task',
            destructive: true,
        });
        if (!confirmed) return;

        setTasks((prev) => prev.filter((t) => t.id !== id));

        if (status === 'authenticated' && task._id) {
            try {
                const response = await fetch(`/api/itime?id=${task._id}`, {
                    method: 'DELETE',
                });
                if (!response.ok) {
                    const payload = await response.json().catch(() => ({}));
                    throw new Error(
                        typeof payload?.error === 'string'
                            ? payload.error
                            : `Could not delete task (${response.status})`
                    );
                }
                setSaveError(null);
                toast({ variant: 'success', title: 'Task deleted' });
            } catch (error) {
                console.error('Error deleting task:', error);
                const message = error instanceof Error ? error.message : 'Could not delete task';
                setSaveError(message);
                toast({ variant: 'error', title: 'Could not delete task', description: message });
                invalidateCache('/api/itime');
                fetchTasks();
            }
        } else {
            toast({ variant: 'success', title: 'Task deleted' });
        }
    };

    const completeTask = async (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (!task || task.completed) return;

        const now = Date.now();
        const finalElapsed = Math.max(0, getElapsedSeconds(task, now));
        const baseEvents = task.events && task.events.length > 0
            ? [...task.events]
            : [{ type: 'start' as const, timestamp: Math.max(0, now - (finalElapsed * 1000)) }];

        const updatedTask: ITimeTask = {
            ...task,
            completed: true,
            completedAt: now,
            enabled: false,
            pausedElapsed: finalElapsed,
            startTime: task.startTime || Math.max(0, now - (finalElapsed * 1000)),
            autoResumeAt: undefined,
            events: [...baseEvents, { type: 'complete', timestamp: now }],
        };

        setTasks((prev) => prev.map(t => t.id === id ? updatedTask : t));
        const saved = await persistTask(updatedTask);
        if (saved) {
            toast({
                variant: 'success',
                title: 'Task completed',
                description: `${formatElapsed(finalElapsed)} tracked.`,
            });
        }
    };

    const addMilestone = async (taskId: string) => {
        const text = newMilestone.trim();
        if (!text) return;
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        const now = Date.now();
        const milestone: Milestone = {
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            completed: false,
            createdAt: now,
            createdAtElapsed: Math.max(0, getElapsedSeconds(task, now)),
        };

        setNewMilestone('');
        const updatedTask: ITimeTask = {
            ...task,
            milestones: [...(task.milestones || []), milestone],
        };
        setTasks((prev) => prev.map(t => t.id === taskId ? updatedTask : t));
        await persistTask(updatedTask);
    };

    const toggleMilestone = async (taskId: string, milestoneId: string) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        const now = Date.now();
        const updatedTask: ITimeTask = {
            ...task,
            milestones: (task.milestones || []).map((milestone) =>
                milestone.id === milestoneId
                    ? {
                        ...milestone,
                        completed: !milestone.completed,
                        completedAt: !milestone.completed ? now : undefined,
                    }
                    : milestone
            ),
        };

        setTasks((prev) => prev.map(t => t.id === taskId ? updatedTask : t));
        await persistTask(updatedTask);
    };

    const deleteMilestone = async (taskId: string, milestoneId: string) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        const updatedTask: ITimeTask = {
            ...task,
            milestones: (task.milestones || []).filter((milestone) => milestone.id !== milestoneId),
        };

        setTasks((prev) => prev.map(t => t.id === taskId ? updatedTask : t));
        await persistTask(updatedTask);
    };

    const toggleTaskPrivacy = async (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        // Legacy tasks have `isPublic === undefined`; the UI already treats
        // that as public, so the first click must explicitly make it private.
        const updatedTask: ITimeTask = {
            ...task,
            isPublic: task.isPublic === false ? true : false,
        };

        setTasks((prev) => prev.map(t => t.id === id ? updatedTask : t));
        const saved = await persistTask(updatedTask);
        if (saved) {
            toast({
                variant: 'info',
                title: updatedTask.isPublic ? 'Task is now public' : 'Task is now private',
            });
        }
    };

    const setTargetTime = async (taskId: string) => {
        const hours = parseInt(targetHours) || 0;
        const minutes = parseInt(targetMinutes) || 0;
        const totalSeconds = (hours * 3600) + (minutes * 60);

        if (totalSeconds <= 0) return;

        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        const updatedTask: ITimeTask = { ...task, targetTime: totalSeconds };
        setTasks((prev) => prev.map(t => t.id === taskId ? updatedTask : t));
        setTargetHours('');
        setTargetMinutes('');
        const saved = await persistTask(updatedTask);
        if (saved) {
            toast({
                variant: 'success',
                title: 'Target updated',
                description: `Target set to ${formatElapsed(totalSeconds)}.`,
            });
        }
    };

    const getElapsedSeconds = useCallback((task: ITimeTask, now: number = Date.now()): number => {
        // If task is completed and has legacy `completedAt`, use total duration if no events
        if (task.completed && task.completedAt && (!task.events || task.events.length === 0)) {
            if (!task.startTime) return Math.max(0, task.pausedElapsed || 0);
            const completedTime = (task.completedAt - task.startTime) / 1000;
            return Math.floor(completedTime > 0 ? completedTime : task.pausedElapsed);
        }

        if (!task.events || task.events.length === 0) {
            // Legacy fallback
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
            if (ev.timestamp > now) break;

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

        if (isRunning && !task.completed) {
            totalMs += (now - lastStartTime);
        }

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

    const tasksReady = hasLoadedTasksOnce;
    const scoreReady = tasksReady && (status === 'unauthenticated' || hasLoadedProfileOnce);
    const activeTasks = useMemo(() => tasks.filter((task) => task.enabled && !task.completed && !task.cancelledAt).length, [tasks]);
    const pendingTasks = useMemo(
        () => tasks
            .filter((task) => !task.completed && !task.cancelledAt)
            .sort((a, b) => Number(b.enabled) - Number(a.enabled)),
        [tasks]
    );
    const cancelledTasks = useMemo(
        () => tasks
            .filter((task) => Boolean(task.cancelledAt) && !task.completed)
            .sort((a, b) => (b.cancelledAt || 0) - (a.cancelledAt || 0)),
        [tasks]
    );

    useEffect(() => {
        setSelectedTask((current) => {
            if (!current) return current;
            const latest = tasks.find((task) => task.id === current.id);
            if (!latest || latest.completed || latest.cancelledAt) return null;
            return latest;
        });
    }, [tasks]);
    const completedTasks = useMemo(() => {
        const getCompletedTimestamp = (task: ITimeTask): number => {
            if (typeof task.completedAt === 'number' && Number.isFinite(task.completedAt)) {
                return task.completedAt;
            }

            if (Array.isArray(task.events) && task.events.length > 0) {
                const completionEvent = [...task.events].reverse().find((event) => event.type === 'complete');
                if (completionEvent) return completionEvent.timestamp;
            }

            if (task.updatedAt) {
                const updatedAtTs = new Date(task.updatedAt).getTime();
                if (Number.isFinite(updatedAtTs)) return updatedAtTs;
            }

            if (task.createdAt) {
                const createdAtTs = new Date(task.createdAt).getTime();
                if (Number.isFinite(createdAtTs)) return createdAtTs;
            }

            return task.startTime || 0;
        };

        return tasks
            .filter((task) => task.completed)
            .sort((a, b) => getCompletedTimestamp(b) - getCompletedTimestamp(a));
    }, [tasks]);
    const completedTasksTotalPages = useMemo(
        () => Math.max(1, Math.ceil(completedTasks.length / COMPLETED_TASKS_PAGE_SIZE)),
        [completedTasks.length]
    );
    const paginatedCompletedTasks = useMemo(() => {
        const startIndex = (completedTasksPage - 1) * COMPLETED_TASKS_PAGE_SIZE;
        return completedTasks.slice(startIndex, startIndex + COMPLETED_TASKS_PAGE_SIZE);
    }, [completedTasks, completedTasksPage]);

    useEffect(() => {
        setCompletedTasksPage((prev) => Math.min(prev, completedTasksTotalPages));
    }, [completedTasksTotalPages]);

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />

            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full">
                <div className="mb-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 md:gap-4">
                        <div className="order-2 md:order-1">
                            <h1 className="text-3xl font-bold text-white mb-2">
                                iTime Tracker
                            </h1>
                            <p className="text-gray-400">
                                Track your tasks and manage your time effectively
                            </p>
                        </div>

                        <div className="order-1 md:order-2 self-start md:self-auto w-full md:w-auto flex justify-end md:block">

                            {/* User Info / Sign In Button */}
                            {status === 'loading' ? (
                                <div className="animate-pulse bg-black h-10 w-32 rounded-lg"></div>
                            ) : session ? (
                                <div className="flex items-center gap-3">
                                    <div className="text-right">
                                        <div className="text-sm font-medium text-white">{userProfile.username || session.user?.name || 'User'}</div>
                                    </div>
                                    {session.user?.image && (
                                        <img
                                            src={session.user.image}
                                            alt="Profile"
                                            className="rounded-full border-2 border-white/10 w-10 h-10 object-cover"
                                        />
                                    )}
                                    <LiquidButton
                                        onClick={() => { clearAllCache(); signOut(); }}
                                        className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
                                        variant="ghost"
                                    >
                                        Sign Out
                                    </LiquidButton>
                                </div>
                            ) : (
                                <LiquidButton
                                    onClick={() => setShowSignInModal(true)}
                                    className="px-6 py-2 text-sm font-bold"
                                >
                                    Sign In
                                </LiquidButton>
                            )}
                        </div>
                    </div>
                </div>

                <ITimeLiveStats
                    tasks={tasks}
                    tasksReady={tasksReady}
                    scoreReady={scoreReady}
                    isLightTheme={isLightTheme}
                    gamificationPoints={gamificationPoints}
                    gamificationPointsLastUpdatedAt={gamificationPointsLastUpdatedAt}
                    githubPointsHistory={githubPointsHistory}
                    chainPoints={chainPoints}
                    chainPointsHistory={chainPointsHistory}
                    activeTasks={activeTasks}
                    completedCount={completedTasks.length}
                    totalCount={tasks.filter((task) => !task.cancelledAt).length}
                />

                {/* Performance Chart */}
                <div className="mb-8 w-full max-w-none">
                    {scoreReady ? (
                        <PerformanceChart
                            tasks={tasks}
                            gamificationPoints={gamificationPoints}
                            gamificationPointsLastUpdatedAt={gamificationPointsLastUpdatedAt}
                            githubPointsHistory={githubPointsHistory}
                            chainPoints={chainPoints}
                            chainPointsHistory={chainPointsHistory}
                        />
                    ) : (
                        <div className={`h-[500px] rounded-2xl border p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                            <div className={`h-full w-full rounded-xl animate-pulse ${isLightTheme ? 'bg-black/5' : 'bg-white/5'}`} />
                        </div>
                    )}
                    <div className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>
                        <span>Score = task score + GitHub + chain − idle penalty</span>
                        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> positive day</span>
                        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /> negative day</span>
                    </div>
                </div>

                {saveError && (
                    <div className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                        <span>{saveError}</span>
                        <button
                            type="button"
                            onClick={() => setSaveError(null)}
                            className="shrink-0 text-red-400 hover:text-red-200"
                            aria-label="Dismiss error"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {status === 'unauthenticated' && (
                    <div className="mb-6 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        Guest mode: tasks are stored in this browser only. Sign in to sync them across devices.
                    </div>
                )}

                {/* Add Task Form */}
                <div className="bg-black  rounded-2xl border border-white/10 p-6 mb-8">
                    <h2 className="text-lg font-semibold text-white mb-4">Add New Task</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <input
                            type="text"
                            placeholder="Task title..."
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                        />
                        <input
                            type="text"
                            placeholder="Description..."
                            value={newDescription}
                            onChange={(e) => setNewDescription(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                        />
                    </div>
                    <LiquidButton
                        onClick={handleAddTask}
                        className="w-full md:w-auto px-6 py-3 text-sm font-bold text-white content-center"
                    >
                        + Add Task
                    </LiquidButton>

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                            Quick start
                        </span>
                        {[25, 50, 90].map((minutes) => (
                            <button
                                key={minutes}
                                type="button"
                                onClick={() => handleQuickStart(minutes)}
                                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white"
                                aria-label={`Start a ${minutes}-minute focus task`}
                            >
                                +{minutes}m
                            </button>
                        ))}
                        <span className="text-xs text-zinc-600">
                            {newTitle.trim() ? `Uses “${newTitle.trim()}”` : 'Creates a timed focus task'}
                        </span>
                    </div>
                </div>

                {/* Pending Tasks */}
                <div className="bg-black  rounded-2xl border border-white/10 p-6 mb-8">
                    <h2 className="text-lg font-semibold text-white mb-4">Active Tasks</h2>

                    {!tasksReady ? (
                        <div className="text-center py-12">
                            <div className="text-zinc-500 text-sm">Loading tasks...</div>
                        </div>
                    ) : pendingTasks.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="text-6xl mb-4">⏱️</div>
                            <div className="text-zinc-400 text-lg mb-2">No active tasks</div>
                            <div className="text-zinc-600 text-sm">Add your first task above to get started</div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {pendingTasks.map((task) => (
                                <div
                                    key={task.id}
                                    className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-4 space-y-3 transition-all group cursor-pointer"
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
                                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                                                {task.targetTime ? (
                                                    <span>Target {formatElapsed(task.targetTime)}</span>
                                                ) : null}
                                                {task.milestones && task.milestones.length > 0 ? (
                                                    <span>
                                                        {task.milestones.filter((milestone) => milestone.completed).length}/{task.milestones.length} milestones
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>
                                        <LiquidButton
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteTask(task.id);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-white"
                                            aria-label={`Delete ${task.title}`}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </LiquidButton>
                                    </div>

                                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
                                        <div className="flex items-center gap-2.5">
                                            {task.targetTime ? (
                                                <TargetRing elapsed={getElapsedSeconds(task)} target={task.targetTime} />
                                            ) : null}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">Worked</div>
                                                <div className="text-2xl font-mono font-bold text-white">
                                                    <LiveTimer task={task} getElapsedSeconds={getElapsedSeconds} formatElapsed={formatElapsed} />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            <LiquidButton
                                                size="sm"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleTaskPrivacy(task.id);
                                                }}
                                                className={`${task.isPublic !== false ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-400'} transition-colors`}
                                                title={task.isPublic !== false ? "Make Private" : "Make Public"}
                                                aria-label={task.isPublic !== false ? "Make task private" : "Make task public"}
                                            >
                                                {task.isPublic !== false ? (
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                                                    </svg>
                                                )}
                                            </LiquidButton>
                                            {task.enabled ? (
                                                <div className="relative">
                                                    {showPauseOptions === task.id ? (
                                                        <div
                                                            ref={pauseMenuRef}
                                                            className="absolute bottom-full right-0 mb-2 p-2 bg-zinc-900 border border-white/20 rounded-lg shadow-xl z-20 w-32 animate-in fade-in slide-in-from-bottom-2"
                                                        >
                                                            <div className="flex justify-between items-center mb-2 px-1">
                                                                <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Pause Timer</span>
                                                                <button onClick={(e) => { e.stopPropagation(); setShowPauseOptions(null); }} className="text-zinc-500 hover:text-white">
                                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                </button>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-1.5">
                                                                <LiquidButton size="sm" onClick={(e) => { e.stopPropagation(); toggleTask(task.id, 5); setShowPauseOptions(null); }} className="px-1 text-white text-xs w-full h-7 min-h-0 bg-white/5 hover:bg-white/10">5m</LiquidButton>
                                                                <LiquidButton size="sm" onClick={(e) => { e.stopPropagation(); toggleTask(task.id, 15); setShowPauseOptions(null); }} className="px-1 text-white text-xs w-full h-7 min-h-0 bg-white/5 hover:bg-white/10">15m</LiquidButton>
                                                                <LiquidButton size="sm" onClick={(e) => { e.stopPropagation(); toggleTask(task.id, 30); setShowPauseOptions(null); }} className="px-1 text-white text-xs w-full h-7 min-h-0 bg-white/5 hover:bg-white/10">30m</LiquidButton>
                                                                <LiquidButton size="sm" onClick={(e) => { e.stopPropagation(); toggleTask(task.id, 60); setShowPauseOptions(null); }} className="px-1 text-white text-xs w-full h-7 min-h-0 bg-white/5 hover:bg-white/10">1hr</LiquidButton>
                                                                <LiquidButton size="sm" onClick={(e) => { e.stopPropagation(); toggleTask(task.id); setShowPauseOptions(null); }} className="px-1 text-white text-xs w-full h-7 min-h-0 bg-white/5 hover:bg-white/10 col-span-2">Infinite</LiquidButton>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                    <LiquidButton
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setShowPauseOptions(task.id);
                                                        }}
                                                        className="text-zinc-400 hover:text-white transition-colors"
                                                        title="Pause Timer"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    </LiquidButton>
                                                </div>
                                            ) : (
                                                <LiquidButton
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleTask(task.id);
                                                        setShowPauseOptions(null);
                                                    }}
                                                    className="text-white transition-colors"
                                                    title="Resume Timer"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                </LiquidButton>
                                            )}
                                            <LiquidButton
                                                size="sm"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    completeTask(task.id);
                                                }}
                                                className="text-white ml-2"
                                                title="Mark as complete"
                                            >
                                                ✓
                                            </LiquidButton>
                                        </div>
                                    </div>
                                    {!task.enabled && (
                                        <LivePauseCountdown autoResumeAt={task.autoResumeAt} compact />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Cancelled Tasks (100h runtime safety cap) */}
                {cancelledTasks.length > 0 && (
                    <div className="bg-black rounded-2xl border border-red-500/20 p-6 mb-8">
                        <h2 className="text-lg font-semibold text-white mb-4">Cancelled Tasks</h2>
                        <p className="mb-4 text-sm text-zinc-500">
                            These tasks crossed the 100-hour runtime limit. They are excluded from your score; delete them when you no longer need the record.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {cancelledTasks.map((task) => (
                                <div key={task.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-4">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-white">{task.title}</div>
                                        <div className="mt-1 text-xs text-red-400">
                                            Auto-cancelled after 100h
                                        </div>
                                    </div>
                                    <LiquidButton
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => deleteTask(task.id)}
                                        className="shrink-0 text-zinc-500 hover:text-white"
                                        title="Delete cancelled task"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </LiquidButton>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Completed Tasks */}
                {completedTasks.length > 0 && (
                    <div className="bg-black  rounded-2xl border border-white/10 p-6">
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <h2 className="text-lg font-semibold text-white">Completed Tasks</h2>
                            <div className="flex items-center gap-2 flex-wrap">
                                {Array.from({ length: completedTasksTotalPages }, (_, idx) => idx + 1).map((pageNo) => (
                                    <LiquidButton
                                        key={pageNo}
                                        size="sm"
                                        onClick={() => setCompletedTasksPage(pageNo)}
                                        className={`min-w-[36px] px-3 ${completedTasksPage === pageNo
                                                ? 'text-white border-white/30 bg-white/10'
                                                : 'text-zinc-400 hover:text-white'
                                            }`}
                                    >
                                        {pageNo}
                                    </LiquidButton>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {paginatedCompletedTasks.map((task) => (
                                <div
                                    key={task.id}
                                    className="bg-white/5 border border-white/20 rounded-lg p-4 space-y-3 opacity-75"
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
                                            <LiquidButton
                                                size="sm"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleTaskPrivacy(task.id);
                                                }}
                                                className={`${task.isPublic !== false ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-400'} transition-colors`}
                                                title={task.isPublic !== false ? "Make Private" : "Make Public"}
                                                aria-label={task.isPublic !== false ? "Make task private" : "Make task public"}
                                            >
                                                {task.isPublic !== false ? (
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                                                    </svg>
                                                )}
                                            </LiquidButton>
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

            {/* Task Detail Modal - Full Screen */}
            {selectedTask && (
                <div
                    className="fixed inset-0 bg-black z-[80] overflow-y-auto"
                >
                    {/* Header */}
                    <div className="sticky top-0 z-10 bg-black  border-b border-white/10">
                        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 md:py-6">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                    <div className="flex flex-wrap items-center gap-3 mb-2">
                                        <h1 className="text-2xl md:text-4xl font-bold text-white break-words">
                                            {selectedTask.title}
                                        </h1>
                                        {!selectedTask.enabled && !selectedTask.completed && (
                                            <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
                                                Paused
                                            </span>
                                        )}
                                    </div>
                                    {selectedTask.description && (
                                        <p className="text-zinc-400 text-sm md:text-lg">
                                            {selectedTask.description}
                                        </p>
                                    )}
                                </div>
                                <button
                                    onClick={() => setSelectedTask(null)}
                                    className="text-zinc-500 hover:text-white transition-colors p-2"
                                >
                                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
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
                                        <div className="text-xs md:text-sm text-zinc-400 mb-2 md:mb-4 uppercase tracking-wide">Worked</div>
                                        <div className="text-6xl sm:text-7xl md:text-8xl font-mono font-bold mb-4 md:mb-8 tracking-tighter sm:tracking-normal text-white">
                                            <LiveTimer task={selectedTask} getElapsedSeconds={getElapsedSeconds} formatElapsed={formatElapsed} />
                                        </div>
                                        {!selectedTask.enabled && !selectedTask.completed && (
                                            <div className="mx-auto mb-6 max-w-sm text-left">
                                                <LivePauseCountdown autoResumeAt={selectedTask.autoResumeAt} />
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-4 justify-center items-center">
                                            {selectedTask.enabled ? (
                                                <div className="relative">
                                                    {showPauseOptions === selectedTask.id ? (
                                                        <div
                                                            ref={pauseMenuRef}
                                                            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 p-3 bg-zinc-900 border border-white/20 rounded-xl shadow-2xl z-50 w-48 animate-in fade-in slide-in-from-bottom-2"
                                                        >
                                                            <div className="flex justify-between items-center mb-3 px-1">
                                                                <span className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">Pause Timer</span>
                                                                <button onClick={(e) => { e.stopPropagation(); setShowPauseOptions(null); }} className="text-zinc-500 hover:text-white transition-colors">
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                </button>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <LiquidButton onClick={() => { toggleTask(selectedTask.id, 5); setShowPauseOptions(null); }} className="px-2 py-2 text-white text-sm bg-white/5 hover:bg-white/10 w-full">5m</LiquidButton>
                                                                <LiquidButton onClick={() => { toggleTask(selectedTask.id, 15); setShowPauseOptions(null); }} className="px-2 py-2 text-white text-sm bg-white/5 hover:bg-white/10 w-full">15m</LiquidButton>
                                                                <LiquidButton onClick={() => { toggleTask(selectedTask.id, 30); setShowPauseOptions(null); }} className="px-2 py-2 text-white text-sm bg-white/5 hover:bg-white/10 w-full">30m</LiquidButton>
                                                                <LiquidButton onClick={() => { toggleTask(selectedTask.id, 60); setShowPauseOptions(null); }} className="px-2 py-2 text-white text-sm bg-white/5 hover:bg-white/10 w-full">1hr</LiquidButton>
                                                                <LiquidButton onClick={() => { toggleTask(selectedTask.id); setShowPauseOptions(null); }} className="px-2 py-2 text-white text-sm bg-white/5 hover:bg-white/10 w-full col-span-2">Infinite</LiquidButton>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                    <LiquidButton
                                                        onClick={() => setShowPauseOptions(selectedTask.id)}
                                                        className="w-40 text-base font-bold transition-all text-white"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                            <span>Pause Option</span>
                                                        </div>
                                                    </LiquidButton>
                                                </div>
                                            ) : (
                                                <LiquidButton
                                                    onClick={() => { toggleTask(selectedTask.id); setShowPauseOptions(null); }}
                                                    className="w-40 text-base font-bold transition-all text-white"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                        <span>Resume</span>
                                                    </div>
                                                </LiquidButton>
                                            )}
                                            <LiquidButton
                                                onClick={() => {
                                                    completeTask(selectedTask.id);
                                                    setSelectedTask(null);
                                                }}
                                                className="w-40 text-base font-bold text-white shrink-0"
                                            >
                                                ✓ Complete
                                            </LiquidButton>
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

                                {/* Target Time */}
                                <div className="bg-black  rounded-2xl border border-white/10 p-8">
                                    <h3 className="text-xl font-semibold text-white mb-4">Set Target Time</h3>
                                    <div className="flex gap-3">
                                        <div className="flex-1">
                                            <label className="block text-xs text-zinc-400 mb-2">Hours</label>
                                            <input
                                                type="number"
                                                placeholder="0"
                                                value={targetHours}
                                                onChange={(e) => setTargetHours(e.target.value)}
                                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-lg text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all text-center"
                                                min="0"
                                            />
                                        </div>
                                        <div className="flex items-end pb-3 text-2xl text-zinc-600">:</div>
                                        <div className="flex-1">
                                            <label className="block text-xs text-zinc-400 mb-2">Minutes</label>
                                            <input
                                                type="number"
                                                placeholder="0"
                                                value={targetMinutes}
                                                onChange={(e) => setTargetMinutes(e.target.value)}
                                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-lg text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all text-center"
                                                min="0"
                                                max="59"
                                            />
                                        </div>
                                        <LiquidButton
                                            onClick={() => setTargetTime(selectedTask.id)}
                                            className="px-6 py-3 text-sm font-bold self-end text-white"
                                        >
                                            Set
                                        </LiquidButton>
                                    </div>
                                </div>
                            </div>

                            {/* Right Column - Vertical Timeline */}
                            <div className="bg-black  rounded-2xl border border-white/10 p-8">
                                <h3 className="text-xl font-semibold text-white mb-6">Milestones</h3>

                                {/* Add Milestone */}
                                <div className="flex gap-3 mb-8">
                                    <input
                                        type="text"
                                        placeholder="Add a milestone..."
                                        value={newMilestone}
                                        onChange={(e) => setNewMilestone(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && addMilestone(selectedTask.id)}
                                        className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                                    />
                                    <LiquidButton
                                        onClick={() => addMilestone(selectedTask.id)}
                                        className="px-6 py-3 text-sm font-bold text-white"
                                    >
                                        Add
                                    </LiquidButton>
                                </div>

                                {/* Vertical Timeline */}
                                <div className="relative">
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
                                                        <button
                                                            onClick={() => toggleMilestone(selectedTask.id, milestone.id)}
                                                            className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center ${milestone.completed
                                                                ? 'bg-white text-black border-white/50 shadow-lg shadow-white/20'
                                                                : 'bg-black border-white/30 hover:border-white/50 hover:bg-white/5'
                                                                }`}
                                                        >
                                                            {milestone.completed && (
                                                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </button>

                                                        {/* Content */}
                                                        <div className="flex-1 pt-1">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className={`flex-1 text-base font-medium ${milestone.completed
                                                                    ? 'text-zinc-500 line-through'
                                                                    : 'text-white'
                                                                    }`}>
                                                                    {milestone.text}
                                                                </div>
                                                                <button
                                                                    onClick={() => deleteMilestone(selectedTask.id, milestone.id)}
                                                                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-white p-1 -mt-1"
                                                                    title="Delete milestone"
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                                    </svg>
                                                                </button>
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
                                            <div className="text-6xl mb-4">📝</div>
                                            <div className="text-zinc-400 text-base mb-2">No milestones yet</div>
                                            <div className="text-zinc-600 text-sm">Add milestones to track your progress</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }

            {/* Sign In Modal */}
            <SignInModal
                isOpen={showSignInModal}
                onClose={() => setShowSignInModal(false)}
            />
        </div >
    );
}
