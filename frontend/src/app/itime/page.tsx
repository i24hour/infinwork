'use client';

import { Sidebar } from '@/components/Sidebar';
import { SignInModal } from '@/components/SignInModal';
import { useSession, signIn, signOut } from 'next-auth/react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { getScoreAtTime, type GithubPointsSnapshot, type ChainPointsSnapshot, type FocusPointsSnapshot } from '@/lib/score';

const PerformanceChart = dynamic(
    () => import('@/components/PerformanceChart').then(mod => mod.PerformanceChart),
    { ssr: false, loading: () => <div className="h-[500px] bg-black rounded-2xl border border-white/10 flex items-center justify-center text-zinc-500">Loading chart...</div> }
);
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LiveTimer, LiveTotalTimer } from '@/components/LiveTimer';

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

export default function ITimePage() {
    const { data: session, status } = useSession();
    const [tasks, setTasks] = useState<ITimeTask[]>([]);
    const [hasLoadedTasksOnce, setHasLoadedTasksOnce] = useState(false);
    const [hasLoadedProfileOnce, setHasLoadedProfileOnce] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [selectedTask, setSelectedTask] = useState<ITimeTask | null>(null);
    const [newMilestone, setNewMilestone] = useState('');
    const [targetHours, setTargetHours] = useState('');
    const [targetMinutes, setTargetMinutes] = useState('');
    const [showSignInModal, setShowSignInModal] = useState(false);
    const [showPauseOptions, setShowPauseOptions] = useState<string | null>(null);
    const [completedTasksPage, setCompletedTasksPage] = useState(1);
    const [scoreNow, setScoreNow] = useState<number>(() => Date.now());
    const [isLightTheme, setIsLightTheme] = useState(false);

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

    // Fetch tasks from MongoDB for authenticated users
    const fetchTasks = useCallback(async () => {
        if (status === 'loading') return;

        if (status === 'authenticated') {
            try {
                const response = await fetch('/api/itime');
                if (response.ok) {
                    const data = await response.json() as {
                        tasks?: Array<Omit<ITimeTask, 'id'> & { id?: string }>;
                    };
                    setTasks((data.tasks ?? []).map((task) => ({
                        ...task,
                        id: task._id ?? task.id ?? '',
                    })));

                    // If user has a specific image in their session/tasks, we can handle it here if needed
                    // For now, the image is managed via /api/user/profile and updateSession
                }
            } catch (error) {
                console.error('Failed to fetch tasks:', error);
            } finally {
                setHasLoadedTasksOnce(true);
            }
        } else {
            // Load from localStorage for guest users
            if (typeof window !== 'undefined') {
                const saved = localStorage.getItem('itime_tasks');
                setTasks(saved ? JSON.parse(saved) : []);
            }
            setHasLoadedTasksOnce(true);
        }
    }, [status]);

    const pauseMenuRef = useRef<HTMLDivElement>(null);

    const [userProfile, setUserProfile] = useState<{ username?: string; image?: string }>({});
    const [gamificationPoints, setGamificationPoints] = useState(0);
    const [gamificationPointsLastUpdatedAt, setGamificationPointsLastUpdatedAt] = useState<string | null>(null);
    const [githubPointsHistory, setGithubPointsHistory] = useState<GithubPointsSnapshot[] | null>(null);
    const [chainPoints, setChainPoints] = useState(0);
    const [chainPointsHistory, setChainPointsHistory] = useState<ChainPointsSnapshot[] | null>(null);
    const [focusScore, setFocusScore] = useState(0);
    const [focusBonusPoints, setFocusBonusPoints] = useState(0);
    const [focusPointsHistory, setFocusPointsHistory] = useState<FocusPointsSnapshot[] | null>(null);

    const fetchUserProfile = useCallback(async () => {
        try {
            const res = await fetch('/api/user/settings');
            const data = await res.json();
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
            setFocusScore(data.focusScore || 0);
            setFocusBonusPoints(data.focusBonusPoints || 0);
            setFocusPointsHistory(Array.isArray(data.focusScoreHistory)
                ? data.focusScoreHistory.map((entry: { timestamp: Date | string | number; bonusPoints: number }) => ({ timestamp: entry.timestamp, points: entry.bonusPoints }))
                : null);
        } catch (err) {
            console.error('Error fetching profile:', err);
        } finally {
            setHasLoadedProfileOnce(true);
        }
    }, []);

    // Initial load
    useEffect(() => {
        if (status === 'loading') return;

        setHasLoadedTasksOnce(false);
        setHasLoadedProfileOnce(status !== 'authenticated');
        if (status !== 'authenticated') {
            setGamificationPoints(0);
            setGamificationPointsLastUpdatedAt(null);
            setGithubPointsHistory(null);
            setChainPoints(0);
            setChainPointsHistory(null);
            setFocusScore(0);
            setFocusBonusPoints(0);
            setFocusPointsHistory(null);
        }
        fetchTasks();
        if (status === 'authenticated' && session?.user?.email) {
            fetchUserProfile();
        }
    }, [fetchTasks, fetchUserProfile, session?.user?.email, status]);

    useEffect(() => {
        if (status !== 'authenticated' || !session?.user?.email) return;

        const interval = setInterval(() => {
            fetchUserProfile();
        }, 15000);

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

    // Previous Timer Interval removed - now handled by LiveTimer components

    useEffect(() => {
        const scoreTimer = setInterval(() => {
            setScoreNow(Date.now());
        }, 1000);

        return () => clearInterval(scoreTimer);
    }, []);

    // Save tasks - MongoDB for authenticated, localStorage for guest
    useEffect(() => {
        if (!hasLoadedTasksOnce) return;

        if (status === 'unauthenticated' && typeof window !== 'undefined') {
            // Guest mode - save to localStorage
            localStorage.setItem('itime_tasks', JSON.stringify(tasks));
        }
    }, [tasks, status, hasLoadedTasksOnce]);

    const handleAddTask = async () => {
        if (!newTitle.trim()) return;

        // DEBUG: Log authentication status
        console.log('🔐 Auth Status:', { status, session });

        // Check if user is authenticated (block if loading or unauthenticated)
        if (status === 'loading') {
            console.log('⏳ Session loading, please wait...');
            return;
        }

        if (status === 'unauthenticated') {
            console.log('❌ Not authenticated - showing sign in modal');
            setShowSignInModal(true);
            return;
        }

        console.log('✅ Authenticated - adding task');
        const newTask: ITimeTask = {
            id: Date.now().toString(),
            title: newTitle,
            description: newDescription,
            startTime: Date.now(),
            pausedElapsed: 0,
            enabled: true,
            completed: false,
            isPublic: true,
            milestones: [],
            events: [{ type: 'start', timestamp: Date.now() }],
        };

        try {
            // Save to MongoDB
            const response = await fetch('/api/itime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTask),
            });

            if (response.ok) {
                const { task } = await response.json();
                setTasks([...tasks, { ...task, id: task._id }]);
                setNewTitle('');
                setNewDescription('');
            } else {
                console.error('Failed to save task');
            }
        } catch (error) {
            console.error('Error saving task:', error);
        }
    };

    const toggleTask = async (id: string, breakMinutes?: number) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        const currentElapsed = task.enabled ? getElapsedSeconds(task) : task.pausedElapsed;
        const now = Date.now();
        const updatedTask = {
            ...task,
            enabled: !task.enabled,
            pausedElapsed: currentElapsed,
            startTime: !task.enabled ? now : 0,
            autoResumeAt: (!task.enabled) ? undefined : (breakMinutes ? now + (breakMinutes * 60000) : undefined),
            events: [...(task.events || []), {
                type: (!task.enabled ? 'start' : 'pause') as 'start' | 'pause' | 'complete',
                timestamp: now
            }]
        };

        setTasks((prev) => prev.map(t => t.id === id ? updatedTask : t));

        if (status === 'authenticated' && task._id) {
            try {
                await fetch('/api/itime', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ _id: task._id, ...updatedTask }),
                });
            } catch (error) {
                console.error('Error updating task:', error);
            }
        }
    };

    const resumeTaskFromBreak = useCallback(async (id: string) => {
        playAlertSound();
        setTasks(prev => {
            const task = prev.find(t => t.id === id);
            if (!task || task.enabled) return prev;

            const now = Date.now();
            const updatedTask = {
                ...task,
                enabled: true,
                autoResumeAt: undefined,
                startTime: now,
                events: [...(task.events || []), {
                    type: 'start' as const,
                    timestamp: now
                }]
            };

            // Fire and forget API call
            if (status === 'authenticated' && task._id) {
                fetch('/api/itime', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ _id: task._id, ...updatedTask }),
                }).catch(e => console.error(e));
            }

            return prev.map(t => t.id === id ? updatedTask : t);
        });
    }, [status]);

    useEffect(() => {
        const activeBreaks = tasks.filter(t => !t.enabled && t.autoResumeAt);
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
        setTasks((prev) => prev.filter((t) => t.id !== id));

        if (status === 'authenticated' && task?._id) {
            try {
                await fetch(`/api/itime?id=${task._id}`, {
                    method: 'DELETE',
                });
            } catch (error) {
                console.error('Error deleting task:', error);
            }
        }
    };

    const completeTask = async (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        const finalElapsed = getElapsedSeconds(task);
        const updatedTask = {
            ...task,
            completed: true,
            completedAt: Date.now(),
            enabled: false,
            pausedElapsed: finalElapsed,
            startTime: 0,
            events: [...(task.events || []), { type: 'complete', timestamp: Date.now() } as const]
        };

        setTasks((prev) => prev.map(t => t.id === id ? updatedTask : t));

        if (status === 'authenticated' && task._id) {
            try {
                await fetch('/api/itime', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ _id: task._id, ...updatedTask }),
                });
            } catch (error) {
                console.error('Error completing task:', error);
            }
        }
    };

    const addMilestone = (taskId: string) => {
        if (!newMilestone.trim()) return;
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        setTasks((prev) =>
            prev.map((task) => {
                if (task.id !== taskId) return task;
                const milestone: Milestone = {
                    id: Date.now().toString(),
                    text: newMilestone,
                    completed: false,
                    createdAt: Date.now(),
                    createdAtElapsed: getElapsedSeconds(task),
                };
                return {
                    ...task,
                    milestones: [...(task.milestones || []), milestone],
                };
            })
        );
        setNewMilestone('');
    };

    const toggleMilestone = (taskId: string, milestoneId: string) => {
        setTasks((prev) =>
            prev.map((task) => {
                if (task.id !== taskId) return task;
                return {
                    ...task,
                    milestones: task.milestones?.map((m) =>
                        m.id === milestoneId
                            ? { ...m, completed: !m.completed, completedAt: !m.completed ? Date.now() : undefined }
                            : m
                    ),
                };
            })
        );
    };

    const deleteMilestone = (taskId: string, milestoneId: string) => {
        setTasks((prev) =>
            prev.map((task) => {
                if (task.id !== taskId) return task;
                return {
                    ...task,
                    milestones: task.milestones?.filter((m) => m.id !== milestoneId),
                };
            })
        );
    };

    const toggleTaskPrivacy = async (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        const updatedTask = {
            ...task,
            isPublic: !task.isPublic,
        };

        setTasks((prev) => prev.map(t => t.id === id ? updatedTask : t));

        if (status === 'authenticated' && task._id) {
            try {
                await fetch('/api/itime', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ _id: task._id, isPublic: updatedTask.isPublic }),
                });
            } catch (error) {
                console.error('Error updating task privacy:', error);
            }
        }
    };

    const setTargetTime = (taskId: string) => {
        const hours = parseInt(targetHours) || 0;
        const minutes = parseInt(targetMinutes) || 0;
        const totalSeconds = (hours * 3600) + (minutes * 60);

        if (totalSeconds <= 0) return;

        setTasks((prev) =>
            prev.map((task) =>
                task.id === taskId ? { ...task, targetTime: totalSeconds } : task
            )
        );
        setTargetHours('');
        setTargetMinutes('');
    };

    const getElapsedSeconds = useCallback((task: ITimeTask, now: number = Date.now()): number => {
        // If task is completed and has legacy `completedAt`, use total duration if no events
        if (task.completed && task.completedAt && (!task.events || task.events.length === 0)) {
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

    const tasksReady = status !== 'loading' && hasLoadedTasksOnce;
    const scoreReady = tasksReady && (status !== 'authenticated' || hasLoadedProfileOnce);
    const totalTime = useMemo(() => tasks.reduce((sum, task) => sum + getElapsedSeconds(task), 0), [tasks, getElapsedSeconds]);
    const liveScore = useMemo<number | null>(
        () => scoreReady
            ? getScoreAtTime(tasks, scoreNow, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory, focusScore, focusBonusPoints, focusPointsHistory)
            : null,
        [scoreReady, tasks, scoreNow, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory, focusScore, focusBonusPoints, focusPointsHistory]
    );
    const liveScoreColorClass = liveScore !== null && liveScore < 0 ? 'text-red-500' : 'text-[#4CAF50]';
    const activeTasks = useMemo(() => tasks.filter((task) => task.enabled && !task.completed && !task.cancelledAt).length, [tasks]);
    const pendingTasks = useMemo(
        () => tasks
            .filter((task) => !task.completed && !task.cancelledAt)
            .sort((a, b) => Number(b.enabled) - Number(a.enabled)),
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
                                        onClick={() => signOut()}
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

                <div className={`mb-8 rounded-2xl border p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                    <div>
                        <div className={`text-sm ${isLightTheme ? 'text-zinc-700' : 'text-zinc-400'}`}>AI Focus Score</div>
                        <div className="text-3xl font-bold text-emerald-400">{Math.round(focusScore)}<span className="text-sm text-zinc-500">/100</span></div>
                    </div>
                    <div className="text-sm text-zinc-500">Focus bonus currently adds <span className="text-blue-400 font-semibold">+{Math.round(focusBonusPoints)} points</span>. Configure monitoring in Settings.</div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
                    <div className={`rounded-2xl border p-4 md:p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                        <div className={`text-sm mb-2 ${isLightTheme ? 'text-zinc-700' : 'text-gray-400'}`}>Total Tasks</div>
                        <div className={`text-2xl md:text-4xl font-bold ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                            {tasksReady ? tasks.length : <span className={`inline-block h-8 md:h-10 w-14 animate-pulse rounded ${isLightTheme ? 'bg-black/10' : 'bg-white/10'}`} />}
                        </div>
                    </div>

                    <div className={`rounded-2xl border p-4 md:p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                        <div className={`text-sm mb-2 ${isLightTheme ? 'text-zinc-700' : 'text-zinc-300'}`}>Running</div>
                        <div className={`text-2xl md:text-4xl font-bold ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                            {tasksReady ? activeTasks : <span className={`inline-block h-8 md:h-10 w-14 animate-pulse rounded ${isLightTheme ? 'bg-black/10' : 'bg-white/10'}`} />}
                        </div>
                    </div>

                    <div className={`rounded-2xl border p-4 md:p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                        <div className={`text-sm mb-2 ${isLightTheme ? 'text-zinc-700' : 'text-zinc-300'}`}>Completed</div>
                        <div className={`text-2xl md:text-4xl font-bold ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>
                            {tasksReady ? completedTasks.length : <span className={`inline-block h-8 md:h-10 w-14 animate-pulse rounded ${isLightTheme ? 'bg-black/10' : 'bg-white/10'}`} />}
                        </div>
                    </div>

                    <div className={`rounded-2xl border p-4 md:p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                        <div className={`text-sm mb-2 ${isLightTheme ? 'text-zinc-700' : 'text-zinc-300'}`}>Live Score</div>
                        <div className={`text-2xl md:text-4xl font-bold ${liveScoreColorClass}`}>
                            {scoreReady && liveScore !== null
                                ? liveScore.toFixed(2)
                                : <span className={`inline-block h-8 md:h-10 w-28 animate-pulse rounded ${isLightTheme ? 'bg-black/10' : 'bg-white/10'}`} />}
                        </div>
                    </div>
                </div>

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
                            focusScore={focusScore}
                            focusBonusPoints={focusBonusPoints}
                            focusPointsHistory={focusPointsHistory}
                        />
                    ) : (
                        <div className={`h-[500px] rounded-2xl border p-6 ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-black border-white/10'}`}>
                            <div className={`h-full w-full rounded-xl animate-pulse ${isLightTheme ? 'bg-black/5' : 'bg-white/5'}`} />
                        </div>
                    )}
                </div>

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
                                        </div>
                                        <LiquidButton
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteTask(task.id);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-white"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </LiquidButton>
                                    </div>

                                    <div className="flex items-center justify-between pt-2 border-t border-white/10">
                                        <div className={`text-2xl font-mono font-bold ${task.enabled ? 'text-white' : 'text-zinc-500'}`}>
                                            <LiveTimer task={task} getElapsedSeconds={getElapsedSeconds} formatElapsed={formatElapsed} />
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
                                                <div className="flex flex-col items-end gap-1">
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
                                                    {task.autoResumeAt && (
                                                        <span className="text-[10px] text-zinc-500 -mt-1 block">
                                                            {new Date(task.autoResumeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    )}
                                                </div>
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
                                </div>
                            ))}
                        </div>
                    )}
                </div>

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
                                        <div className="text-xs md:text-sm text-zinc-400 mb-2 md:mb-4 uppercase tracking-wide">Current Time</div>
                                        <div className={`text-6xl sm:text-7xl md:text-8xl font-mono font-bold mb-4 md:mb-8 tracking-tighter sm:tracking-normal ${selectedTask.enabled ? 'text-white' : 'text-zinc-500'}`}>
                                            <LiveTimer task={selectedTask} getElapsedSeconds={getElapsedSeconds} formatElapsed={formatElapsed} />
                                        </div>
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
                                                <div className="flex flex-col items-center gap-1 relative">
                                                    <LiquidButton
                                                        onClick={() => { toggleTask(selectedTask.id); setShowPauseOptions(null); }}
                                                        className="w-40 text-base font-bold transition-all text-zinc-300"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                            <span>Resume</span>
                                                        </div>
                                                    </LiquidButton>
                                                    {selectedTask.autoResumeAt && (
                                                        <span className="text-xs text-zinc-500 absolute -bottom-5 w-max">
                                                            Resumes at {new Date(selectedTask.autoResumeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    )}
                                                </div>
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
