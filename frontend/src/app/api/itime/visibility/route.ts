import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import ITimeTask from '@/models/ITimeTask';
import { isPlainObject, readJsonBody } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/** Hide or show every task for the signed-in person in one action. */
export async function POST(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = await readJsonBody<unknown>(request);
        if (!parsed.ok || !isPlainObject(parsed.body) || typeof parsed.body.hidden !== 'boolean') {
            return NextResponse.json({ error: 'hidden must be true or false' }, { status: 400 });
        }

        const hidden = parsed.body.hidden;
        const normalized = email.trim().toLowerCase();
        await connectDB();

        const updated = await ITimeTask.updateMany(
            { userId: email },
            { $set: { isPublic: !hidden } }
        );

        await User.updateOne(
            { email: { $in: [email.trim(), normalized] } },
            { $set: { tasksHidden: hidden } }
        );

        return NextResponse.json({
            allTasksHidden: hidden,
            updated: updated.modifiedCount,
        });
    } catch (error) {
        console.error('Task visibility update failed:', error);
        return NextResponse.json({ error: 'Failed to update tasks' }, { status: 500 });
    }
}
