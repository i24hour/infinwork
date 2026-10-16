import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import ITimeTask from '@/models/ITimeTask';
import { ensureUserHasDefaultUsername } from '@/lib/username';
import { syncGithubForUserByEmail } from '@/lib/github-sync';
import { getScoreBreakdownAtTime } from '@/lib/score';
import { recomputeChainPointsForUsers } from '@/lib/chain-points';

export async function GET(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        await connectDB();

        // Trigger GitHub auto-sync and chain points recomputation asynchronously so settings/sidebar reads never block
        syncGithubForUserByEmail(email).catch((syncError) => {
            console.error('GitHub auto-sync failed in settings route:', syncError);
        });
        recomputeChainPointsForUsers([email]).catch((chainError) => {
            console.error('Chain points recompute failed in settings route:', chainError);
        });

        const [existingUser, tasks] = await Promise.all([
            User.findOne({ email: email.trim().toLowerCase() }).lean(),
            ITimeTask.find({ userId: email })
                .select('startTime pausedElapsed enabled completed completedAt events')
                .lean(),
        ]);

        const user = existingUser?.username
            ? existingUser
            : await ensureUserHasDefaultUsername(email);

        const scoreBreakdown = getScoreBreakdownAtTime(
            tasks,
            Date.now(),
            user?.points || 0,
            user?.githubPointsLastUpdatedAt || user?.githubConnectedAt || null,
            user?.githubPointsHistory || null,
            user?.chainPoints || 0,
            user?.chainPointsHistory || null
        );

        return NextResponse.json({ 
            username: user?.username || '', 
            email,
            isAdmin: Boolean(user?.isAdmin),
            points: scoreBreakdown.githubPoints,
            chainPoints: scoreBreakdown.chainPoints,
            totalScore: scoreBreakdown.totalScore,
            baseScore: scoreBreakdown.penalizedBaseScore,
            idlePenalty: scoreBreakdown.idlePenalty,
            githubUsername: user?.githubUsername || null,
            lastGithubSyncAt: user?.lastGithubSyncAt || null,
            githubPointsLastUpdatedAt: user?.githubPointsLastUpdatedAt || user?.githubConnectedAt || null,
            githubPointsHistory: user?.githubPointsHistory || [],
            chainPointsHistory: user?.chainPointsHistory || []
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { username } = await request.json();
        
        if (!username || username.length < 3) {
            return NextResponse.json({ error: 'Username must be at least 3 characters long' }, { status: 400 });
        }

        // Basic character validation
        const usernameRegex = /^[a-zA-Z0-9_]+$/;
        if (!usernameRegex.test(username)) {
            return NextResponse.json({ error: 'Username can only contain letters, numbers, and underscores' }, { status: 400 });
        }

        await connectDB();

        // Check if username is already taken by someone else
        const lowerUsername = username.trim().toLowerCase();
        const existingUser = await User.findOne({ 
            username: lowerUsername, 
            email: { $ne: session.user.email } 
        });

        if (existingUser) {
            return NextResponse.json({ error: 'Username is already taken' }, { status: 409 });
        }

        // Upsert the user document
        const updatedUser = await User.findOneAndUpdate(
            { email: session.user.email },
            { $set: { username: lowerUsername } },
            { new: true, upsert: true }
        );

        return NextResponse.json({ success: true, username: updatedUser.username });
    } catch (error) {
        console.error('Error updating settings:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
