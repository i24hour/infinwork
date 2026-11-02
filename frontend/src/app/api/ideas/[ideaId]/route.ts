import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import Idea from '@/models/Idea';
import Reply from '@/models/Reply';
import User from '@/models/User';
import {
    isPlainObject,
    isValidObjectIdString,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

// GET /api/ideas/[ideaId]
// Fetch a single idea by ID — private ideas are only visible to their owner
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ ideaId: string }> }
) {
    try {
        const viewerEmail = await getAuthorizedEmail(request);
        const { ideaId } = await params;

        if (!isValidObjectIdString(ideaId)) {
            return NextResponse.json({ error: 'Invalid idea ID' }, { status: 400 });
        }

        await connectDB();
        const idea = await Idea.findById(ideaId).lean();

        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        const viewerKey = viewerEmail?.toLowerCase();
        if (!idea.isPublic && String(idea.createdBy).toLowerCase() !== viewerKey) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        const author = await User.findOne({ email: idea.createdBy })
            .select('username')
            .lean() as any;

        return NextResponse.json({
            idea: {
                _id: idea._id,
                title: idea.title,
                details: idea.details,
                isPublic: idea.isPublic,
                createdAt: idea.createdAt,
                updatedAt: idea.updatedAt,
                isOwner: Boolean(viewerKey) && String(idea.createdBy).toLowerCase() === viewerKey,
                username: author?.username || 'Anonymous',
                // Display alias for already-open clients; not an email.
                createdBy: author?.username || 'Anonymous',
            },
        });
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
        const email = await getAuthorizedEmail(request);

        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ideaId } = await params;
        if (!isValidObjectIdString(ideaId)) {
            return NextResponse.json({ error: 'Invalid idea ID' }, { status: 400 });
        }

        // PATCH may legitimately have no body (legacy toggle call), so parse
        // it optionally instead of rejecting an empty request.
        let body: unknown = {};
        try {
            const raw = await request.text();
            body = raw.trim() ? JSON.parse(raw) : {};
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        if (!isPlainObject(body)) {
            return NextResponse.json({ error: 'Invalid idea payload' }, { status: 400 });
        }

        const { isPublic } = body;
        if (isPublic !== undefined && typeof isPublic !== 'boolean') {
            return NextResponse.json({ error: 'isPublic must be a boolean' }, { status: 400 });
        }

        await connectDB();

        const idea = await Idea.findById(ideaId);

        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        if (String(idea.createdBy).toLowerCase() !== email.toLowerCase()) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Prefer the explicit value so two tabs cannot toggle each other into
        // the wrong state. Fall back to a toggle for older clients.
        idea.isPublic = typeof isPublic === 'boolean' ? isPublic : !idea.isPublic;
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
        const email = await getAuthorizedEmail(request);

        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ideaId } = await params;
        if (!isValidObjectIdString(ideaId)) {
            return NextResponse.json({ error: 'Invalid idea ID' }, { status: 400 });
        }
        await connectDB();

        const idea = await Idea.findById(ideaId);

        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        if (String(idea.createdBy).toLowerCase() !== email.toLowerCase()) {
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
