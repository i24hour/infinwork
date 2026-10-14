'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, BaselineSeries, type IChartApi, type ISeriesApi, type CandlestickData, type LineData, type BaselineData, type Time, LineStyle } from 'lightweight-charts';
import { getScoreAtTime, type GithubPointsSnapshot, type ChainPointsSnapshot } from '@/lib/score';
import { getInitialIsLightTheme } from '@/lib/client-cache';

export interface ChartEvent {
    type: 'start' | 'pause' | 'complete';
    timestamp: number;
}

export interface ChartTask {
    id: string;
    events?: ChartEvent[];
    startTime: number;
    pausedElapsed: number;
    enabled: boolean;
    completed: boolean;
    completedAt?: number;
}

interface PerformanceChartProps {
    tasks: ChartTask[];
    gamificationPoints?: number;
    gamificationPointsLastUpdatedAt?: Date | string | number | null;
    githubPointsHistory?: GithubPointsSnapshot[] | null;
    chainPoints?: number;
    chainPointsHistory?: ChainPointsSnapshot[] | null;
}

type ChartType = 'line' | 'candle' | 'daily';
type CandleInterval = '1m' | '5m' | '10m' | '15m' | '1h' | '1d';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type DailyScoreDay = {
    dateKey: string;
    timestamp: number;
    value: number;
    level: number;
    dayOfWeek: number;
    monthLabel: string;
    formattedDate: string;
};

type DailyScoreWeek = {
    weekStart: number;
    monthLabel?: string;
    days: Array<DailyScoreDay | null>;
};

const getIntervalMs = (interval: CandleInterval) => {
    switch (interval) {
        case '1m': return 60 * 1000;
        case '5m': return 5 * 60 * 1000;
        case '10m': return 10 * 60 * 1000;
        case '15m': return 15 * 60 * 1000;
        case '1h': return 60 * 60 * 1000;
        case '1d': return 24 * 60 * 60 * 1000;
        default: return 15 * 60 * 1000;
    }
};

function getMostRecent5PmIstTimestamp(referenceTime: number): number {
    const istDate = new Date(referenceTime + IST_OFFSET_MS);
    const todayFivePmIst = Date.UTC(
        istDate.getUTCFullYear(),
        istDate.getUTCMonth(),
        istDate.getUTCDate(),
        17,
        0,
        0,
        0
    ) - IST_OFFSET_MS;

    return referenceTime >= todayFivePmIst ? todayFivePmIst : todayFivePmIst - DAY_MS;
}

function getNext5PmIstTimestamp(referenceTime: number): number {
    return getMostRecent5PmIstTimestamp(referenceTime) + DAY_MS;
}

function getIstDayStart(timestamp: number): number {
    const istDate = new Date(timestamp + IST_OFFSET_MS);
    return Date.UTC(
        istDate.getUTCFullYear(),
        istDate.getUTCMonth(),
        istDate.getUTCDate(),
        0,
        0,
        0,
        0
    ) - IST_OFFSET_MS;
}

function formatIstDate(timestamp: number): string {
    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(timestamp));
}

function formatIstMonth(timestamp: number): string {
    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'short',
    }).format(new Date(timestamp));
}

function getDailyScoreClass(value: number, level: number, isLightTheme: boolean): string {
    if (Math.abs(value) < 0.005 || level === 0) {
        return isLightTheme
            ? 'bg-[#ebedf0] hover:bg-[#d8dee4]'
            : 'bg-[#161b22] hover:bg-[#21262d]';
    }

    if (value > 0) {
        const colors = isLightTheme
            ? [
                'bg-[#9be9a8] hover:bg-[#7ee787]',
                'bg-[#40c463] hover:bg-[#2da44e]',
                'bg-[#30a14e] hover:bg-[#238636]',
                'bg-[#216e39] hover:bg-[#1a5d32]',
            ]
            : [
                'bg-[#0e4429] hover:bg-[#006d32]',
                'bg-[#006d32] hover:bg-[#26a641]',
                'bg-[#26a641] hover:bg-[#39d353]',
                'bg-[#39d353] hover:bg-[#56d364]',
            ];
        return colors[level - 1] || colors[colors.length - 1];
    }

    const colors = isLightTheme
        ? [
            'bg-[#ffaba8] hover:bg-[#ff938a]',
            'bg-[#ff7b72] hover:bg-[#f85149]',
            'bg-[#da3633] hover:bg-[#cf222e]',
            'bg-[#a40e26] hover:bg-[#82071e]',
        ]
        : [
            'bg-[#4c0519] hover:bg-[#7f1d1d]',
            'bg-[#7f1d1d] hover:bg-[#b91c1c]',
            'bg-[#dc2626] hover:bg-[#ef4444]',
            'bg-[#ff5a5f] hover:bg-[#ff7378]',
        ];
    return colors[level - 1] || colors[colors.length - 1];
}

