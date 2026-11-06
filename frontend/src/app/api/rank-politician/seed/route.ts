import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin';
import {
    STATE_MINISTER_COUNT,
    TOTAL_POLITICIAN_COUNT,
    UNION_CABINET_MINISTER_COUNT,
} from '@/lib/rank-politician/seed';
import { syncPoliticianSeeds } from '@/lib/rank-politician/seed-sync';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const admin = await requireAdminSession();
        if (!admin.ok) {
            return NextResponse.json({ error: admin.error }, { status: admin.status });
        }

        const result = await syncPoliticianSeeds({ recomputeAllStats: true });

        return NextResponse.json({
            message: `Seeded ${result.inserted} new politicians (${UNION_CABINET_MINISTER_COUNT} Union + ${STATE_MINISTER_COUNT} state/UT); ${result.updated} updated`,
            upserted: result.inserted,
            updated: result.updated,
            deactivated: result.deactivated,
            handleResets: result.handleResets,
            slugMigrations: result.slugMigrations,
            cabinetTarget: UNION_CABINET_MINISTER_COUNT,
            stateTarget: STATE_MINISTER_COUNT,
            totalTarget: TOTAL_POLITICIAN_COUNT,
            withXHandle: result.withXHandle,
            withoutXHandle: result.withoutXHandle,
            totalActive: result.totalActive,
            totalInactive: result.totalInactive,
        });
    } catch (error: any) {
        console.error('Error seeding politicians:', error);
        return NextResponse.json(
            { error: error?.message || 'Failed to seed politicians' },
            { status: 500 }
        );
    }
}
