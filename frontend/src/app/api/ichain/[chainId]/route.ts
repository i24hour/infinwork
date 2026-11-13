import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import Chain from '@/models/IChain';
import User from '@/models/User';
import { enforceChainVisitWindow } from '@/lib/ichain';
import { recomputeChainPointsForUsers } from '@/lib/chain-points';
import { findUsersWithAvatar, isDataImage } from '@/lib/avatar';
import {
    isPlainObject,
    isValidObjectIdString,
    readJsonBody,
} from '@/lib/validate';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAX_CHAIN_MEMBERS = 50;
const MAX_IDENTIFIER_LENGTH = 320;

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ chainId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        const { chainId } = await params;
        if (!isValidObjectIdString(chainId)) {
            return NextResponse.json({ error: 'Invalid chain ID' }, { status: 400 });
        }
        await connectDB();
        const chainDoc = await Chain.findById(chainId) as any;
        const chain = chainDoc?.toObject?.() || chainDoc;
        if (!chain) {
            return NextResponse.json({ error: 'Chain not found' }, { status: 404 });
        }

        const now = Date.now();
        let shouldPersist = false;
        let shouldRecomputeChainPoints = false;

        if (chainDoc && enforceChainVisitWindow(chainDoc, now)) {
            shouldPersist = true;
            shouldRecomputeChainPoints = true;
        }

        if (session?.user?.email && chainDoc?.members) {
            const visitingMember = chainDoc.members.find((member: any) => member.userId === session.user?.email);
            if (visitingMember && (!visitingMember.lastVisitAt || (now - visitingMember.lastVisitAt) > 60_000)) {
                visitingMember.lastVisitAt = now;
                shouldPersist = true;
            }
        }

        if (shouldPersist && chainDoc?.members) {
            if (chainDoc.status === 'Active' && chainDoc.lastStartedAt) {
                const chainElapsed = Math.floor((now - chainDoc.lastStartedAt) / 1000);
                if (chainElapsed > 0) {
                    chainDoc.totalTime += chainElapsed;
                    if (chainDoc.totalTime > (chainDoc.maxTime || 0)) {
                        chainDoc.maxTime = chainDoc.totalTime;
                    }
                    chainDoc.lastStartedAt = now;
                }
            }

            let memberContributionUpdated = false;
            chainDoc.members = chainDoc.members.map((member: any) => {
                if (!member.isWorking || !member.lastStartedAt) return member;
                const elapsed = Math.floor((now - member.lastStartedAt) / 1000);
                if (elapsed <= 0) return member;
                member.contributionTime += elapsed;
                member.lastStartedAt = now;
                memberContributionUpdated = true;
                return member;
            });

            if (memberContributionUpdated) {
                shouldRecomputeChainPoints = true;
            }
        }

        if (shouldPersist) {
            await chainDoc.save();
            if (shouldRecomputeChainPoints) {
                await recomputeChainPointsForUsers((chainDoc.members || []).map((member: any) => member.userId));
            }
            const refreshed = chainDoc.toObject();
            chain.status = refreshed.status;
            chain.totalTime = refreshed.totalTime;
            chain.maxTime = refreshed.maxTime;
            chain.lastStartedAt = refreshed.lastStartedAt;
            chain.burstAt = refreshed.burstAt;
            chain.members = refreshed.members;
        }

        // Fetch latest user info (username, image) for all members
        const memberEmails = chain.members.map((m: any) => m.userId);
        const users = await findUsersWithAvatar({ email: { $in: memberEmails } }, ['email', 'username']);
        const emailToUserMap = new Map();
        users.forEach(u => emailToUserMap.set(u.email, u));

        // Calculate live totalTime for Active status
        if (chain.status === 'Active' && chain.lastStartedAt) {
            chain.totalTime += Math.floor((now - chain.lastStartedAt) / 1000);
            chain.lastStartedAt = now;
        }

        // Calculate live contributionTime and update user info for each member
        chain.members = chain.members.map((member: any) => {
            const user = emailToUserMap.get(member.userId);
            if (user) {
                member.name = user.username || member.name;
                member.image = user.image || (isDataImage(member.image) ? null : member.image);
            }

            if (member.isWorking && member.lastStartedAt) {
                member.contributionTime += Math.floor((now - member.lastStartedAt) / 1000);
                member.lastStartedAt = now;
            }
            return member;
        });

        // We don't save back during GET to avoid unnecessary writes, but we return calculated values
        return NextResponse.json({ chain });
    } catch (error) {
        console.error('Error fetching chain detail:', error);
        return NextResponse.json({ error: 'Failed to fetch chain detail' }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ chainId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { chainId } = await params;
        if (!isValidObjectIdString(chainId)) {
            return NextResponse.json({ error: 'Invalid chain ID' }, { status: 400 });
        }

        const parsed = await readJsonBody<unknown>(request);
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        if (!isPlainObject(parsed.body)) {
            return NextResponse.json({ error: 'Invalid chain payload' }, { status: 400 });
        }

        const { isWorking, newMemberIdentifier, parentId } = parsed.body;
        if (isWorking !== undefined && typeof isWorking !== 'boolean') {
            return NextResponse.json({ error: 'isWorking must be a boolean' }, { status: 400 });
        }
        if (
            newMemberIdentifier !== undefined &&
            (typeof newMemberIdentifier !== 'string' ||
                newMemberIdentifier.trim().length === 0 ||
                newMemberIdentifier.length > MAX_IDENTIFIER_LENGTH)
        ) {
            return NextResponse.json({ error: 'Invalid member identifier' }, { status: 400 });
        }
        if (parentId !== undefined && parentId !== null && typeof parentId !== 'string') {
            return NextResponse.json({ error: 'Invalid parent member' }, { status: 400 });
        }

        await connectDB();

        const chain = await Chain.findById(chainId);
        if (!chain) {
            return NextResponse.json({ error: 'Chain not found' }, { status: 404 });
        }

        const memberIndex = chain.members.findIndex((m: any) => m.userId === session.user?.email);
        if (memberIndex === -1) {
            return NextResponse.json({ error: 'Not a member of this chain' }, { status: 403 });
        }

        const now = Date.now();
        // Enforce the 3h visit window BEFORE checking Burst. Previously a
        // request could be validated as Active, enforcement then burst the
        // chain, and the same request started a member again.
        enforceChainVisitWindow(chain, now);

        if (newMemberIdentifier) {
            if (chain.status === 'Burst') {
                return NextResponse.json({ error: 'Cannot add members to a burst chain' }, { status: 400 });
            }
            if (chain.members.length >= MAX_CHAIN_MEMBERS) {
                return NextResponse.json(
                    { error: `A chain can have at most ${MAX_CHAIN_MEMBERS} members` },
                    { status: 400 }
                );
            }

            const memberIdToFind = (newMemberIdentifier as string).trim().toLowerCase();
            const userToAdd = await User.findOne({
                $or: [
                    { email: memberIdToFind },
                    { username: { $regex: `^${escapeRegex(memberIdToFind)}$`, $options: 'i' } }
                ]
            }).lean() as any;

            if (!userToAdd?.email) {
                return NextResponse.json({ error: 'User not found in database' }, { status: 400 });
            }

            const userId = userToAdd.email;

            if (chain.members.find((m: any) => m.userId === userId)) {
                return NextResponse.json({ error: 'User is already a member of this chain' }, { status: 400 });
            }

            const resolvedParentId = typeof parentId === 'string' && parentId.trim()
                ? parentId.trim()
                : session.user.email;
            if (!chain.members.some((m: any) => m.userId === resolvedParentId)) {
                return NextResponse.json({ error: 'Parent member not found in this chain' }, { status: 400 });
            }

            chain.members.push({
                userId: userId,
                name: userToAdd?.username || userId.split('@')[0],
                image: userToAdd?.image || null,
                joinedAt: Date.now(),
                isWorking: false,
                contributionTime: 0,
                lastVisitAt: Date.now(),
                parentId: resolvedParentId,
                isStarter: false,
            });

            await chain.save();
            return NextResponse.json({ chain });
        }

        if (chain.status === 'Burst') {
            await chain.save();
            if (isWorking === false) {
                return NextResponse.json({ chain });
            }
            return NextResponse.json({ error: 'Chain has already burst' }, { status: 409 });
        }

        if (isWorking === undefined) {
            await chain.save();
            return NextResponse.json({ chain });
        }

        const member = chain.members[memberIndex];

        // Calculation logic
        if (isWorking !== undefined && member.isWorking !== isWorking) {
            if (member.isWorking) {
                // Was working, now stopping
                if (member.lastStartedAt) {
                    member.contributionTime += Math.floor((now - member.lastStartedAt) / 1000);
                }
                member.lastStartedAt = undefined;
            } else {
                // Was not working, now starting
                member.lastStartedAt = now;
            }
            member.isWorking = isWorking;
            if (isWorking) {
                member.lastVisitAt = now;
            }
        }

        // Update other working members' contributionTime to now so it's persisted correctly
        chain.members = chain.members.map((m: any, idx: number) => {
            if (idx !== memberIndex && m.isWorking && m.lastStartedAt) {
                m.contributionTime += Math.floor((now - m.lastStartedAt) / 1000);
                m.lastStartedAt = now;
            }
            return m;
        });

        // Update chain total time if it was active
        const currentlyActiveMembersCount = chain.members.filter((m: any) => m.isWorking).length;
        
        if (currentlyActiveMembersCount > 0) {
            if (chain.lastStartedAt) {
                chain.totalTime += Math.floor((now - chain.lastStartedAt) / 1000);
            }
            chain.lastStartedAt = now;
            chain.status = 'Active';
            // Update maxTime if current totalTime is higher
            if (chain.totalTime > (chain.maxTime || 0)) {
                chain.maxTime = chain.totalTime;
            }
        } else {
            // No one is working
            if (chain.status === 'Active') {
                if (chain.lastStartedAt) {
                    chain.totalTime += Math.floor((now - chain.lastStartedAt) / 1000);
                }
                chain.lastStartedAt = undefined;
                
                // Update maxTime before potential burst
                if (chain.totalTime > (chain.maxTime || 0)) {
                    chain.maxTime = chain.totalTime;
                }

                // If the last person just stopped, the chain bursts
                if (isWorking === false) {
                    chain.status = 'Burst';
                    chain.burstAt = now;
                } else {
                    chain.status = 'Idle';
                }
            } else {
                 // Already Idle or just created
                 chain.lastStartedAt = undefined;
            }
        }

        await chain.save();
        await recomputeChainPointsForUsers((chain.members || []).map((member: any) => member.userId));
        return NextResponse.json({ chain });
    } catch (error) {
        console.error('Error updating chain/work status:', error);
        return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ chainId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { chainId } = await params;
        if (!isValidObjectIdString(chainId)) {
            return NextResponse.json({ error: 'Invalid chain ID' }, { status: 400 });
        }
        await connectDB();

        const chain = await Chain.findById(chainId);
        if (!chain) {
            return NextResponse.json({ error: 'Chain not found' }, { status: 404 });
        }

        // Only creator can delete. Legacy chains without createdBy are only
        // deletable by a listed member (previously any signed-in user could).
        const isCreator = Boolean(chain.createdBy) && chain.createdBy === session.user.email;
        const isMember = chain.members.some((member: any) => member.userId === session.user.email);
        const isLegacyMemberOwner = !chain.createdBy && isMember;
        if (!isCreator && !isLegacyMemberOwner) {
            return NextResponse.json({ error: 'Only the creator can delete this chain' }, { status: 403 });
        }

        const memberEmails = (chain.members || []).map((member: any) => member.userId);
        await Chain.findByIdAndDelete(chainId);
        // Deleting a chain must also remove the points it awarded, otherwise
        // users can farm blocks and delete the evidence.
        await recomputeChainPointsForUsers(memberEmails);
        return NextResponse.json({ message: 'Chain deleted successfully' });
    } catch (error) {
        console.error('Error deleting chain:', error);
        return NextResponse.json({ error: 'Failed to delete chain' }, { status: 500 });
    }
}
