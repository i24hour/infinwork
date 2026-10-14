import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import Chain from '@/models/IChain';
import User from '@/models/User';
import { enforceChainVisitWindow } from '@/lib/ichain';
import { recomputeChainPointsForUsers } from '@/lib/chain-points';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeIdentifier = (value: string) => value.trim().toLowerCase();

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        await connectDB();
        const now = Date.now();
        const chainDocs = await Chain.find().sort({ maxTime: -1, createdAt: -1 });

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

        // Re-sort in memory because live updates might change the order
        chains.sort((a: any, b: any) => (b.maxTime || 0) - (a.maxTime || 0));

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

        // Add creator to the member list and normalize identifiers for case-insensitive matching
        const allMemberIdentifiers = [...new Set(
            [...memberIdentifiers, session.user.email]
                .map((identifier: string) => normalizeIdentifier(identifier))
                .filter(Boolean)
        )];

        const membersFromDb = await User.find({
            $or: [
                { email: { $in: allMemberIdentifiers } },
                {
                    $or: allMemberIdentifiers.map((identifier) => ({
                        username: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' },
                    })),
                },
            ],
        }).lean() as any[];

        const resolvedIdentifiers = new Set<string>();
        membersFromDb.forEach((user) => {
            if (user.email) resolvedIdentifiers.add(normalizeIdentifier(user.email));
            if (user.username) resolvedIdentifiers.add(normalizeIdentifier(user.username));
        });

        const missingIdentifiers = allMemberIdentifiers.filter((identifier) => !resolvedIdentifiers.has(identifier));
        if (missingIdentifiers.length > 0) {
            return NextResponse.json({
                error: `User not found: ${missingIdentifiers.join(', ')}`,
            }, { status: 400 });
        }

        // Get unique users for the identifiers (email or username) using the already-queried membersFromDb
        const userByIdentifier = new Map<string, any>();
        for (const user of membersFromDb) {
            if (user.email) userByIdentifier.set(normalizeIdentifier(user.email), user);
            if (user.username) userByIdentifier.set(normalizeIdentifier(user.username), user);
        }

        const seenEmails = new Set<string>();
        const members: Array<{
            userId: string;
            name: string;
            image: string | null;
            joinedAt: number;
            isWorking: boolean;
            contributionTime: number;
            lastVisitAt: number;
            parentId: string | null;
            isStarter: boolean;
        }> = [];

        for (const identifier of allMemberIdentifiers) {
            const user = userByIdentifier.get(identifier);
            if (!user?.email) continue;
            const userId = user.email;
            if (seenEmails.has(userId)) continue;
            seenEmails.add(userId);

            members.push({
                userId,
                name: user.username || userId.split('@')[0],
                image: user.image || null,
                joinedAt: Date.now(),
                isWorking: false,
                contributionTime: 0,
                lastVisitAt: Date.now(),
                parentId: userId === session.user?.email ? null : session.user?.email, // Creator is root
                isStarter: true,
            });
        }

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
