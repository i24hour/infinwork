import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import Idea from '@/models/Idea';
import Reply from '@/models/Reply';
import User from '@/models/User';
import {
    isPlainObject,
    isValidObjectIdString,
    readJsonBody,
} from '@/lib/validate';

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
        const userEmail = await getAuthorizedEmail(request);
        const { ideaId } = await params;

        if (!isValidObjectIdString(ideaId)) {
            return NextResponse.json({ error: 'Invalid idea ID' }, { status: 400 });
        }

        await connectDB();

        const idea = await Idea.findById(ideaId);
        if (!idea) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        const isIdeaOwner = userEmail
            ? userEmail.toLowerCase() === String(idea.createdBy).toLowerCase()
            : false;

        if (!idea.isPublic && !isIdeaOwner) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        const query: Record<string, unknown> = { ideaId };

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
            acc[user.email] = user.username || String(user.email).split('@')[0];
            return acc;
        }, {});

        const viewerEmail = userEmail?.toLowerCase();
        const repliesWithUsernames = replies.map((r: any) => ({
            _id: r._id,
            ideaId: r.ideaId,
            content: r.content,
            isPublic: r.isPublic,
            imageUrl: r.imageUrl,
            isEdited: r.isEdited,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            isOwner: Boolean(viewerEmail) && String(r.createdBy).toLowerCase() === viewerEmail,
            username: userMap[r.createdBy] || 'Anonymous',
            // Display alias for already-open clients; not an email.
            createdBy: userMap[r.createdBy] || 'Anonymous',
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
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ideaId } = await params;

        if (!isValidObjectIdString(ideaId)) {
            return NextResponse.json({ error: 'Invalid idea ID' }, { status: 400 });
        }

        const parsed = await readJsonBody<unknown>(request);
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        if (!isPlainObject(parsed.body)) {
            return NextResponse.json({ error: 'Invalid reply payload' }, { status: 400 });
        }
        const { content, isPublic, imageUrl } = parsed.body;
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

        if (!idea.isPublic && String(idea.createdBy).toLowerCase() !== email.toLowerCase()) {
            return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
        }

        const reply = await Reply.create({
            ideaId,
            content: trimmedContent,
            createdBy: email,
            isPublic: isPublic !== false, // default true
            imageUrl: normalizedImageUrl,
        });

        const safeReply = reply.toObject();
        delete safeReply.createdBy;
        const replyUsername = email.split('@')[0];
        return NextResponse.json({
            reply: {
                ...safeReply,
                isOwner: true,
                username: replyUsername,
                // Display alias for already-open clients; not an email.
                createdBy: replyUsername,
            },
        }, { status: 201 });
    } catch (error) {
        console.error('Error creating reply:', error);
        return NextResponse.json({ error: 'Failed to create reply' }, { status: 500 });
    }
}
