export interface ScoreEvent {
    type: 'start' | 'pause' | 'complete';
    timestamp: number;
}

export interface ScoreTask {
    events?: ScoreEvent[];
    startTime: number;
    pausedElapsed: number;
    enabled: boolean;
    completed: boolean;
    completedAt?: number;
}

export interface ScoreBreakdown {
    baseScore: number;
    idlePenalty: number;
    penalizedBaseScore: number;
    githubPoints: number;
    chainPoints: number;
    totalScore: number;
}

export interface BonusPointsSnapshot {
    timestamp: Date | string | number;
    points: number;
}

export type GithubPointsSnapshot = BonusPointsSnapshot;
export type ChainPointsSnapshot = BonusPointsSnapshot;

interface NormalizedSnapshot {
    timestamp: number;
    points: number;
}

const normalizedHistoryCache = new WeakMap<readonly BonusPointsSnapshot[], NormalizedSnapshot[]>();
const syntheticEventsCache = new WeakMap<ScoreTask, ScoreEvent[]>();
const actualCompletedAtCache = new WeakMap<ScoreTask, number | undefined>();

function roundScore(value: number): number {
    return Math.round(value * 100) / 100;
}

function getActualCompletedAt(task: ScoreTask): number | undefined {
    if (actualCompletedAtCache.has(task)) {
        return actualCompletedAtCache.get(task);
    }

    let actualCompletedAt = task.completedAt;
    if (!actualCompletedAt && task.events?.length) {
        for (let i = task.events.length - 1; i >= 0; i--) {
            if (task.events[i].type === 'complete') {
                actualCompletedAt = task.events[i].timestamp;
                break;
            }
        }
    }
    if (task.completed && !actualCompletedAt && (!task.events || task.events.length === 0)) {
        actualCompletedAt = task.startTime + (task.pausedElapsed * 1000);
    }

    actualCompletedAtCache.set(task, actualCompletedAt);
    return actualCompletedAt;
}

function getSyntheticEvents(task: ScoreTask): ScoreEvent[] | null {
    if (!task.events || task.events.length === 0) {
        return null;
    }

    const cached = syntheticEventsCache.get(task);
    if (cached) {
        return cached;
    }

    let syntheticEvents: ScoreEvent[];
    if (task.events[0].type !== 'start' && task.startTime && task.startTime < task.events[0].timestamp) {
        syntheticEvents = [{ type: 'start', timestamp: task.startTime }, ...task.events];
    } else {
        syntheticEvents = task.events;
    }

    syntheticEventsCache.set(task, syntheticEvents);
    return syntheticEvents;
}

export function computeBaseScore(tasks: ScoreTask[], t: number): number {
    let totalTasks = 0;
    let completedTasks = 0;
    let runningTasksHours = 0;
    let completedTasksHours = 0;

    for (const task of tasks) {
        const taskStartTime = task.events?.[0]?.timestamp ?? task.startTime;
        if (!taskStartTime || taskStartTime > t) continue;

        totalTasks++;

        const actualCompletedAt = getActualCompletedAt(task);
        const isCompletedByT = !!(task.completed && actualCompletedAt && actualCompletedAt <= t);

        let taskHours = 0;
        const syntheticEvents = getSyntheticEvents(task);
        if (!syntheticEvents) {
            if (task.startTime && task.startTime <= t) {
                if (isCompletedByT) {
                    const completedAtMs = actualCompletedAt ?? task.startTime;
                    taskHours = (completedAtMs - task.startTime) / (1000 * 3600);
                } else if (!task.completed && !task.enabled) {
                    taskHours = task.pausedElapsed / 3600;
                } else {
                    taskHours = (t - task.startTime) / (1000 * 3600);
                }
            }
        } else {
            let taskActiveMs = 0;
            let isRunning = false;
            let lastStartTime = 0;

            for (const ev of syntheticEvents) {
                if (ev.timestamp > t) break;
                if (ev.type === 'start') {
                    if (!isRunning) {
                        isRunning = true;
                        lastStartTime = ev.timestamp;
                    }
                } else if (ev.type === 'pause' || ev.type === 'complete') {
                    if (isRunning) {
                        taskActiveMs += (ev.timestamp - lastStartTime);
                        isRunning = false;
                    }
                }
            }

            if (isRunning && !isCompletedByT && lastStartTime <= t) {
                taskActiveMs += (t - lastStartTime);
            }

            if (task.pausedElapsed > 0 && syntheticEvents.length > 0 && lastStartTime === 0) {
                taskActiveMs += (task.pausedElapsed * 1000);
            }

            taskHours = taskActiveMs / (1000 * 3600);
        }

        if (isCompletedByT) {
            completedTasks++;
            completedTasksHours += taskHours;
        } else {
            runningTasksHours += taskHours;
        }
    }

    if (totalTasks === 0 || completedTasks === 0) return 0;

    const completionRate = completedTasks / totalTasks;
    const totalTimeHours = completedTasksHours + runningTasksHours;
    const avgTimePerTask = totalTimeHours / completedTasks;
    const clampedAvgTime = Math.max(avgTimePerTask, 0.5);
    const speedScore = 1 / clampedAvgTime;
    const volumeBonus = Math.log10(completedTasks + 1) * 2;
    return completionRate * speedScore * volumeBonus * 1000;
}

