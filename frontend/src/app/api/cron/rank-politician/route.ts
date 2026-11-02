import { NextRequest, NextResponse } from 'next/server';
import {
    RANK_POLITICIAN_BATCH_SIZE,
    runRankPoliticianScrapeBatch,
} from '@/lib/rank-politician/pipeline';
import { syncPoliticianSeeds } from '@/lib/rank-politician/seed-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorizedCron(request: NextRequest): boolean {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        // Allow in local/dev when secret is unset so the route is testable.
        return process.env.NODE_ENV !== 'production';
    }

    const authHeader = request.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const headerSecret = request.headers.get('x-cron-secret') || '';

    // Never accept the secret in a URL query string; it leaks via logs,
    // browser history and referrers.
    return bearer === cronSecret || headerSecret === cronSecret;
}

export async function GET(request: NextRequest) {
    try {
        if (!isAuthorizedCron(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const limitParam = Number(request.nextUrl.searchParams.get('limit') || '');
        const limit = Number.isFinite(limitParam) && limitParam > 0
            ? limitParam
            : RANK_POLITICIAN_BATCH_SIZE;

        // Apply corrected handles / newly added cabinet members before
        // selecting the batch. A handle reset marks the profile `never`, so it
        // is re-scraped in this same run instead of waiting for an admin click.
        let seedSync = null;
        try {
            seedSync = await syncPoliticianSeeds();
            console.log('[CRON] rank-politician seed sync', seedSync);
        } catch (seedError) {
            console.error('[CRON] rank-politician seed sync failed:', seedError);
        }

        console.log('[CRON] rank-politician scrape started', new Date().toISOString());
        const result = await runRankPoliticianScrapeBatch({ limit });
        console.log('[CRON] rank-politician scrape finished', {
            processed: result.processed,
            successCount: result.successCount,
            errorCount: result.errorCount,
            creditGuardTriggered: result.creditGuardTriggered,
            creditsRemaining: result.creditsRemaining,
        });

        // Fail loud when credits are exhausted so GitHub Actions does not look "green"
        // while every scrape is burning empty calls.
        if (result.creditGuardTriggered) {
            return NextResponse.json(
                {
                    status: 'error',
                    message: 'Firecrawl credit guard triggered — scraping paused',
                    ...result,
                    ...(seedSync ? { seedSync } : {}),
                },
                { status: 402 }
            );
        }

        // If we actually tried to scrape and every profile failed, report a
        // failure so the GitHub Actions run turns red instead of green.
        const allAttemptsFailed = result.processed > 0 && result.successCount === 0;
        return NextResponse.json(
            {
                status: allAttemptsFailed ? 'error' : 'ok',
                message: allAttemptsFailed ? 'Every scrape in this batch failed' : undefined,
                ...result,
                ...(seedSync ? { seedSync } : {}),
            },
            { status: allAttemptsFailed ? 502 : 200 }
        );
    } catch (error: any) {
        console.error('[CRON] rank-politician failed:', error);
        return NextResponse.json(
            {
                status: 'error',
                message: error?.message || 'Rank politician cron failed',
            },
            { status: 500 }
        );
    }
}
