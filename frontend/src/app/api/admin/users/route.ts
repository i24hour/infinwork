import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { requireAdminSession } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const admin = await requireAdminSession();
        if (!admin.ok) {
            return NextResponse.json({ error: admin.error }, { status: admin.status });
        }

        await connectDB();
        const users = await User.find()
            .select('-githubAccessToken')
            .sort({ createdAt: -1 })
            .lean();

        return NextResponse.json({
            count: users.length,
            users,
        });
    } catch (error) {
        console.error('Error in admin users API:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const admin = await requireAdminSession();
        if (!admin.ok) {
            return NextResponse.json({ error: admin.error }, { status: admin.status });
        }

        const body = await request.json().catch(() => ({}));
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

        if (!email || !email.includes('@')) {
            return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
        }
        if (typeof body?.isAdmin !== 'boolean') {
            return NextResponse.json({ error: 'isAdmin must be a boolean' }, { status: 400 });
        }
        const isAdmin = body.isAdmin;

        await connectDB();

        // Prevent removing the last admin.
        if (!isAdmin) {
            const target = await User.findOne({ email }).select('isAdmin').lean();
            if (target?.isAdmin) {
                const adminCount = await User.countDocuments({ isAdmin: true });
                if (adminCount <= 1) {
                    return NextResponse.json(
                        { error: 'Cannot remove the last admin' },
                        { status: 400 }
                    );
                }
            }
        }

        const user = await User.findOneAndUpdate(
            { email },
            {
                $set: { isAdmin },
                $setOnInsert: { email },
            },
            { upsert: true, new: true }
        ).select('email username isAdmin');

        return NextResponse.json({
            message: isAdmin ? 'Admin granted' : 'Admin revoked',
            user: {
                email: user.email,
                username: user.username || null,
                isAdmin: Boolean(user.isAdmin),
            },
        });
    } catch (error) {
        console.error('Error updating admin flag:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
