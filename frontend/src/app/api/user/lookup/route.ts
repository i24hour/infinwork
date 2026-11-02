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
        const identifier = (searchParams.get('identifier') || '').trim().toLowerCase();

        if (!identifier) {
            return NextResponse.json({ exists: false, error: 'Identifier is required' }, { status: 400 });
        }

        await connectDB();

        const user = await User.findOne({
            $or: [
                { email: identifier },
                { username: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } }
            ]
        }).lean() as any;

        return NextResponse.json({
            exists: !!user,
            user: user
                ? {
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