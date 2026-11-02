import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import Idea from '@/models/Idea';
import User from '@/models/User';
import { isPlainObject, readJsonBody } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const MAX_TITLE_LENGTH = 200;
const MAX_DETAILS_LENGTH = 5000;

// GET /api/ideas
// Returns all public ideas + the logged-in user's own private ideas
export async function GET(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        await connectDB();

        let query: Record<string, unknown>;

        if (email) {
            // Logged in: see all public ideas + own private ideas
            query = {
                $or: [
                    { isPublic: true },
                    { createdBy: email, isPublic: false },
                ],
            };
        } else {
            // Not logged in: only public ideas
            query = { isPublic: true };
        }

        const ideas = await Idea.find(query).sort({ createdAt: -1 }).lean();
        const emails = [...new Set(ideas.map((idea: any) => idea.createdBy))];
        const users = await User.find({ email: { $in: emails } })
            .select('email username')
            .lean() as any[];
        const usernameByEmail = new Map(users.map((user) => [user.email, user.username]));
        const viewerEmail = email?.toLowerCase();

        return NextResponse.json({
            ideas: ideas.map((idea: any) => ({
                _id: idea._id,
                title: idea.title,
                details: idea.details,
                isPublic: idea.isPublic,
                createdAt: idea.createdAt,
                updatedAt: idea.updatedAt,
                // Never expose account emails. Owners are identified by a
                // boolean, everyone else sees the public username.
                isOwner: Boolean(viewerEmail) && String(idea.createdBy).toLowerCase() === viewerEmail,
                username: usernameByEmail.get(idea.createdBy) || 'Anonymous',
                // Backwards-compatible display alias for already-open clients.
                // It is the username, never the account email.
                createdBy: usernameByEmail.get(idea.createdBy) || 'Anonymous',
            })),
        });
    } catch (error) {
        console.error('Error fetching ideas:', error);
        return NextResponse.json({ error: 'Failed to fetch ideas' }, { status: 500 });
    }
}

// POST /api/ideas
// Create a new idea (must be logged in)
export async function POST(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);

        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = await readJsonBody<unknown>(request);
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        if (!isPlainObject(parsed.body)) {
            return NextResponse.json({ error: 'Invalid idea payload' }, { status: 400 });
        }

        const { title, details, isPublic } = parsed.body;
        if (typeof title !== 'string' || title.trim().length === 0) {
            return NextResponse.json({ error: 'Title is required' }, { status: 400 });
        }
        if (title.trim().length > MAX_TITLE_LENGTH) {
            return NextResponse.json({ error: `Title must be at most ${MAX_TITLE_LENGTH} characters` }, { status: 400 });
        }
        if (details !== undefined && typeof details !== 'string') {
            return NextResponse.json({ error: 'Details must be a string' }, { status: 400 });
        }
        if (typeof details === 'string' && details.length > MAX_DETAILS_LENGTH) {
            return NextResponse.json({ error: `Details must be at most ${MAX_DETAILS_LENGTH} characters` }, { status: 400 });
        }
        if (isPublic !== undefined && typeof isPublic !== 'boolean') {
            return NextResponse.json({ error: 'isPublic must be a boolean' }, { status: 400 });
        }

        await connectDB();

        const idea = await Idea.create({
            title: title.trim(),
            details: typeof details === 'string' ? details.trim() : '',
            isPublic: isPublic !== false, // default true
            createdBy: email,
        });

        return NextResponse.json({ idea }, { status: 201 });
    } catch (error) {
        console.error('Error creating idea:', error);
        return NextResponse.json({ error: 'Failed to create idea' }, { status: 500 });
    }
}
