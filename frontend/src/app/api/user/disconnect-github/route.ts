import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import User from '@/models/User';

export async function POST(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();

        // Find the user and unset all github fields + reset points checkpoint
        const result = await User.updateOne(
            { email },
            { 
                $unset: { 
                    githubId: "", 
                    githubUsername: "", 
                    githubAccessToken: "", 
                    githubConnectedAt: "",
                    lastGithubSyncAt: "",
                    githubCommitsTotal: "",
                    githubPointsLastUpdatedAt: "",
                    githubPointsHistory: "",
                    githubSyncLockUntil: "",
                    githubSyncLockId: "",
                    githubSyncRetryAt: "",
                    githubSyncError: "",
                },
                $set: {
                    points: 0  // Reset GitHub gamification points
                }
            }
        );

        if (result.matchedCount === 0) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error disconnecting GitHub:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
