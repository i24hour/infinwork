import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import User from '@/models/User';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        if (!(await getAuthorizedEmail(request))) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const query = (searchParams.get('q') || '').trim();

        if (!query) {
            return NextResponse.json({ users: [] });
        }

        await connectDB();

        const searchRegex = new RegExp(escapeRegex(query), 'i');

        // Search by username only. Matching partial emails let any signed-in
        // user enumerate the entire account list.
        const users = await User.find({ username: searchRegex })
        .select('username image')
        .limit(10)
        .lean() as any[];

        const formattedUsers = users.map(user => ({
            username: user.username,
            image: user.image,
        }));

        return NextResponse.json({ users: formattedUsers });
    } catch (error) {
        console.error('Error searching users:', error);
        return NextResponse.json({ error: 'Failed to search users' }, { status: 500 });
    }
}
