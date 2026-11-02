import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import SFTracker from '@/models/SFTracker';
import User from '@/models/User';
import { isValidObjectIdString } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { userId } = await params;
        // Next already decodes route params; decoding again throws on a literal %.
        const identifier = userId.trim();
        if (!identifier || identifier.length > 320) {
            return NextResponse.json({ error: 'Invalid user identifier' }, { status: 400 });
        }

        await connectDB();

        const lookup: Record<string, unknown>[] = [
            { username: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } },
            { email: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } },
        ];
        if (isValidObjectIdString(identifier)) {
            lookup.push({ _id: identifier });
        }

        const profile = await User.findOne({ $or: lookup }).lean() as any;
        if (!profile?.email) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const userProfile = {
            username: profile.username || profile.email.split('@')[0],
            image: profile.image || null,
        };

        const rawTargets = await SFTracker.find({ userId: profile.email })
            .sort({ createdAt: -1 })
            .lean() as any[];

        // 3. SECURE DATA SCRUBBING
        // We MUST enforce privacy. No target strings, success conditions, or failure reasons leak here.
        const sanitizedTargets = rawTargets.map(target => ({
            _id: target._id,
            status: target.status,
            createdAt: target.createdAt,
            updatedAt: target.updatedAt,
            // Censorship Overrides:
            target: "🔒 Hidden for Privacy",
            successCondition: "🔒 Classified Objective",
            failureReason: target.failureReason ? "🔒 Private Reflection Logged" : ""
        }));

        // Compute aggregations directly
        const stats = {
            totalTasks: sanitizedTargets.length,
            successTasks: sanitizedTargets.filter(t => t.status === 'Success').length,
            failureTasks: sanitizedTargets.filter(t => t.status === 'Failure').length,
        };

        return NextResponse.json({
            user: userProfile,
            stats,
            targets: sanitizedTargets
        });

    } catch (error) {
        console.error('Error fetching Read-Only user SF data:', error);
        return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 500 });
    }
}
