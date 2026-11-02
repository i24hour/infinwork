import { NextRequest, NextResponse } from 'next/server';
import connectMongo from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import Reply from '@/models/Reply';
import { isPlainObject, isValidObjectIdString } from '@/lib/validate';

export async function PATCH(req: NextRequest, context: { params: Promise<{ replyId: string }> }) {
    try {
        const { replyId } = await context.params;
        if (!isValidObjectIdString(replyId)) {
            return NextResponse.json({ error: 'Invalid reply ID' }, { status: 400 });
        }
        const email = await getAuthorizedEmail(req);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        if (!isPlainObject(body)) {
            return NextResponse.json({ error: 'Invalid reply payload' }, { status: 400 });
        }
        const { isPublic, content } = body;

        await connectMongo();

        const reply = await Reply.findById(replyId);
        if (!reply) {
            return NextResponse.json({ error: 'Reply not found' }, { status: 404 });
        }

        if (String(reply.createdBy).toLowerCase() !== email.toLowerCase()) {
            return NextResponse.json({ error: 'Unauthorized to edit this reply' }, { status: 403 });
        }

        if (isPublic !== undefined) {
            if (typeof isPublic !== 'boolean') {
                return NextResponse.json({ error: 'isPublic must be a boolean' }, { status: 400 });
            }
            reply.isPublic = isPublic;
        }
        if (content !== undefined) {
            if (typeof content !== 'string') {
                return NextResponse.json({ error: 'Reply content must be a string' }, { status: 400 });
            }
            const trimmed = content.trim();
            if (trimmed.length > 5000) {
                return NextResponse.json({ error: 'Reply content must be at most 5000 characters' }, { status: 400 });
            }
            if (!trimmed && !reply.imageUrl) {
                return NextResponse.json({ error: 'Reply content or image is required' }, { status: 400 });
            }
            if (trimmed !== reply.content) {
                reply.content = trimmed;
                reply.isEdited = true;
            }
        }
        await reply.save();

        return NextResponse.json({ success: true, reply });
    } catch (error) {
        console.error('Failed to update reply:', error);
        return NextResponse.json({ error: 'Failed to update reply' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ replyId: string }> }) {
    try {
        const { replyId } = await context.params;
        if (!isValidObjectIdString(replyId)) {
            return NextResponse.json({ error: 'Invalid reply ID' }, { status: 400 });
        }
        const email = await getAuthorizedEmail(req);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectMongo();
        
        const reply = await Reply.findById(replyId);
        if (!reply) {
            return NextResponse.json({ error: 'Reply not found' }, { status: 404 });
        }

        if (String(reply.createdBy).toLowerCase() !== email.toLowerCase()) {
            return NextResponse.json({ error: 'Unauthorized to delete this reply' }, { status: 403 });
        }

        await Reply.findByIdAndDelete(replyId);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete reply:', error);
        return NextResponse.json({ error: 'Failed to delete reply' }, { status: 500 });
    }
}
