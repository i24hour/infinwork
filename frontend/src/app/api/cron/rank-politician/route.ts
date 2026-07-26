import { NextRequest, NextResponse } from 'next/server';
import {
    RANK_POLITICIAN_BATCH_SIZE,
    runRankPoliticianScrapeBatch,
} from '@/lib/rank-politician/pipeline';

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
    const querySecret = request.nextUrl.searchParams.get('secret') || '';

    return bearer === cronSecret || headerSecret === cronSecret || querySecret === cronSecret;
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
                },
                { status: 402 }
            );
        }

        return NextResponse.json({
            status: 'ok',
            ...result,
        });
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
