import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
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
        const session = await getServerSession(authOptions);

        const params = await context.params;
        const targetUserId = decodeURIComponent(params.userId);

        if (!targetUserId || typeof targetUserId !== 'string' || targetUserId.length > 320) {
            return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
        }

        await connectDB();
        await autoCancelExpiredActiveTasks({ userId: targetUserId });
        await recomputeChainPointsForUsers([targetUserId]);

        const user = await User.findOne({ email: targetUserId }).lean() as any;

        // Owners see all of their tasks; everyone else only sees public tasks.
        const isOwner = session?.user?.email?.toLowerCase() === targetUserId.toLowerCase();
        const taskQuery = isOwner
            ? { userId: targetUserId }
            : { userId: targetUserId, isPublic: { $ne: false } };

        const tasks = await ITimeTask.find(taskQuery).sort({ createdAt: -1 });

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
