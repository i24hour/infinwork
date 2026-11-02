import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import {
    fetchGithubContributionCalendar,
    hasGithubCalendarToken,
} from '@/lib/github-contributions';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ username: string }> }
) {
    try {
        const { username } = await params;
        await connectDB();

        const user = await User.findOne({ username: username.toLowerCase() }).lean();
        if (!user?.githubUsername) {
            return NextResponse.json({ connected: false, calendar: null });
        }

        if (user.showGithubContributions === false) {
            return NextResponse.json({ connected: true, hidden: true, calendar: null });
        }

        if (!hasGithubCalendarToken(user.githubAccessToken)) {
            return NextResponse.json({
                connected: true,
                hidden: false,
                calendar: null,
                error: 'not_configured',
            });
        }

        const calendar = await fetchGithubContributionCalendar(
            user.githubUsername,
            user.githubAccessToken
        );
        if (!calendar) {
            return NextResponse.json({ connected: true, hidden: false, calendar: null, error: 'Unable to load contributions' });
        }

        return NextResponse.json({
            connected: true,
            hidden: false,
            username: user.githubUsername,
            calendar,
        });
    } catch (error) {
        console.error('Error fetching GitHub contributions:', error);
        return NextResponse.json({ error: 'Failed to fetch GitHub contributions' }, { status: 500 });
    }
}
