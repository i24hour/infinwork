import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import Idea from '@/models/Idea';
import Reply from '@/models/Reply';
import { isValidObjectIdString } from '@/lib/validate';

export const dynamic = 'force-dynamic';

// GET /api/ideas/[ideaId]
// Fetch a single idea by ID — private ideas are only visible to their owner
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ ideaId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        const { ideaId } = await params;

        if (!isValidObjectIdString(ideaId)) {
            return NextResponse.json({ error: 'Invalid idea ID' }, { status: 400 });
        }

        await connectDB();
        const idea = await Idea.findById(ideaId).lean();

        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        if (!idea.isPublic && idea.createdBy !== session?.user?.email) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        return NextResponse.json({ idea });
    } catch (error) {
        console.error('Error fetching idea:', error);
        return NextResponse.json({ error: 'Failed to fetch idea' }, { status: 500 });
    }
}

// PATCH /api/ideas/[ideaId]
// Toggle isPublic — only the owner can do this
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ ideaId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ideaId } = await params;
        await connectDB();

        const idea = await Idea.findById(ideaId);

        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        if (idea.createdBy !== session.user.email) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        idea.isPublic = !idea.isPublic;
        await idea.save();

        return NextResponse.json({ idea });
    } catch (error) {
        console.error('Error updating idea:', error);
        return NextResponse.json({ error: 'Failed to update idea' }, { status: 500 });
    }
}

// DELETE /api/ideas/[ideaId]
// Delete an idea — only the owner can do this
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ ideaId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ideaId } = await params;
        await connectDB();

        const idea = await Idea.findById(ideaId);

        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        if (idea.createdBy !== session.user.email) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await idea.deleteOne();
        await Reply.deleteMany({ ideaId: idea._id });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting idea:', error);
        return NextResponse.json({ error: 'Failed to delete idea' }, { status: 500 });
    }
}
