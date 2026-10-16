import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import ITimeTask from '@/models/ITimeTask';
import User from '@/models/User';
import { autoCancelExpiredActiveTasks } from '@/lib/itime-runtime';
import {
    isPlainObject,
    isValidObjectIdString,
    readJsonBody,
    sanitizeItimeTaskInput,
} from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(_request);

        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        await connectDB();

        // Auto-register user and check runtime limits in the background so GET /api/itime returns with 1 fast query
        User.updateOne(
            { email },
            { $setOnInsert: { email } },
            { upsert: true }
        ).catch((err) => console.error('User upsert failed in /api/itime:', err));

        autoCancelExpiredActiveTasks({ userId: email }).catch((err) =>
            console.error('autoCancelExpiredActiveTasks failed in /api/itime:', err)
        );
        const tasks = await ITimeTask.find({
            userId: email
        })
            .sort({ createdAt: -1 })
            .lean();

        return NextResponse.json({ tasks });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
    }
}

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

        const sanitized = sanitizeItimeTaskInput(parsed.body, { requireTitle: true });
        if (!sanitized.ok) {
            return NextResponse.json({ error: sanitized.error }, { status: 400 });
        }

        await connectDB();

        const task = await ITimeTask.create({
            ...sanitized.value,
            userId: email,
            startTime: sanitized.value.startTime ?? Date.now(),
            pausedElapsed: sanitized.value.pausedElapsed ?? 0,
            enabled: sanitized.value.enabled ?? true,
            completed: sanitized.value.completed ?? false,
            description: sanitized.value.description ?? '',
        });

        return NextResponse.json({ task }, { status: 201 });
    } catch (error) {
        console.error('Error creating task:', error);
        return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
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
            return NextResponse.json({ error: 'Invalid task payload' }, { status: 400 });
        }

        const { _id, ...rest } = parsed.body;
        if (!isValidObjectIdString(_id)) {
            return NextResponse.json({ error: 'Valid task ID required' }, { status: 400 });
        }

        const sanitized = sanitizeItimeTaskInput(rest, { requireTitle: false });
        if (!sanitized.ok) {
            return NextResponse.json({ error: sanitized.error }, { status: 400 });
        }
        if (Object.keys(sanitized.value).length === 0) {
            return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
        }

        await connectDB();
        await autoCancelExpiredActiveTasks({ userId: email });

        const task = await ITimeTask.findOneAndUpdate(
            { _id, userId: email },
            { $set: sanitized.value },
            { new: true }
        );

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        return NextResponse.json({ task });
    } catch (error) {
        console.error('Error updating task:', error);
        return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);

        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!isValidObjectIdString(id)) {
            return NextResponse.json({ error: 'Valid task ID required' }, { status: 400 });
        }

        await connectDB();

        const task = await ITimeTask.findOneAndDelete({
            _id: id,
            userId: email,
        });

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting task:', error);
        return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
    }
}
