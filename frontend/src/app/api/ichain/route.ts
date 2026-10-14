import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import Chain from '@/models/IChain';
import User from '@/models/User';
import { enforceChainVisitWindow } from '@/lib/ichain';
import { recomputeChainPointsForUsers } from '@/lib/chain-points';
import { isAllowedExternalLink, isPlainObject, readJsonBody } from '@/lib/validate';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeIdentifier = (value: string) => value.trim().toLowerCase();

const MAX_CHAIN_NAME_LENGTH = 100;
const MAX_CHAIN_MEMBERS = 50;
const MAX_IDENTIFIER_LENGTH = 320;

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

        const parsed = await readJsonBody<unknown>(request);
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        if (!isPlainObject(parsed.body)) {
            return NextResponse.json({ error: 'Invalid chain payload' }, { status: 400 });
        }
        const { name, members: memberIdentifiers, whatsappLink } = parsed.body;

        if (typeof name !== 'string' || name.trim().length === 0) {
            return NextResponse.json({ error: 'Chain name is required' }, { status: 400 });
        }
        if (name.trim().length > MAX_CHAIN_NAME_LENGTH) {
            return NextResponse.json({ error: `Chain name must be at most ${MAX_CHAIN_NAME_LENGTH} characters` }, { status: 400 });
        }
        if (!Array.isArray(memberIdentifiers)) {
            return NextResponse.json({ error: 'Members must be an array' }, { status: 400 });
        }
        if (memberIdentifiers.length > MAX_CHAIN_MEMBERS) {
            return NextResponse.json({ error: `A chain can have at most ${MAX_CHAIN_MEMBERS} members` }, { status: 400 });
        }
        if (!memberIdentifiers.every((id): id is string => typeof id === 'string' && id.length <= MAX_IDENTIFIER_LENGTH)) {
            return NextResponse.json({ error: 'Invalid member identifier' }, { status: 400 });
        }
        if (whatsappLink != null && whatsappLink !== '' && !isAllowedExternalLink(whatsappLink)) {
            return NextResponse.json({ error: 'WhatsApp link must be a valid https:// URL' }, { status: 400 });
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

        // Get unique users for the identifiers (email or username)
        const members = await Promise.all(allMemberIdentifiers.map(async (identifier: string) => {
            const user = await User.findOne({ 
                $or: [
                    { email: identifier },
                    { username: { $regex: `^${escapeRegex(identifier)}$`, $options: 'i' } }
                ] 
            }).lean() as any;
            
            const userId = user!.email;

            return {
                userId: userId,
                name: user?.username || userId.split('@')[0],
                image: user?.image || null,
                joinedAt: Date.now(),
                isWorking: false,
                contributionTime: 0,
                lastVisitAt: Date.now(),
                parentId: userId === session.user?.email ? null : session.user?.email, // Creator is root
                isStarter: true,
            };
        }));

        const chain = await Chain.create({
            name: name.trim(),
            whatsappLink: typeof whatsappLink === 'string' ? whatsappLink.trim() : undefined,
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