function getAllActiveIntervals(tasks: ScoreTask[], t: number) {
    const allIntervals: { start: number; end: number }[] = [];

    for (const task of tasks) {
        const taskStartTime = task.events?.[0]?.timestamp ?? task.startTime;
        if (!taskStartTime || taskStartTime > t) continue;

        const actualCompletedAt = getActualCompletedAt(task);
        const isCompletedByT = !!(task.completed && actualCompletedAt && actualCompletedAt <= t);

        const syntheticEvents = getSyntheticEvents(task);
        if (!syntheticEvents) {
            if (task.startTime && task.startTime <= t) {
                if (isCompletedByT) {
                    const completedAtMs = actualCompletedAt ?? task.startTime;
                    allIntervals.push({ start: task.startTime, end: completedAtMs });
                } else if (!task.completed && !task.enabled) {
                    allIntervals.push({ start: task.startTime, end: task.startTime + task.pausedElapsed * 1000 });
                } else {
                    allIntervals.push({ start: task.startTime, end: t });
                }
            }
        } else {
            let isRunning = false;
            let lastStartTime = 0;

            for (const ev of syntheticEvents) {
                if (ev.timestamp > t) break;
                if (ev.type === 'start') {
                    if (!isRunning) {
                        isRunning = true;
                        lastStartTime = ev.timestamp;
                    }
                } else if (ev.type === 'pause' || ev.type === 'complete') {
                    if (isRunning) {
                        allIntervals.push({ start: lastStartTime, end: ev.timestamp });
                        isRunning = false;
                    }
                }
            }

            if (isRunning && !isCompletedByT && lastStartTime <= t) {
                allIntervals.push({ start: lastStartTime, end: t });
            }
        }
    }

    return allIntervals;
}

function getNormalizedHistory(history: readonly BonusPointsSnapshot[]): NormalizedSnapshot[] {
    const cached = normalizedHistoryCache.get(history);
    if (cached) {
        return cached;
    }

    const normalized: NormalizedSnapshot[] = [];
    let isSorted = true;
    let prevTimestamp = Number.NEGATIVE_INFINITY;

    for (const entry of history) {
        const rawTimestamp = entry?.timestamp;
        const timestamp = rawTimestamp instanceof Date
            ? rawTimestamp.getTime()
            : typeof rawTimestamp === 'number'
                ? rawTimestamp
                : new Date(rawTimestamp).getTime();

        if (!Number.isFinite(timestamp)) continue;
        const points = Math.max(0, Math.round(Number(entry?.points || 0)));

        if (timestamp < prevTimestamp) {
            isSorted = false;
        }
        prevTimestamp = timestamp;
        normalized.push({ timestamp, points });
    }

    if (!isSorted) {
        normalized.sort((a, b) => a.timestamp - b.timestamp);
    }

    normalizedHistoryCache.set(history, normalized);
    return normalized;
}

