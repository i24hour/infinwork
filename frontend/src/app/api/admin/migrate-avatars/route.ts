import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { requireAdminSession } from '@/lib/admin';
import { migrateOversizedAvatars } from '@/lib/avatar-migrate';
import { isPlainObject, readJsonBody } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * One-off, admin-only. Call repeatedly until `remaining` is 0.
 *
 *   POST { "dryRun": true }   -> report only, writes nothing
 *   POST { "limit": 10 }      -> migrate up to 10 users
 */
export async function POST(request: NextRequest) {
    try {
        const admin = await requireAdminSession();
        if (!admin.ok) {
            return NextResponse.json({ error: admin.error }, { status: admin.status });
        }

        const parsed = await readJsonBody<unknown>(request);
        const body = parsed.ok && isPlainObject(parsed.body) ? parsed.body : {};

        await connectDB();
        const report = await migrateOversizedAvatars({
            dryRun: body.dryRun === true,
            limit: Number.isInteger(body.limit) ? (body.limit as number) : undefined,
        });
        return NextResponse.json(report);
    } catch (error) {
        console.error('Avatar migration failed:', error);
        return NextResponse.json({ error: 'Avatar migration failed' }, { status: 500 });
    }
}
