import {
    getScoreAtTime,
    type ChainPointsSnapshot,
    type GithubPointsSnapshot,
    type ScoreTask,
} from './score';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface WidgetTaskInput {
    title?: string;
    startTime?: number;
    pausedElapsed?: number;
    enabled?: boolean;
    completed?: boolean;
    completedAt?: number;
    cancelledAt?: number;
    events?: Array<{ type?: string; timestamp?: number }>;
}

export interface WidgetRunningTask {
    title: string;
    elapsedSeconds: number;
    startedAt: number | null;
}

export interface WidgetSnapshot {
    username: string;
    score: number;
    focusTodaySeconds: number;
    runningCount: number;
    running: WidgetRunningTask[];
    updatedAt: string;
    updatedAtMs: number;
}

interface ElapsedState {
    elapsedSeconds: number;
    segmentStartedAt: number | null;
    running: boolean;
}

export function istDayStart(now: number): number {
    const ist = new Date(now + IST_OFFSET_MS);
    return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
}

function normalizedEvents(task: WidgetTaskInput) {
    return (task.events || [])
        .filter((event) => event && typeof event.timestamp === 'number' && Number.isFinite(event.timestamp))
        .map((event) => ({
            type: event.type === 'start' || event.type === 'pause' || event.type === 'complete'
                ? event.type
                : 'pause',
            timestamp: event.timestamp as number,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
}

export function elapsedStateAt(task: WidgetTaskInput, now: number): ElapsedState {
    if (task.cancelledAt || task.completed) {
        return { elapsedSeconds: 0, segmentStartedAt: null, running: false };
    }

    const events = normalizedEvents(task);
    if (events.length === 0) {
        const paused = Math.max(0, Math.floor(task.pausedElapsed || 0));
        const start = task.startTime || now;
        if (!task.enabled) {
            return { elapsedSeconds: paused, segmentStartedAt: null, running: false };
        }
        const extra = Math.max(0, Math.floor((now - start) / 1000));
        return { elapsedSeconds: paused + extra, segmentStartedAt: start, running: true };
    }

    let running = false;
    let lastStart = 0;
    let elapsedMs = 0;
    for (const event of events) {
        if (event.timestamp > now) break;
        if (event.type === 'start') {
            if (!running) {
                running = true;
                lastStart = event.timestamp;
            }
        } else if (running) {
            elapsedMs += event.timestamp - lastStart;
            running = false;
        }
    }

    if (events[0]?.type !== 'start' && (task.pausedElapsed || 0) > 0) {
        elapsedMs += (task.pausedElapsed || 0) * 1000;
    }

    if (running && task.enabled !== false) {
        elapsedMs += Math.max(0, now - lastStart);
        return {
            elapsedSeconds: Math.max(0, Math.floor(elapsedMs / 1000)),
            segmentStartedAt: lastStart,
            running: true,
        };
    }

    return {
        elapsedSeconds: Math.max(0, Math.floor(elapsedMs / 1000)),
        segmentStartedAt: null,
        running: false,
    };
}

function activeIntervals(task: WidgetTaskInput, now: number): Array<{ start: number; end: number }> {
    const events = normalizedEvents(task);
    if (events.length === 0) {
        const start = task.startTime;
        if (!start) return [];
        const end = task.completedAt
            || (task.enabled && !task.cancelledAt ? now : start + (task.pausedElapsed || 0) * 1000);
        return end > start ? [{ start, end: Math.min(end, now) }] : [];
    }

    const intervals: Array<{ start: number; end: number }> = [];
    let running = false;
    let lastStart = 0;
    for (const event of events) {
        if (event.timestamp > now) break;
        if (event.type === 'start') {
            if (!running) {
                running = true;
                lastStart = event.timestamp;
            }
        } else if (running) {
            intervals.push({ start: lastStart, end: event.timestamp });
            running = false;
        }
    }
    if (running && task.enabled !== false && !task.completed && !task.cancelledAt) {
        intervals.push({ start: lastStart, end: now });
    }
    return intervals;
}

export function focusTodaySeconds(tasks: WidgetTaskInput[], now: number): number {
    const todayStart = istDayStart(now);
    let seconds = 0;
    for (const task of tasks) {
        for (const interval of activeIntervals(task, now)) {
            const start = Math.max(interval.start, todayStart);
            const end = Math.min(interval.end, now);
            if (end > start) seconds += (end - start) / 1000;
        }
    }
    return Math.max(0, Math.floor(seconds));
}

export function buildWidgetSnapshot(input: {
    username?: string | null;
    tasks: WidgetTaskInput[];
    now?: number;
    points?: number;
    githubPointsLastUpdatedAt?: Date | string | number | null;
    githubPointsHistory?: GithubPointsSnapshot[] | null;
    chainPoints?: number;
    chainPointsHistory?: ChainPointsSnapshot[] | null;
}): WidgetSnapshot {
    const now = input.now || Date.now();
    const running = input.tasks
        .map((task) => {
            const state = elapsedStateAt(task, now);
            if (!state.running) return null;
            return {
                title: (task.title || 'Untitled task').slice(0, 80),
                elapsedSeconds: state.elapsedSeconds,
                startedAt: state.segmentStartedAt,
            };
        })
        .filter((task): task is WidgetRunningTask => Boolean(task))
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

    const scoreTasks: ScoreTask[] = input.tasks.map((task) => ({
        events: normalizedEvents(task).filter(
            (event): event is { type: 'start' | 'pause' | 'complete'; timestamp: number } =>
                event.type === 'start' || event.type === 'pause' || event.type === 'complete'
        ),
        startTime: task.startTime || 0,
        pausedElapsed: task.pausedElapsed || 0,
        enabled: Boolean(task.enabled),
        completed: Boolean(task.completed),
        completedAt: task.completedAt,
        cancelledAt: task.cancelledAt,
    }));

    const score = getScoreAtTime(
        scoreTasks,
        now,
        input.points || 0,
        input.githubPointsLastUpdatedAt || null,
        input.githubPointsHistory || null,
        input.chainPoints || 0,
        input.chainPointsHistory || null
    );

    return {
        username: input.username || 'infinWORK',
        score,
        focusTodaySeconds: focusTodaySeconds(input.tasks, now),
        runningCount: running.length,
        running: running.slice(0, 3),
        updatedAt: new Date(now).toISOString(),
        updatedAtMs: now,
    };
}