function getGithubPointsFromHistoryAtTime(
    t: number,
    history?: BonusPointsSnapshot[] | null
): number | null {
    if (!Array.isArray(history) || history.length === 0) {
        return null;
    }

    const normalized = getNormalizedHistory(history);
    if (normalized.length === 0) {
        return null;
    }

    // Binary search for the last snapshot with timestamp <= t
    let lo = 0;
    let hi = normalized.length - 1;
    let bestIdx = -1;

    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (normalized[mid].timestamp <= t) {
            bestIdx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return bestIdx >= 0 ? normalized[bestIdx].points : 0;
}

function getGithubPointsAtTime(
    t: number,
    gamificationPoints: number,
    _gamificationPointsLastUpdatedAt?: Date | string | number | null,
    githubPointsHistory?: GithubPointsSnapshot[] | null
): number {
    const historyBasedPoints = getGithubPointsFromHistoryAtTime(t, githubPointsHistory);
    if (historyBasedPoints !== null) {
        return historyBasedPoints;
    }

    // Legacy fallback: if no history exists yet, use current GitHub points as a stable baseline
    // so daily chart doesn't flip past days between syncs.
    return Math.max(0, Math.round(gamificationPoints));
}

function getChainPointsAtTime(
    t: number,
    chainPoints: number,
    chainPointsHistory?: ChainPointsSnapshot[] | null
): number {
    const historyBasedPoints = getGithubPointsFromHistoryAtTime(t, chainPointsHistory);
    if (historyBasedPoints !== null) {
        return historyBasedPoints;
    }

    return Math.max(0, Math.round(chainPoints));
}

function getIdlePenaltyAtTime(tasks: ScoreTask[], t: number): number {
    const allIntervals = getAllActiveIntervals(tasks, t);
    allIntervals.sort((a, b) => a.start - b.start);

    const mergedActive: { start: number; end: number }[] = [];
    for (const interval of allIntervals) {
        if (mergedActive.length === 0) {
            mergedActive.push({ ...interval });
        } else {
            const last = mergedActive[mergedActive.length - 1];
            if (interval.start <= last.end) {
                last.end = Math.max(last.end, interval.end);
            } else {
                mergedActive.push({ ...interval });
            }
        }
    }

    const istOffsetMs = 5.5 * 3600 * 1000;
    const april1st2026Ist = Date.UTC(2026, 3, 1, 0, 0, 0, 0) - istOffsetMs;
    const firstTrackedTaskStart = tasks.reduce((earliest, task) => {
        const taskStartTime = task.events?.[0]?.timestamp ?? task.startTime;
        if (!taskStartTime || taskStartTime > t) return earliest;
        return Math.min(earliest, taskStartTime);
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(firstTrackedTaskStart)) {
        return 0;
    }

    const penaltyStart = Math.max(april1st2026Ist, firstTrackedTaskStart);
    if (penaltyStart >= t) {
        return 0;
    }

    let currentT = penaltyStart;
    let accumulatedPenalty = 0;

    for (const active of mergedActive) {
        if (active.end <= penaltyStart) continue;

        const activeStart = Math.max(active.start, penaltyStart);
        if (activeStart > currentT) {
            const idleEnd = Math.min(activeStart, t);
            accumulatedPenalty += ((idleEnd - currentT) / 1000) * 0.001;
        }
        currentT = Math.max(currentT, active.end);
        if (currentT >= t) break;
    }

    if (currentT < t) {
        accumulatedPenalty += ((t - currentT) / 1000) * 0.001;
    }

    return accumulatedPenalty;
}

export function getScoreBreakdownAtTime(
    tasks: ScoreTask[],
    t: number,
    gamificationPoints: number = 0,
    gamificationPointsLastUpdatedAt?: Date | string | number | null,
    githubPointsHistory?: GithubPointsSnapshot[] | null,
    chainPoints: number = 0,
    chainPointsHistory?: ChainPointsSnapshot[] | null
): ScoreBreakdown {
    const baseScore = computeBaseScore(tasks, t);
    const idlePenalty = getIdlePenaltyAtTime(tasks, t);
    const penalizedBaseScore = baseScore - idlePenalty;
    const githubPoints = getGithubPointsAtTime(
        t,
        gamificationPoints,
        gamificationPointsLastUpdatedAt,
        githubPointsHistory
    );
    const chainPointsAtTime = getChainPointsAtTime(t, chainPoints, chainPointsHistory);
    const totalScore = baseScore + githubPoints + chainPointsAtTime - idlePenalty;

    return {
        baseScore: roundScore(baseScore),
        idlePenalty: roundScore(idlePenalty),
        penalizedBaseScore: roundScore(penalizedBaseScore),
        githubPoints: Math.round(githubPoints),
        chainPoints: Math.round(chainPointsAtTime),
        totalScore: roundScore(totalScore),
    };
}

export function getScoreAtTime(
    tasks: ScoreTask[],
    t: number,
    gamificationPoints: number = 0,
    gamificationPointsLastUpdatedAt?: Date | string | number | null,
    githubPointsHistory?: GithubPointsSnapshot[] | null,
    chainPoints: number = 0,
    chainPointsHistory?: ChainPointsSnapshot[] | null
): number {
    return getScoreBreakdownAtTime(
        tasks,
        t,
        gamificationPoints,
        gamificationPointsLastUpdatedAt,
        githubPointsHistory,
        chainPoints,
        chainPointsHistory
    ).totalScore;
}
