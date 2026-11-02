import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import ITimeTask from '@/models/ITimeTask';
import User from '@/models/User';
import { autoCancelExpiredActiveTasks } from '@/lib/itime-runtime';
import { recomputeChainPointsForUsers } from '@/lib/chain-points';
import { isValidObjectIdString } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ userId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);

        const params = await context.params;
        const identifier = params.userId.trim();

        if (!identifier || identifier.length > 320) {
            return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
        }

        await connectDB();

        // Public links use a username (or Mongo id), never an email. Accept
        // email too for old bookmarks.
        const lookup: Record<string, unknown>[] = [
            { username: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } },
            { email: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } },
        ];
        if (isValidObjectIdString(identifier)) {
            lookup.push({ _id: identifier });
        }

        const user = await User.findOne({ $or: lookup }).lean() as any;
        if (!user?.email) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const targetEmail = user.email;

        // Run background maintenance asynchronously so public worker profile loads in a single parallel DB round-trip
        autoCancelExpiredActiveTasks({ userId: targetEmail }).catch((err) =>
            console.error('autoCancelExpiredActiveTasks failed in worker tasks route:', err)
        );
        recomputeChainPointsForUsers([targetEmail]).catch((err) =>
            console.error('recomputeChainPointsForUsers failed in worker tasks route:', err)
        );

        // Owners see all of their tasks; everyone else only sees public tasks.
        const isOwner = session?.user?.email?.toLowerCase() === targetEmail.toLowerCase();
        const taskQuery = isOwner
            ? { userId: targetEmail }
            : {
                userId: targetEmail,
                isPublic: { $ne: false },
                // Runtime-cancelled tasks are maintenance records, not work
                // the owner chose to publish.
                cancelledAt: { $exists: false },
            };

        const tasks = await ITimeTask.find(taskQuery).sort({ createdAt: -1 }).lean();
        // The task documents carry the owner's email in `userId`; the public
        // worker page doesn't need it.
        const safeTasks = tasks.map((task: any) => {
            const copy = { ...task };
            delete copy.userId;
            return copy;
        });

        return NextResponse.json({
            tasks: safeTasks,
            user: {
                username: user.username || 'Anonymous',
                image: user.image || null,
                isOwner,
                points: user.points || 0,
                githubPointsLastUpdatedAt: user.githubPointsLastUpdatedAt || user.githubConnectedAt || null,
                githubPointsHistory: user.githubPointsHistory || [],
                chainPoints: user.chainPoints || 0,
                chainPointsHistory: user.chainPointsHistory || []
            }
        });
    } catch (error) {
        console.error('Error fetching tasks for worker:', error);
        return NextResponse.json({ error: 'Failed to fetch tasks for worker' }, { status: 500 });
    }
}
