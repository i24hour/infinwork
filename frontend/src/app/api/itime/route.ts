import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import ITimeTask from '@/models/ITimeTask';
import User from '@/models/User';
import { autoCancelExpiredActiveTasks } from '@/lib/itime-runtime';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const email = session.user.email;
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
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();

        await connectDB();

        const task = await ITimeTask.create({
            ...body,
            userId: session.user.email,
        });

        return NextResponse.json({ task }, { status: 201 });
    } catch (error) {
        console.error('Error creating task:', error);
        return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { _id, ...updates } = body;

        await connectDB();
        await autoCancelExpiredActiveTasks({ userId: session.user.email });

        const task = await ITimeTask.findOneAndUpdate(
            { _id, userId: session.user.email },
            updates,
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
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Task ID required' }, { status: 400 });
        }

        await connectDB();

        const task = await ITimeTask.findOneAndDelete({
            _id: id,
            userId: session.user.email,
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
