import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin';
import { CABINET_MINISTER_COUNT } from '@/lib/rank-politician/seed';
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
            message: `Seeded ${result.seeded} cabinet ministers; deactivated ${result.deactivated} non-cabinet profiles`,
            upserted: result.seeded,
            deactivated: result.deactivated,
            handleResets: result.handleResets,
            cabinetTarget: CABINET_MINISTER_COUNT,
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
