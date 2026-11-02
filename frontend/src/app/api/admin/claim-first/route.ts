import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { claimFirstAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Optional hardening: when set, only this address may bootstrap the
        // first admin. Without it, the first authenticated visitor can claim.
        const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
        if (bootstrapEmail && session.user.email.toLowerCase() !== bootstrapEmail) {
            return NextResponse.json({ error: 'This account cannot bootstrap admin access.' }, { status: 403 });
        }

        const result = await claimFirstAdmin(session.user.email);
        if (!result.claimed) {
            return NextResponse.json(
                { error: result.reason || 'Could not claim first admin' },
                { status: 409 }
            );
        }

        return NextResponse.json({
            message: 'First admin claimed',
            email: session.user.email,
            isAdmin: true,
        });
    } catch (error: any) {
        console.error('claim-first admin failed:', error);
        return NextResponse.json(
            { error: error?.message || 'Failed to claim first admin' },
            { status: 500 }
        );
    }
}
