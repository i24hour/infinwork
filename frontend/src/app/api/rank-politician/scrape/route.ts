import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin';
import {
    RANK_POLITICIAN_BATCH_SIZE,
    runRankPoliticianScrapeBatch,
} from '@/lib/rank-politician/pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
    try {
        const admin = await requireAdminSession();
        if (!admin.ok) {
            return NextResponse.json({ error: admin.error }, { status: admin.status });
        }

        const body = await request.json().catch(() => ({}));
        const limit = Number(body?.limit) > 0 ? Number(body.limit) : RANK_POLITICIAN_BATCH_SIZE;
        const slugs = Array.isArray(body?.slugs)
            ? body.slugs.filter((s: unknown) => typeof s === 'string')
            : undefined;
        // Explicitly choosing a profile means "scrape it now", not "respect
        // the 20h success cooldown".
        const force = body?.force === true || Boolean(slugs?.length);

        const result = await runRankPoliticianScrapeBatch({ limit, slugs, force });

        return NextResponse.json({
            message: 'Scrape batch completed',
            ...result,
        });
    } catch (error: any) {
        console.error('Manual rank-politician scrape failed:', error);
        return NextResponse.json(
            { error: error?.message || 'Failed to scrape politicians' },
            { status: 500 }
        );
    }
}
