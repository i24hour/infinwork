import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import User from '@/models/User';
import ITimeTask from '@/models/ITimeTask';
import { syncGithubForUser } from '@/lib/github-sync';
import { getScoreBreakdownAtTime } from '@/lib/score';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();

        const user = await User.findOne({ email });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        if (!user.githubUsername) {
            return NextResponse.json({ error: 'GitHub account not connected.' }, { status: 400 });
        }

        const result = await syncGithubForUser(user, { force: true });

        if (result.status === 'error') {
            const status = result.errorCode === 'rate_limited' ? 429 : 400;
            return NextResponse.json(
                {
                    error: result.error || 'GitHub sync failed.',
                    errorCode: result.errorCode,
                    reconnectRequired: Boolean(result.reconnectRequired),
                },
                { status }
            );
        }

        const refreshedUser = await User.findById(user._id).lean();
        const tasks = await ITimeTask.find({ userId: email }).lean();
        const scoreBreakdown = getScoreBreakdownAtTime(
            tasks,
            Date.now(),
            refreshedUser?.points || 0,
            refreshedUser?.githubPointsLastUpdatedAt || refreshedUser?.githubConnectedAt || null,
            refreshedUser?.githubPointsHistory || null,
            refreshedUser?.chainPoints || 0,
            refreshedUser?.chainPointsHistory || null
        );

        return NextResponse.json({
            message: result.status === 'skipped'
                ? (result.reason === 'locked'
                    ? 'A sync is already in progress. Please try again in a moment.'
                    : 'GitHub was synced recently; no new data yet.')
                : (result.newCommits > 0 ? 'GitHub commits synced!' : 'No new commits since last sync.'),
            synced: result.status === 'synced',
            skipped: result.status === 'skipped',
            reason: result.reason,
            newCommits: result.newCommits,
            pointsEarned: result.pointsEarned,
            githubPoints: scoreBreakdown.githubPoints,
            totalPoints: scoreBreakdown.totalScore,
            isFirstSync: result.isFirstSync,
            lastGithubSyncAt: result.lastGithubSyncAt,
            githubPointsLastUpdatedAt: result.githubPointsLastUpdatedAt,
            githubPointsHistory: refreshedUser?.githubPointsHistory || [],
            chainPoints: refreshedUser?.chainPoints || 0,
            chainPointsHistory: refreshedUser?.chainPointsHistory || [],
        });
    } catch (error) {
        console.error('Error syncing GitHub:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
