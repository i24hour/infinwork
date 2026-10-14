import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import ITimeTask from '@/models/ITimeTask';
import User from '@/models/User';
import { autoCancelExpiredActiveTasks } from '@/lib/itime-runtime';
import { recomputeChainPointsForUsers } from '@/lib/chain-points';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ userId: string }> }
) {
    try {
        // Authentication intentionally removed so anyone can view a worker's public profile tasks
        // const session = await getServerSession(authOptions);

        const params = await context.params;
        const targetUserId = decodeURIComponent(params.userId);

        if (!targetUserId) {
            return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
        }

        await connectDB();

        // Run background maintenance asynchronously so public worker profile loads in a single parallel DB round-trip
        autoCancelExpiredActiveTasks({ userId: targetUserId }).catch((err) =>
            console.error('autoCancelExpiredActiveTasks failed in worker tasks route:', err)
        );
        recomputeChainPointsForUsers([targetUserId]).catch((err) =>
            console.error('recomputeChainPointsForUsers failed in worker tasks route:', err)
        );

        const [user, tasks] = await Promise.all([
            User.findOne({ email: targetUserId }).lean() as Promise<any>,
            ITimeTask.find({ userId: targetUserId }).sort({ createdAt: -1 }).lean(),
        ]);

        return NextResponse.json({ 
            tasks, 
            user: {
                username: user?.username || targetUserId.split('@')[0],
                image: user?.image || null,
                points: user?.points || 0,
                githubPointsLastUpdatedAt: user?.githubPointsLastUpdatedAt || user?.githubConnectedAt || null,
                githubPointsHistory: user?.githubPointsHistory || [],
                chainPoints: user?.chainPoints || 0,
                chainPointsHistory: user?.chainPointsHistory || []
            } 
        });
    } catch (error) {
        console.error('Error fetching tasks for worker:', error);
        return NextResponse.json({ error: 'Failed to fetch tasks for worker' }, { status: 500 });
    }
}
