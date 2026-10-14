import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import Idea from '@/models/Idea';
import Reply from '@/models/Reply';
import User from '@/models/User';
import { isValidObjectIdString } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const MAX_REPLY_CONTENT_LENGTH = 5000;

const MAX_REPLY_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function normalizeReplyImage(imageUrl: unknown): { imageUrl?: string; error?: string } {
    if (imageUrl == null || imageUrl === '') {
        return {};
    }

    if (typeof imageUrl !== 'string') {
        return { error: 'Invalid image payload' };
    }

    const normalizedImageUrl = imageUrl.trim();

    if (!ALLOWED_IMAGE_DATA_URL.test(normalizedImageUrl)) {
        return { error: 'Only PNG, JPG, WEBP, and GIF images are supported' };
    }

    const base64Payload = normalizedImageUrl.split(',')[1] ?? '';
    const imageBytes = Buffer.byteLength(base64Payload, 'base64');

    if (imageBytes > MAX_REPLY_IMAGE_BYTES) {
        return { error: 'Image too large (max 2MB)' };
    }

    return { imageUrl: normalizedImageUrl };
}

// GET /api/ideas/[ideaId]/replies
// Rules:
// - Public replies: everyone can see if the idea is public or they are the idea owner
// - Private replies: only the creator of the reply and the owner of the idea can see
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

        const idea = await Idea.findById(ideaId);
        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        const userEmail = session?.user?.email;
        const isIdeaOwner = userEmail === idea.createdBy;

        if (!idea.isPublic && !isIdeaOwner) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        let query: any = { ideaId };

        if (isIdeaOwner) {
            // Idea owner can see ALL replies to their idea
            // No additional filter needed beyond ideaId
        } else if (userEmail) {
            // Logged in user: see public replies OR their own private replies
            query.$or = [
                { isPublic: true },
                { createdBy: userEmail, isPublic: false },
            ];
        } else {
            // Not logged in: only public replies
            query.isPublic = true;
        }

        const replies = await Reply.find(query).sort({ createdAt: 1 }).lean();

        // Attach usernames to replies
        const userEmails = Array.from(new Set(replies.map((r: any) => r.createdBy)));
        const users = await User.find({ email: { $in: userEmails } }, 'email username').lean();
        const userMap = users.reduce((acc: any, user: any) => {
            acc[user.email] = user.username || user.email;
            return acc;
        }, {});

        const repliesWithUsernames = replies.map((r: any) => ({
            ...r,
            username: userMap[r.createdBy] || r.createdBy,
        }));

        return NextResponse.json({ replies: repliesWithUsernames });
    } catch (error) {
        console.error('Error fetching replies:', error);
        return NextResponse.json({ error: 'Failed to fetch replies' }, { status: 500 });
    }
}

// POST /api/ideas/[ideaId]/replies
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ ideaId: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ideaId } = await params;

        if (!isValidObjectIdString(ideaId)) {
            return NextResponse.json({ error: 'Invalid idea ID' }, { status: 400 });
        }

        const body = await request.json();
        const { content, isPublic, imageUrl } = body;
        const trimmedContent = typeof content === 'string' ? content.trim() : '';

        if (typeof content !== 'undefined' && typeof content !== 'string') {
            return NextResponse.json({ error: 'Reply content must be a string' }, { status: 400 });
        }

        if (trimmedContent.length > MAX_REPLY_CONTENT_LENGTH) {
            return NextResponse.json({ error: `Reply content must be at most ${MAX_REPLY_CONTENT_LENGTH} characters` }, { status: 400 });
        }

        if (typeof isPublic !== 'undefined' && typeof isPublic !== 'boolean') {
            return NextResponse.json({ error: 'isPublic must be a boolean' }, { status: 400 });
        }

        const { imageUrl: normalizedImageUrl, error: imageError } = normalizeReplyImage(imageUrl);
        if (imageError) {
            return NextResponse.json({ error: imageError }, { status: 400 });
        }

        if (!trimmedContent && !normalizedImageUrl) {
            return NextResponse.json({ error: 'Reply content or image is required' }, { status: 400 });
        }

        await connectDB();

        const idea = await Idea.findById(ideaId);
        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        if (!idea.isPublic && idea.createdBy !== session.user.email) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        const reply = await Reply.create({
            ideaId,
            content: trimmedContent,
            createdBy: session.user.email,
            isPublic: isPublic !== false, // default true
            imageUrl: normalizedImageUrl,
        });

        return NextResponse.json({ reply }, { status: 201 });
    } catch (error) {
        console.error('Error creating reply:', error);
        return NextResponse.json({ error: 'Failed to create reply' }, { status: 500 });
    }
}
