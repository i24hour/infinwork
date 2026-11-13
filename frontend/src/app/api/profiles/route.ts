import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { findUsersWithAvatar } from '@/lib/avatar';
import { serializePublicProfile } from '@/lib/profile-utils';

export async function GET() {
    try {
        await connectDB();

        const users = await findUsersWithAvatar({
            username: { $exists: true, $ne: null },
            $or: [
                { 'projects.0': { $exists: true } },
                { bio: { $exists: true, $nin: [null, ''] } },
                { headline: { $exists: true, $nin: [null, ''] } },
            ],
        }, undefined, { sort: { updatedAt: -1 }, limit: 100 });

        const profiles = users
            .map((user) => serializePublicProfile(user as Parameters<typeof serializePublicProfile>[0]))
            .filter(Boolean);

        return NextResponse.json({ profiles });
    } catch (error) {
        console.error('Error fetching profiles:', error);
        return NextResponse.json({ error: 'Failed to fetch profiles', profiles: [] }, { status: 500 });
    }
}
