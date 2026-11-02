import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import SFTracker from '@/models/SFTracker';
import User from '@/models/User';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        await connectDB();

        // Only users with at least one target belong on the board. The old
        // version returned every account (and its email), including people who
        // never used SF Tracker.
        const allTargets = await SFTracker.find().lean() as any[];
        const targetUserIds = [...new Set(allTargets.map((target) => target.userId).filter(Boolean))];

        const allUsers = await User.find({ email: { $in: targetUserIds } })
            .select('email username image')
            .lean() as any[];

        const emailToUserMap = new Map<string, { publicId: string; username: string; image: string | null }>();
        allUsers.forEach((user) => {
            emailToUserMap.set(user.email, {
                publicId: user.username || String(user._id),
                username: user.username || 'Anonymous',
                image: user.image || null,
            });
        });

        const userStatsMap = new Map<string, any>();

        for (const target of allTargets) {
            const userId = target.userId;
            if (!userId) continue;

            if (!userStatsMap.has(userId)) {
                const userData = emailToUserMap.get(userId);
                userStatsMap.set(userId, {
                    publicId: userData?.publicId || null,
                    // Backwards-compatible alias for already-open clients.
                    userId: userData?.publicId || '',
                    username: userData?.username || 'Anonymous',
                    image: userData?.image || null,
                    totalTasks: 0,
                    successTasks: 0,
                    failureTasks: 0,
                    successRate: 0,
                });
            }

            const stats = userStatsMap.get(userId);
            stats.totalTasks += 1;

            if (target.status === 'Success') {
                stats.successTasks += 1;
            } else if (target.status === 'Failure') {
                stats.failureTasks += 1;
            }
        }

        const leaderboard = Array.from(userStatsMap.values());
        for (const entry of leaderboard) {
            entry.successRate = entry.totalTasks > 0
                ? Math.round((entry.successTasks / entry.totalTasks) * 1000) / 10
                : 0;
        }

        // Sort by success rate (the UI says so), then by absolute successes.
        leaderboard.sort((a, b) => {
            if (b.successRate !== a.successRate) return b.successRate - a.successRate;
            if (b.successTasks !== a.successTasks) return b.successTasks - a.successTasks;
            return b.totalTasks - a.totalTasks;
        });

        return NextResponse.json({ leaderboard });
    } catch (error) {
        console.error('Error fetching global SF Tracker leaderboard:', error);
        return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
    }
}
