import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import Chain from '@/models/IChain';
import User from '@/models/User';
import { enforceChainVisitWindow } from '@/lib/ichain';
import { recomputeChainPointsForUsers } from '@/lib/chain-points';
import { normalizeUserId, sameUserId, userIdentifierQuery } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        await connectDB();
        const now = Date.now();
        const chainDocs = await Chain.find().sort({ createdAt: -1 });

        await Promise.all(chainDocs.map(async (chainDoc: any) => {
            if (enforceChainVisitWindow(chainDoc, now)) {
                await chainDoc.save();
                await recomputeChainPointsForUsers((chainDoc.members || []).map((member: any) => member.userId));
            }
        }));

        let chains = chainDocs.map((chainDoc: any) => chainDoc.toObject());

        // Calculate live totalTime for Active status chains
        chains = chains.map((chain: any) => {
            if (chain.status === 'Active' && chain.lastStartedAt) {
                const liveTotalTime = chain.totalTime + Math.floor((now - chain.lastStartedAt) / 1000);
                chain.totalTime = liveTotalTime;
                // Temporarily update maxTime for ranking in UI if it's currently higher
                if (liveTotalTime > (chain.maxTime || 0)) {
                    chain.maxTime = liveTotalTime;
                }
            } else if (chain.status === 'Idle' && chain.totalTime > 0) {
                // Auto-repair bugged legacy chains that paused into 'Idle' instead of 'Burst'
                chain.status = 'Burst';
                if (!chain.maxTime) chain.maxTime = chain.totalTime;
                // Fire and forget background fix
                Chain.updateOne(
                    { _id: chain._id }, 
                    { $set: { status: 'Burst', maxTime: chain.maxTime } }
                ).catch(console.error);
            }
            return chain;
        });

        return NextResponse.json({ chains });
    } catch (error) {
        console.error('Error fetching chains:', error);
        return NextResponse.json({ error: 'Failed to fetch chains' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { name, members: memberIdentifiers, whatsappLink } = body;

        if (!name || !memberIdentifiers || !Array.isArray(memberIdentifiers)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        await connectDB();

        const allMemberIdentifiers = [...new Set(
            [...memberIdentifiers, session.user.email]
                .map((identifier: string) => normalizeUserId(identifier))
                .filter(Boolean)
        )];

        const membersFromDb = await User.find({
            $or: allMemberIdentifiers.map((identifier) => userIdentifierQuery(identifier)),
        }).lean() as any[];

        const resolvedIdentifiers = new Set<string>();
        membersFromDb.forEach((user) => {
            if (user.email) resolvedIdentifiers.add(normalizeUserId(user.email));
            if (user.username) resolvedIdentifiers.add(normalizeUserId(user.username));
        });

        const missingIdentifiers = allMemberIdentifiers.filter((identifier) => !resolvedIdentifiers.has(identifier));
        if (missingIdentifiers.length > 0) {
            return NextResponse.json({
                error: `User not found: ${missingIdentifiers.join(', ')}`,
            }, { status: 400 });
        }

        const members = await Promise.all(allMemberIdentifiers.map(async (identifier: string) => {
            const user = await User.findOne(userIdentifierQuery(identifier)).lean() as any;
            const userId = user!.email;

            return {
                userId: userId,
                name: user?.username || userId.split('@')[0],
                image: user?.image || null,
                joinedAt: Date.now(),
                isWorking: false,
                contributionTime: 0,
                lastVisitAt: Date.now(),
                parentId: sameUserId(userId, session.user?.email) ? null : session.user?.email,
                isStarter: true,
            };
        }));

        const chain = await Chain.create({
            name,
            whatsappLink,
            members,
            status: 'Idle',
            totalTime: 0,
            createdBy: session.user.email, // Optional: tracking who created it
        });

        return NextResponse.json({ chain }, { status: 201 });
    } catch (error) {
        console.error('Error creating chain:', error);
        return NextResponse.json({ error: 'Failed to create chain' }, { status: 500 });
    }
}
