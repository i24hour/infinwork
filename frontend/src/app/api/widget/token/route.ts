import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { createWidgetToken } from '@/lib/widget-token';

export const dynamic = 'force-dynamic';

/** Create a widget key. The previous key stops working. The raw key is shown once. */
export async function POST(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const issued = createWidgetToken();
        const user = await User.findOneAndUpdate(
            { email: email.trim().toLowerCase() },
            {
                $set: {
                    widgetTokenHash: issued.hash,
                    widgetTokenPrefix: issued.prefix,
                    widgetTokenCreatedAt: new Date(),
                },
            },
            { new: true }
        ).lean();
        if (!user) {
            return NextResponse.json({ error: 'Account not found' }, { status: 404 });
        }

        return NextResponse.json({
            token: issued.token,
            prefix: issued.prefix,
            createdAt: user?.widgetTokenCreatedAt || new Date().toISOString(),
        });
    } catch (error) {
        console.error('Widget key create failed:', error);
        return NextResponse.json({ error: 'Failed to create widget key' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        await User.updateOne(
            { email: email.trim().toLowerCase() },
            { $unset: { widgetTokenHash: 1, widgetTokenPrefix: 1, widgetTokenCreatedAt: 1 } }
        );

        return NextResponse.json({ connected: false });
    } catch (error) {
        console.error('Widget key revoke failed:', error);
        return NextResponse.json({ error: 'Failed to disconnect widget' }, { status: 500 });
    }
}
