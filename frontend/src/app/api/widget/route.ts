import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import ITimeTask from '@/models/ITimeTask';
import { buildWidgetSnapshot } from '@/lib/widget-snapshot';
import { hashWidgetToken, isWidgetToken } from '@/lib/widget-token';

export const dynamic = 'force-dynamic';

function bearerToken(request: NextRequest): string | null {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    return isWidgetToken(token) ? token : null;
}

/** Live snapshot for the Android and Mac widgets. */
export async function GET(request: NextRequest) {
    try {
        const token = bearerToken(request);
        if (!token) {
            return NextResponse.json({ error: 'Widget key required' }, { status: 401 });
        }

        await connectDB();
        const user = await User.findOne({ widgetTokenHash: hashWidgetToken(token) }).lean();
        if (!user?.email) {
            return NextResponse.json({ error: 'Widget key is not valid' }, { status: 401 });
        }

        const tasks = await ITimeTask.find({ userId: user.email })
            .collation({ locale: 'en', strength: 2 })
            .select('title startTime pausedElapsed enabled completed completedAt cancelledAt events')
            .lean();

        const snapshot = buildWidgetSnapshot({
            username: user.username || user.email.split('@')[0],
            tasks,
            points: user.points || 0,
            githubPointsLastUpdatedAt: user.githubPointsLastUpdatedAt || user.githubConnectedAt || null,
            githubPointsHistory: user.githubPointsHistory || null,
            chainPoints: user.chainPoints || 0,
            chainPointsHistory: user.chainPointsHistory || null,
        });

        return NextResponse.json(snapshot, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        console.error('Widget snapshot failed:', error);
        return NextResponse.json({ error: 'Failed to load widget' }, { status: 500 });
    }
}