function getFocusedRange(values: number[], referenceValue?: number): { minValue: number; maxValue: number } | null {
    if (!values.length) return null;

    const focusWindow = Math.max(24, Math.floor(values.length * 0.2));
    const focusValues = values.slice(-focusWindow);
    const latestValue = focusValues[focusValues.length - 1];

    let minValue = Math.min(...focusValues);
    let maxValue = Math.max(...focusValues);

    // Always keep the previous close line in the visible range.
    if (typeof referenceValue === 'number' && Number.isFinite(referenceValue)) {
        minValue = Math.min(minValue, referenceValue);
        maxValue = Math.max(maxValue, referenceValue);
    }

    const span = Math.max(maxValue - minValue, Math.max(Math.abs(latestValue), 1) * 0.05);
    const padding = Math.max(span * 0.2, 1);
    return {
        minValue: minValue - padding,
        maxValue: maxValue + padding,
    };
}

function getFocusedCandleRange(candles: CandlestickData[], referenceValue?: number): { minValue: number; maxValue: number } | null {
    if (!candles.length) return null;

    const focusWindow = Math.max(24, Math.floor(candles.length * 0.2));
    const focusCandles = candles.slice(-focusWindow);

    const lows = focusCandles.map((c) => c.low);
    const highs = focusCandles.map((c) => c.high);

    let minValue = Math.min(...lows);
    let maxValue = Math.max(...highs);
    const latestClose = focusCandles[focusCandles.length - 1]?.close ?? maxValue;
    if (typeof referenceValue === 'number' && Number.isFinite(referenceValue)) {
        minValue = Math.min(minValue, referenceValue);
        maxValue = Math.max(maxValue, referenceValue);
    }

    const anchorValue = typeof referenceValue === 'number' && Number.isFinite(referenceValue)
        ? referenceValue
        : latestClose;
    const span = Math.max(maxValue - minValue, Math.max(Math.abs(anchorValue), 1) * 0.05);
    const padding = Math.max(span * 0.2, 1);

    return {
        minValue: minValue - padding,
        maxValue: maxValue + padding,
    };
}

/**
 * Calculate the performance score at a given point in time.
 * 
 * Formula:
 * Score = Completion_Rate × Speed_Score × Volume_Bonus × 1000
 * Completion_Rate = completed_tasks / total_tasks
 * Avg_Time_Per_Task = total_time_hrs / completed_tasks
 * Speed_Score = 1 / max(Avg_Time_Per_Task, 0.5)
 * Volume_Bonus = log10(completed_tasks + 1) × 2
 * 
 * - Total time includes completed task time plus active running time
 * - Completing a task adds to completed count and completed task hours
 * - Edge cases: no tasks or no completed tasks => score = 0
 */
