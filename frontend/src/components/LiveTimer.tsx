'use client';

import { useState, useEffect } from 'react';

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
    targetTime?: number;
    events?: Array<{
        type: 'start' | 'pause' | 'complete';
        timestamp: number;
    }>;
}

interface LiveTimerProps {
    task: ITimeTask;
    getElapsedSeconds: (task: ITimeTask, currentTime: number) => number;
    formatElapsed: (seconds: number) => string;
}

export function LiveTimer({ task, getElapsedSeconds, formatElapsed }: LiveTimerProps) {
    const [currentTime, setCurrentTime] = useState(() => Date.now());

    useEffect(() => {
        // Only run the timer if the task is currently active (running)
        if (!task.enabled || task.completed) return;

        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);

        return () => clearInterval(interval);
    }, [task.enabled, task.completed]);

    return (
        <span className="font-mono">
            {formatElapsed(getElapsedSeconds(task, currentTime))}
        </span>
    );
}

// A simpler global stat timer that just ticks up total numbers
export function LiveTotalTimer({
    tasks,
    getElapsedSeconds,
    formatElapsed,
    className = ""
}: {
    tasks: ITimeTask[],
    getElapsedSeconds: (task: ITimeTask, currentTime: number) => number,
    formatElapsed: (seconds: number) => string,
    className?: string
}) {
    const [currentTime, setCurrentTime] = useState(() => Date.now());

    const hasRunningTasks = tasks.some(t => t.enabled && !t.completed);

    useEffect(() => {
        // Only tick if there's actually a running task
        if (!hasRunningTasks) return;

        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);

        return () => clearInterval(interval);
    }, [hasRunningTasks]);

    const totalTime = tasks.reduce((sum, task) => sum + getElapsedSeconds(task, currentTime), 0);

    return (
        <span className={`font-mono ${className}`}>
            {formatElapsed(totalTime)}
        </span>
    );
}

function formatCountdown(totalSeconds: number) {
    const safe = Math.max(0, totalSeconds);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    if (h > 0) {
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function LivePauseCountdown({
    autoResumeAt,
    compact = false,
}: {
    autoResumeAt?: number;
    compact?: boolean;
}) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!autoResumeAt) return;
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [autoResumeAt]);

    if (!autoResumeAt) {
        return (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Paused</p>
                <p className="text-sm text-zinc-300">No auto-resume — tap play to continue</p>
            </div>
        );
    }

    const remainingSeconds = Math.max(0, Math.ceil((autoResumeAt - now) / 1000));
    const resumeLabel = new Date(autoResumeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <div className={`rounded-lg border border-amber-500/25 bg-amber-500/10 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Break remaining</p>
            <p className={`font-mono font-bold tabular-nums text-amber-300 ${compact ? 'text-2xl' : 'text-4xl'}`}>
                {formatCountdown(remainingSeconds)}
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">Resumes at {resumeLabel}</p>
        </div>
    );
}
