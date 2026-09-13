import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { normalizeUserId, userIdentifierQuery } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const identifier = normalizeUserId(searchParams.get('identifier'));

        if (!identifier) {
            return NextResponse.json({ exists: false, error: 'Identifier is required' }, { status: 400 });
        }

        await connectDB();

        const user = await User.findOne(userIdentifierQuery(identifier)).lean() as any;

        return NextResponse.json({
            exists: !!user,
            user: user
                ? {
                    email: user.email,
                    username: user.username,
                    image: user.image,
                }
                : null,
        });
    } catch (error) {
        console.error('Error looking up user:', error);
        return NextResponse.json({ exists: false, error: 'Failed to look up user' }, { status: 500 });
    }
}