function computeBaseScore(tasks: ChartTask[], t: number): number {
    let totalTasks = 0;
    let completedTasks = 0;
    let runningTasksHours = 0;
    let completedTasksHours = 0;

    for (const task of tasks) {
        const taskStartTime = task.events?.[0]?.timestamp ?? task.startTime;
        if (!taskStartTime || taskStartTime > t) continue;

        totalTasks++;

        let actualCompletedAt = task.completedAt;
        if (!actualCompletedAt && task.events?.length) {
            const completionEvent = [...task.events].reverse().find((event) => event.type === 'complete');
            if (completionEvent) {
                actualCompletedAt = completionEvent.timestamp;
            }
        }
        if (task.completed && !actualCompletedAt && (!task.events || task.events.length === 0)) {
            actualCompletedAt = task.startTime + (task.pausedElapsed * 1000);
        }

        const isCompletedByT = !!(task.completed && actualCompletedAt && actualCompletedAt <= t);

        let taskHours = 0;
        if (!task.events || task.events.length === 0) {
            if (task.startTime && task.startTime <= t) {
                if (isCompletedByT) {
                    taskHours = (actualCompletedAt! - task.startTime) / (1000 * 3600);
                } else {
                    if (!task.completed && !task.enabled) {
                        taskHours = (task.pausedElapsed * 1000) / (1000 * 3600);
                    } else {
                        taskHours = (t - task.startTime) / (1000 * 3600);
                    }
                }
            }
        } else {
            const syntheticEvents = [...task.events];
            if (syntheticEvents[0].type !== 'start' && task.startTime && task.startTime < syntheticEvents[0].timestamp) {
                syntheticEvents.unshift({ type: 'start', timestamp: task.startTime });
            }

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

function getAllActiveIntervals(tasks: ChartTask[], t: number) {
    const allIntervals: { start: number; end: number }[] = [];
    for (const task of tasks) {
        const taskStartTime = task.events?.[0]?.timestamp ?? task.startTime;
        if (!taskStartTime || taskStartTime > t) continue;

        let actualCompletedAt = task.completedAt;
        if (!actualCompletedAt && task.events?.length) {
            const completionEvent = [...task.events].reverse().find((event) => event.type === 'complete');
            if (completionEvent) {
                actualCompletedAt = completionEvent.timestamp;
            }
        }
        if (task.completed && !actualCompletedAt && (!task.events || task.events.length === 0)) {
            actualCompletedAt = task.startTime + (task.pausedElapsed * 1000);
        }

        const isCompletedByT = !!(task.completed && actualCompletedAt && actualCompletedAt <= t);

        if (!task.events || task.events.length === 0) {
            if (task.startTime && task.startTime <= t) {
                if (isCompletedByT) {
                    allIntervals.push({ start: task.startTime, end: actualCompletedAt! });
                } else {
                    if (!task.completed && !task.enabled) {
                        allIntervals.push({ start: task.startTime, end: task.startTime + task.pausedElapsed * 1000 });
                    } else {
                        allIntervals.push({ start: task.startTime, end: t });
                    }
                }
            }
        } else {
            const syntheticEvents = [...task.events];
            if (syntheticEvents[0].type !== 'start' && task.startTime && task.startTime < syntheticEvents[0].timestamp) {
                syntheticEvents.unshift({ type: 'start', timestamp: task.startTime });
            }

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

function snapToInterval(timestamp: number, interval: CandleInterval): number {
    const d = new Date(timestamp);
    if (interval === '1m') {
        d.setSeconds(0, 0);
    } else if (interval === '5m') {
        d.setSeconds(0, 0);
        d.setMinutes(Math.floor(d.getMinutes() / 5) * 5);
    } else if (interval === '10m') {
        d.setSeconds(0, 0);
        d.setMinutes(Math.floor(d.getMinutes() / 10) * 10);
    } else if (interval === '15m') {
        d.setSeconds(0, 0);
        d.setMinutes(Math.floor(d.getMinutes() / 15) * 15);
    } else if (interval === '1h') {
        d.setMinutes(0, 0, 0);
    } else if (interval === '1d') {
        d.setHours(0, 0, 0, 0);
    }
    return d.getTime();
}

export function PerformanceChart({
    tasks,
    gamificationPoints = 0,
    gamificationPointsLastUpdatedAt = null,
    githubPointsHistory = null,
    chainPoints = 0,
    chainPointsHistory = null
}: PerformanceChartProps) {
    const [chartType, setChartType] = useState<ChartType>('daily');
    const [interval, setIntervalVal] = useState<CandleInterval>('15m');
    const [isLightTheme, setIsLightTheme] = useState<boolean>(() => getInitialIsLightTheme());
    const [referenceNow, setReferenceNow] = useState(() => Date.now());
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const dailyPanelRef = useRef<HTMLDivElement>(null);
    const dailyScrollRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Baseline'> | null>(null);
    const [hoveredDay, setHoveredDay] = useState<DailyScoreDay | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 240, y: 120 });
    const [isMobileViewport, setIsMobileViewport] = useState(false);

    useEffect(() => {
        const root = document.documentElement;
        const syncTheme = () => {
            setIsLightTheme(root.getAttribute('data-theme') === 'light');
        };

        syncTheme();
        const observer = new MutationObserver(syncTheme);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const syncViewport = () => {
            setIsMobileViewport(window.innerWidth < 768);
        };

        syncViewport();
        window.addEventListener('resize', syncViewport);
        return () => window.removeEventListener('resize', syncViewport);
    }, []);

    useEffect(() => {
        let timeoutId: number | undefined;

        const scheduleReferenceRefresh = () => {
            const now = Date.now();
            const nextFivePmIst = getNext5PmIstTimestamp(now);
            timeoutId = window.setTimeout(() => {
                setReferenceNow(Date.now());
                scheduleReferenceRefresh();
            }, Math.max((nextFivePmIst - now) + 1000, 1000));
        };

        scheduleReferenceRefresh();

        return () => {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        };
    }, []);

    // Track the most recent 5 PM IST close and refresh it automatically after each daily close.
    const previousCloseTimestamp = useMemo(() => {
        return getMostRecent5PmIstTimestamp(referenceNow);
    }, [referenceNow]);

    const previousCloseValue = useMemo(() => {
        return getScoreAtTime(tasks, previousCloseTimestamp, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory);
    }, [tasks, previousCloseTimestamp, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory]);

    // Generate OHLC data (only computed when Line or Candle view is active)
    const chartData = useMemo(() => {
        if (chartType === 'daily') {
            return {
                candleData: [] as CandlestickData[],
                lineData: [] as LineData[],
                baselineData: [] as BaselineData[],
            };
        }
        const now = Date.now();
        let intervalMs = getIntervalMs(interval);
        const snappedNow = snapToInterval(now, interval);

        let startTime = snappedNow - (24 * 60 * 60 * 1000);

        // Show full history by extending to the earliest task timestamp when available.
        const earliestTaskStart = tasks.reduce((earliest, task) => {
            const ts = task.events?.[0]?.timestamp ?? task.startTime;
            return ts && ts < earliest ? ts : earliest;
        }, now);
        if (earliestTaskStart < startTime) {
            startTime = earliestTaskStart;
        }

        let dataPointsCount = Math.floor((now - startTime) / intervalMs);
        if (dataPointsCount > 500) {
            dataPointsCount = 500;
            intervalMs = (now - startTime) / 500;
        }

        const candleData: CandlestickData[] = [];
        const lineData: LineData[] = [];
        const baselineData: BaselineData[] = [];

        for (let i = 0; i <= dataPointsCount; i++) {
            const T_start = startTime + (i * intervalMs);
            const T_end = Math.min(now, startTime + ((i + 1) * intervalMs));
            if (T_start >= now) break;

            let open = getScoreAtTime(tasks, T_start, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory);
            let close = getScoreAtTime(tasks, T_end, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory);
            let high = Math.max(open, close);
            let low = Math.min(open, close);

            // Evaluate at event boundaries for accurate high/low
            for (const task of tasks) {
                if (task.events) {
                    for (const ev of task.events) {
                        if (ev.timestamp > T_start && ev.timestamp <= T_end) {
                            const val = getScoreAtTime(tasks, ev.timestamp, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory);
                            const valBefore = getScoreAtTime(tasks, ev.timestamp - 1, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory);
                            high = Math.max(high, val, valBefore);
                            low = Math.min(low, val, valBefore);
                        }
                    }
                }
            }

            // lightweight-charts uses seconds as timestamp
            const timeSeconds = Math.floor(T_end / 1000) as Time;

            candleData.push({
                time: timeSeconds,
                open,
                high,
                low,
                close,
            });

            lineData.push({
                time: timeSeconds,
                value: close,
            });

            baselineData.push({
                time: timeSeconds,
                value: close,
            });
        }

        return { candleData, lineData, baselineData };
    }, [chartType, tasks, interval, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory]);

    const dailyScoreData = useMemo(() => {
        const now = Date.now();
        const todayStart = getIstDayStart(now);
        const firstVisibleDay = todayStart - (364 * DAY_MS);
        const firstDayOfWeek = new Date(firstVisibleDay + IST_OFFSET_MS).getUTCDay();
        const gridStart = firstVisibleDay - (firstDayOfWeek * DAY_MS);
        const rawDays: DailyScoreDay[] = [];

        // Since each dayStart + DAY_MS equals the next day's dayStart, compute each boundary once
        let startScore = getScoreAtTime(
            tasks,
            firstVisibleDay,
            gamificationPoints,
            gamificationPointsLastUpdatedAt,
            githubPointsHistory,
            chainPoints,
            chainPointsHistory
        );

        for (let dayStart = firstVisibleDay; dayStart <= todayStart; dayStart += DAY_MS) {
            const dayEnd = Math.min(dayStart + DAY_MS, now);
            const endScore = getScoreAtTime(
                tasks,
                dayEnd,
                gamificationPoints,
                gamificationPointsLastUpdatedAt,
                githubPointsHistory,
                chainPoints,
                chainPointsHistory
            );
            const value = Math.round((endScore - startScore) * 100) / 100;
            startScore = endScore;
            const istDate = new Date(dayStart + IST_OFFSET_MS);

            rawDays.push({
                dateKey: new Date(dayStart).toISOString(),
                timestamp: dayStart,
                value,
                level: 0,
                dayOfWeek: istDate.getUTCDay(),
                monthLabel: formatIstMonth(dayStart),
                formattedDate: formatIstDate(dayStart),
            });
        }

        const maxPositive = Math.max(0, ...rawDays.map((day) => day.value));
        const maxNegative = Math.max(0, ...rawDays.map((day) => Math.abs(Math.min(0, day.value))));
        const days = rawDays.map((day) => {
            const magnitude = Math.abs(day.value);
            const maxMagnitude = day.value >= 0 ? maxPositive : maxNegative;
            const level = magnitude < 0.005 || maxMagnitude === 0
                ? 0
                : Math.min(4, Math.max(1, Math.ceil((magnitude / maxMagnitude) * 4)));
            return { ...day, level };
        });

        const dayMap = new Map(days.map((day) => [day.timestamp, day]));
        const weeks: DailyScoreWeek[] = [];
        let lastLabeledMonth: string | undefined;

        for (let weekStart = gridStart; weekStart <= todayStart; weekStart += 7 * DAY_MS) {
            const weekDays: Array<DailyScoreDay | null> = [];
            for (let offset = 0; offset < 7; offset++) {
                const day = weekStart + (offset * DAY_MS);
                weekDays.push(dayMap.get(day) || null);
            }

            let monthLabel: string | undefined;
            for (const day of weekDays) {
                if (!day) continue;
                if (day.monthLabel !== lastLabeledMonth) {
                    monthLabel = day.monthLabel;
                    lastLabeledMonth = day.monthLabel;
                    break;
                }
            }

            weeks.push({ weekStart, monthLabel, days: weekDays });
        }

        const positiveTotal = days.reduce((sum, day) => sum + Math.max(0, day.value), 0);
        const negativeTotal = days.reduce((sum, day) => sum + Math.min(0, day.value), 0);
        const netTotal = positiveTotal + negativeTotal;

        return {
            weeks,
            positiveTotal: Math.round(positiveTotal * 100) / 100,
            negativeTotal: Math.round(negativeTotal * 100) / 100,
            netTotal: Math.round(netTotal * 100) / 100,
        };
    }, [tasks, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory, referenceNow]);

    const updateDailyTooltip = (event: React.MouseEvent<HTMLElement>, day: DailyScoreDay) => {
        const rect = dailyPanelRef.current?.getBoundingClientRect();
        if (rect) {
            const x = Math.min(Math.max(event.clientX - rect.left, 130), rect.width - 130);
            const y = Math.min(Math.max(event.clientY - rect.top - 42, 74), rect.height - 64);
            setTooltipPosition({ x, y });
        }
        setHoveredDay(day);
    };

    useEffect(() => {
        if (chartType !== 'daily' || !isMobileViewport) return;
        const scrollEl = dailyScrollRef.current;
        if (!scrollEl) return;

        // On phones, open the heatmap from the most recent weeks (right edge).
        const raf = window.requestAnimationFrame(() => {
            scrollEl.scrollLeft = scrollEl.scrollWidth;
        });

        return () => window.cancelAnimationFrame(raf);
    }, [chartType, isMobileViewport, dailyScoreData.weeks.length]);

    // Create/update chart container and base settings
    useEffect(() => {
        if (chartType === 'daily') {
            if (chartRef.current) {
                chartRef.current.remove();
                chartRef.current = null;
                seriesRef.current = null;
            }
            return;
        }

        if (!chartContainerRef.current) return;

        // Clear previous chart
        if (chartRef.current) {
            chartRef.current.remove();
            chartRef.current = null;
            seriesRef.current = null;
        }

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: isLightTheme ? 'rgba(24, 24, 27, 0.75)' : 'rgba(255, 255, 255, 0.5)',
                fontFamily: "'Inter', -apple-system, sans-serif",
                fontSize: 11,
            },
            grid: {
                vertLines: { color: isLightTheme ? 'rgba(24, 24, 27, 0.06)' : 'rgba(255, 255, 255, 0.04)' },
                horzLines: { color: isLightTheme ? 'rgba(24, 24, 27, 0.06)' : 'rgba(255, 255, 255, 0.04)' },
            },
            crosshair: {
                vertLine: {
                    color: isLightTheme ? 'rgba(24, 24, 27, 0.18)' : 'rgba(255, 255, 255, 0.2)',
                    labelBackgroundColor: isLightTheme ? '#f4f4f5' : '#333',
                },
                horzLine: {
                    color: isLightTheme ? 'rgba(24, 24, 27, 0.18)' : 'rgba(255, 255, 255, 0.2)',
                    labelBackgroundColor: isLightTheme ? '#f4f4f5' : '#333',
                },
            },
            rightPriceScale: {
                borderColor: isLightTheme ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
            },
            timeScale: {
                borderColor: isLightTheme ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
                timeVisible: true,
                secondsVisible: false,
                tickMarkFormatter: (time: number) => {
                    const date = new Date(time * 1000);
                    return new Intl.DateTimeFormat('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                    }).format(date);
                },
            },
            localization: {
                priceFormatter: (price: number) => price.toFixed(2),
                timeFormatter: (time: number) => {
                    const date = new Date(time * 1000);
                    return new Intl.DateTimeFormat('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    }).format(date);
                }
            },
            handleScroll: true,
            handleScale: true,
        });

        chartRef.current = chart;

        if (chartType === 'candle') {
            const candleSeries = chart.addSeries(CandlestickSeries, {
                upColor: '#10b981',
                downColor: '#ef4444',
                borderDownColor: '#ef4444',
                borderUpColor: '#10b981',
                wickDownColor: '#ef4444',
                wickUpColor: '#10b981',
                priceLineVisible: false,
                lastValueVisible: false,
                autoscaleInfoProvider: () => {
                    const range = getFocusedCandleRange(chartData.candleData, previousCloseValue);
                    if (!range) return null;
                    return { priceRange: range };
                },
            });

            candleSeries.createPriceLine({
                price: previousCloseValue,
                color: isLightTheme ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.4)',
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: false,
            });

            seriesRef.current = candleSeries;
        } else {
            const baselineSeries = chart.addSeries(BaselineSeries, {
                baseValue: { type: 'price' as const, price: previousCloseValue },
                topLineColor: '#10b981',
                topFillColor1: 'rgba(16, 185, 129, 0.28)',
                topFillColor2: 'rgba(16, 185, 129, 0.05)',
                bottomLineColor: '#ef4444',
                bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
                bottomFillColor2: 'rgba(239, 68, 68, 0.28)',
                lineWidth: 2,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 5,
                crosshairMarkerBorderColor: '#000',
                crosshairMarkerBackgroundColor: '#fff',
                priceLineVisible: false,
                lastValueVisible: false,
                autoscaleInfoProvider: () => {
                    const vals = chartData.baselineData.map((d) => d.value);
                    const range = getFocusedRange(vals, previousCloseValue);
                    if (!range) return null;
                    return {
                        priceRange: range,
                    };
                },
            });

            baselineSeries.createPriceLine({
                price: previousCloseValue,
                color: isLightTheme ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.4)',
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: false,
            });

            seriesRef.current = baselineSeries;
        }

        // Apply initial data immediately so that auto-scaling aligns properly
        let dataLength = 0;
        if (chartType === 'candle') {
            (seriesRef.current as ISeriesApi<'Candlestick'>).setData(chartData.candleData);
            dataLength = chartData.candleData.length;
        } else {
            (seriesRef.current as ISeriesApi<'Baseline'>).setData(chartData.baselineData);
            dataLength = chartData.baselineData.length;
        }
        
        // Instead of fitContent or hardcoded bar counts, we guarantee exactly 1 rolling month of history
        if (dataLength > 0) {
            const nowInSeconds = Math.floor(Date.now() / 1000);
            const thirtyDaysAgo = nowInSeconds - (30 * 24 * 60 * 60);
            
            // Note: time is passed as raw number to satisfy lightweight-charts Time type constraint
            chart.timeScale().setVisibleRange({
                from: thirtyDaysAgo as unknown as import('lightweight-charts').Time,
                to: nowInSeconds as unknown as import('lightweight-charts').Time,
            });
        }

        // Handle resize
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                chart.applyOptions({ width, height });
            }
        });
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, [chartType, previousCloseValue, isLightTheme]);

    // Update data invisibly on poll (avoids calling fitContent and resetting pan)
    useEffect(() => {
        if (chartType === 'daily') return;
        if (!seriesRef.current) return;
        
        if (chartType === 'candle') {
            (seriesRef.current as ISeriesApi<'Candlestick'>).setData(chartData.candleData);
        } else {
            (seriesRef.current as ISeriesApi<'Baseline'>).setData(chartData.baselineData);
        }
    }, [chartData, chartType]);

    // Live native update cycle (No React state changes triggered!)
    useEffect(() => {
        if (chartType === 'daily') return;
        const intervalMs = getIntervalMs(interval);

        const liveInterval = setInterval(() => {
            if (!seriesRef.current) return;

            const now = Date.now();
            const currentScore = getScoreAtTime(tasks, now, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory);
            const snappedNow = snapToInterval(now, interval);
            const timeSeconds = Math.floor(snappedNow / 1000) as Time;

            if (chartType === 'line') {
                const baselineSeries = seriesRef.current as ISeriesApi<'Baseline'>;
                // Live update the right-most point
                baselineSeries.update({
                    time: timeSeconds,
                    value: currentScore
                });
            } else {
                const candleSeries = seriesRef.current as ISeriesApi<'Candlestick'>;
                // We need to fetch the last known OHLC from chartData to update its close
                const lastCandle = chartData.candleData[chartData.candleData.length - 1];
                if (lastCandle && lastCandle.time === timeSeconds) {
                    candleSeries.update({
                        time: timeSeconds,
                        open: lastCandle.open,
                        high: Math.max(lastCandle.high, currentScore),
                        low: Math.min(lastCandle.low, currentScore),
                        close: currentScore
                    });
                } else {
                    // It rolled over to a new candle bucket, start a fresh one
                    candleSeries.update({
                        time: timeSeconds,
                        open: currentScore,
                        high: currentScore,
                        low: currentScore,
                        close: currentScore
                    });
                }
            }
        }, 1000);

        return () => clearInterval(liveInterval);
    }, [tasks, interval, chartType, chartData, gamificationPoints, gamificationPointsLastUpdatedAt, githubPointsHistory, chainPoints, chainPointsHistory]);

    return (
        <div className="bg-black rounded-2xl border border-white/10 p-6 flex flex-col w-full h-[500px]">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 gap-4">
                <div>
                    <h2 className="text-xl font-semibold text-white">Performance Score</h2>
                    <p className="text-sm text-zinc-500 mt-1">Score = Completion × Speed × Volume</p>
                    <p className="text-xs text-zinc-600 mt-1">
                        * Dotted line represents the most recent 5 PM IST score
                    </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {/* Chart Type Toggle */}
                    <div className={`flex rounded-lg p-1 border ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-white/5 border-white/10'}`}>
                        <button
                            onClick={() => setChartType('line')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${chartType === 'line'
                                ? (isLightTheme ? 'bg-white text-zinc-900 border border-black/10 shadow-sm' : 'bg-zinc-800 text-white shadow-md')
                                : (isLightTheme ? 'text-zinc-600 hover:text-zinc-900' : 'text-zinc-500 hover:text-white')
                                }`}
                        >
                            Line
                        </button>
                        <button
                            onClick={() => setChartType('candle')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${chartType === 'candle'
                                ? (isLightTheme ? 'bg-white text-zinc-900 border border-black/10 shadow-sm' : 'bg-zinc-800 text-white shadow-md')
                                : (isLightTheme ? 'text-zinc-600 hover:text-zinc-900' : 'text-zinc-500 hover:text-white')
                                }`}
                        >
                            Candle
                        </button>
                        <button
                            onClick={() => setChartType('daily')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${chartType === 'daily'
                                ? (isLightTheme ? 'bg-white text-zinc-900 border border-black/10 shadow-sm' : 'bg-zinc-800 text-white shadow-md')
                                : (isLightTheme ? 'text-zinc-600 hover:text-zinc-900' : 'text-zinc-500 hover:text-white')
                                }`}
                        >
                            Daily score
                        </button>
                    </div>

                    {/* Interval Selector (Candle Only) */}
                    {
                        chartType === 'candle' && (
                            <div className={`flex rounded-lg p-1 border ${isLightTheme ? 'bg-black/5 border-black/10' : 'bg-white/5 border-white/10'}`}>
                                {(['1m', '5m', '10m', '15m', '1h', '1d'] as CandleInterval[]).map((int) => (
                                    <button
                                        key={int}
                                        onClick={() => setIntervalVal(int)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${interval === int
                                            ? (isLightTheme ? 'bg-white text-zinc-900 border border-black/10 shadow-sm' : 'bg-zinc-800 text-white shadow-md')
                                            : (isLightTheme ? 'text-zinc-600 hover:text-zinc-900' : 'text-zinc-500 hover:text-white')
                                            }`}
                                    >
                                        {int}
                                    </button>
                                ))}
                            </div>
                        )
                    }

                </div >
            </div >

            {/* Chart Container */}
            {chartType === 'daily' ? (
                <div
                    ref={dailyPanelRef}
                    className={`relative flex-1 rounded-lg border px-3 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5 overflow-hidden ${
                        isLightTheme
                            ? 'border-zinc-300 bg-white text-zinc-950'
                            : 'border-[#30363d] bg-[#0d1117] text-[#e6edf3]'
                    }`}
                >
                    {hoveredDay && (
                        <div
                            className={`pointer-events-none absolute z-30 max-w-[220px] -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-xs shadow-lg ${
                                isLightTheme
                                    ? 'border-zinc-300 bg-white/95 text-zinc-900'
                                    : 'border-zinc-600 bg-[#161b22]/95 text-zinc-100'
                            }`}
                            style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
                        >
                            <div className="flex items-center gap-1.5 font-semibold leading-tight">
                                <span
                                    className={`inline-block h-2 w-2 rounded-full ${
                                        hoveredDay.value > 0
                                            ? 'bg-[#2da44e]'
                                            : hoveredDay.value < 0
                                                ? 'bg-[#f85149]'
                                                : 'bg-zinc-400'
                                    }`}
                                />
                                <span>{hoveredDay.value >= 0 ? '+' : ''}{hoveredDay.value.toFixed(2)} points</span>
                            </div>
                            <div className={`mt-0.5 text-[11px] leading-tight ${isLightTheme ? 'text-zinc-600' : 'text-zinc-300'}`}>
                                {hoveredDay.formattedDate}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
                        <div>
                            <div className={`text-[22px] leading-tight sm:text-2xl md:text-[26px] font-semibold tracking-tight ${isLightTheme ? 'text-zinc-950' : 'text-[#e6edf3]'}`}>
                                {dailyScoreData.netTotal >= 0 ? '+' : ''}{dailyScoreData.netTotal.toFixed(2)} points in the last year
                            </div>
                            <div className={`text-xs sm:text-sm mt-1 ${isLightTheme ? 'text-zinc-600' : 'text-[#8b949e]'}`}>
                                +{dailyScoreData.positiveTotal.toFixed(2)} gained / {dailyScoreData.negativeTotal.toFixed(2)} lost
                            </div>
                        </div>
                        <div className={`text-xs sm:text-sm ${isLightTheme ? 'text-zinc-500' : 'text-[#8b949e]'}`}>
                            Daily score
                        </div>
                    </div>

                    <div
                        ref={dailyScrollRef}
                        className="overflow-x-auto md:overflow-visible pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                    >
                        <div className={`w-max ${isMobileViewport ? '' : 'md:w-full'}`}>
                            <div
                                className="ml-7 sm:ml-9 mb-1 grid gap-x-[3px]"
                                style={{ gridTemplateColumns: `repeat(${dailyScoreData.weeks.length}, ${isMobileViewport ? 11 : 12}px)` }}
                            >
                                {dailyScoreData.weeks.map((week) => (
                                    <div
                                        key={week.weekStart}
                                        className={`h-5 text-xs sm:text-sm font-medium ${isLightTheme ? 'text-zinc-700' : 'text-[#e6edf3]'}`}
                                    >
                                        {week.monthLabel || ''}
                                    </div>
                                ))}
                            </div>

                            <div className="flex">
                                <div className={`grid grid-rows-7 gap-[3px] pr-2 sm:pr-3 text-xs sm:text-sm ${isLightTheme ? 'text-zinc-700' : 'text-[#e6edf3]'}`}>
                                    <div className="h-[11px] sm:h-3" />
                                    <div className="h-[11px] sm:h-3 leading-[11px] sm:leading-3">Mon</div>
                                    <div className="h-[11px] sm:h-3" />
                                    <div className="h-[11px] sm:h-3 leading-[11px] sm:leading-3">Wed</div>
                                    <div className="h-[11px] sm:h-3" />
                                    <div className="h-[11px] sm:h-3 leading-[11px] sm:leading-3">Fri</div>
                                    <div className="h-[11px] sm:h-3" />
                                </div>

                                <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
                                    {dailyScoreData.weeks.flatMap((week) => week.days.map((day, dayIndex) => {
                                        if (!day) {
                                            return <div key={`${week.weekStart}-${dayIndex}`} className={`${isMobileViewport ? 'h-[11px] w-[11px]' : 'h-3 w-3'} rounded-[3px]`} />;
                                        }

                                        const signedValue = `${day.value >= 0 ? '+' : ''}${day.value.toFixed(2)}`;

                                        return (
                                            <button
                                                key={day.dateKey}
                                                type="button"
                                                onMouseEnter={(event) => updateDailyTooltip(event, day)}
                                                onMouseMove={(event) => updateDailyTooltip(event, day)}
                                                onClick={(event) => updateDailyTooltip(event, day)}
                                                onMouseLeave={() => setHoveredDay(null)}
                                                className={`${isMobileViewport ? 'h-[11px] w-[11px]' : 'h-3 w-3'} rounded-[3px] outline-none ring-offset-2 transition-transform hover:scale-125 focus-visible:ring-2 ${
                                                    isLightTheme
                                                        ? 'ring-offset-white focus-visible:ring-zinc-950'
                                                        : 'ring-offset-[#0d1117] focus-visible:ring-[#e6edf3]'
                                                } ${getDailyScoreClass(day.value, day.level, isLightTheme)}`}
                                                aria-label={`${signedValue} points on ${day.formattedDate}`}
                                            >
                                                <span className="sr-only">{signedValue} points on {day.formattedDate}</span>
                                            </button>
                                        );
                                    }))}
                                </div>
                            </div>

                            <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className={`text-xs sm:text-sm ${isLightTheme ? 'text-zinc-600' : 'text-[#8b949e]'}`}>
                                    {hoveredDay
                                        ? `${hoveredDay.value >= 0 ? '+' : ''}${hoveredDay.value.toFixed(2)} points on ${hoveredDay.formattedDate}`
                                        : (isMobileViewport ? 'Tap a day to inspect the score movement' : 'Hover a day to inspect the score movement')}
                                </div>
                                <div className={`flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm ${isLightTheme ? 'text-zinc-600' : 'text-[#8b949e]'}`}>
                                    <span>Loss</span>
                                    {[4, 3, 2, 1].map((level) => (
                                        <span key={`loss-${level}`} className={`${isMobileViewport ? 'h-[11px] w-[11px]' : 'h-3 w-3'} rounded-[3px] ${getDailyScoreClass(-level, level, isLightTheme)}`} />
                                    ))}
                                    <span className={`${isMobileViewport ? 'h-[11px] w-[11px]' : 'h-3 w-3'} rounded-[3px] ${getDailyScoreClass(0, 0, isLightTheme)}`} />
                                    {[1, 2, 3, 4].map((level) => (
                                        <span key={`gain-${level}`} className={`${isMobileViewport ? 'h-[11px] w-[11px]' : 'h-3 w-3'} rounded-[3px] ${getDailyScoreClass(level, level, isLightTheme)}`} />
                                    ))}
                                    <span>Gain</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div ref={chartContainerRef} className="flex-1 w-full" />
            )}
        </div >
    );
}
