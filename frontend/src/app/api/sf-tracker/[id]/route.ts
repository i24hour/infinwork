import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import SFTracker from '@/models/SFTracker';
import {
    isPlainObject,
    isValidObjectIdString,
    readJsonBody,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        if (!isValidObjectIdString(id)) {
            return NextResponse.json({ error: 'Invalid target ID' }, { status: 400 });
        }

        const parsed = await readJsonBody<unknown>(request);
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        if (!isPlainObject(parsed.body)) {
            return NextResponse.json({ error: 'Invalid target payload' }, { status: 400 });
        }

        const { status, failureReason } = parsed.body;
        if (status !== 'Success' && status !== 'Failure') {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }
        if (status === 'Failure' && (typeof failureReason !== 'string' || !failureReason.trim())) {
            return NextResponse.json({ error: 'Failure reason is required when marking as Failure' }, { status: 400 });
        }

        await connectDB();

        const target = await SFTracker.findById(id);
        if (!target) {
            return NextResponse.json({ error: 'Target not found' }, { status: 404 });
        }

        if (target.userId !== session.user.email) {
            return NextResponse.json({ error: 'Unauthorized to modify this target' }, { status: 403 });
        }

        const safeFailureReason = typeof failureReason === 'string' ? failureReason.trim() : '';
        target.status = status;
        target.failureReason = status === 'Failure' ? safeFailureReason : '';

        await target.save();

        return NextResponse.json({ target });
    } catch (error) {
        console.error('Error updating SF Tracker target:', error);
        return NextResponse.json({ error: 'Failed to update target' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        if (!isValidObjectIdString(id)) {
            return NextResponse.json({ error: 'Invalid target ID' }, { status: 400 });
        }
        await connectDB();

        const target = await SFTracker.findById(id);
        if (!target) {
            return NextResponse.json({ error: 'Target not found' }, { status: 404 });
        }

        if (target.userId !== session.user.email) {
            return NextResponse.json({ error: 'Unauthorized to delete this target' }, { status: 403 });
        }

        await SFTracker.findByIdAndDelete(id);

        return NextResponse.json({ message: 'Target deleted successfully' });
    } catch (error) {
        console.error('Error deleting SF Tracker target:', error);
        return NextResponse.json({ error: 'Failed to delete target' }, { status: 500 });
    }
}
