'use client';

import dynamic from 'next/dynamic';

/**
 * The chart pulls in lightweight-charts (~150 KB). Load it after the page is
 * interactive so the task list and leaderboard are not blocked by it.
 */
export const PerformanceChart = dynamic(
    () => import('./PerformanceChart').then((mod) => mod.PerformanceChart),
    {
        ssr: false,
        loading: () => (
            <div
                aria-hidden="true"
                className="h-[360px] w-full animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]"
            />
        ),
    }
);
