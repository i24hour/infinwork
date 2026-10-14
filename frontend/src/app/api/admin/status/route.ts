import { NextResponse } from 'next/server';
import { countAdmins } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const adminCount = await countAdmins();
        return NextResponse.json({
            hasAdmin: adminCount > 0,
        });
    } catch (error: any) {
        console.error('admin status failed:', error);
        return NextResponse.json(
            { error: error?.message || 'Failed to read admin status' },
            { status: 500 }
        );
    }
}
