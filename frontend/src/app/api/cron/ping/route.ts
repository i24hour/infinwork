import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import {
    ACTIVE_TASK_RUNTIME_LIMIT_SECONDS,
    autoCancelExpiredActiveTasks,
    autoResumeDueTasks,
} from '@/lib/itime-runtime';

// This is an API route specifically designed to be hit by a cron job or uptime monitoring tool
export const dynamic = 'force-dynamic';

function isAuthorizedCron(request: NextRequest): boolean {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return process.env.NODE_ENV !== 'production';
    }

    const authHeader = request.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const headerSecret = request.headers.get('x-cron-secret') || '';
    return bearer === cronSecret || headerSecret === cronSecret;
}

export async function GET(request: NextRequest) {
    try {
        if (!isAuthorizedCron(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('[CRON] Ping received at', new Date().toISOString());

        // Connect to MongoDB
        await connectDB();

        let autoCancelledCount = 0;

        // Execute a minimal query to keep the database cluster awake
        if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
            await mongoose.connection.db.command({ ping: 1 });
            console.log('[CRON] MongoDB ping successful');
            
            autoCancelledCount = await autoCancelExpiredActiveTasks();
            if (autoCancelledCount > 0) {
                console.log(`[CRON] Auto-cancelled ${autoCancelledCount} active task(s) after exceeding ${ACTIVE_TASK_RUNTIME_LIMIT_SECONDS / 3600} hours of runtime.`);
            }

            const autoResumedCount = await autoResumeDueTasks();
            if (autoResumedCount > 0) {
                console.log(`[CRON] Auto-resumed ${autoResumedCount} task(s) whose break ended.`);
            }
        }

        return NextResponse.json({
            status: 'ok',
            message: 'Site and Database are awake and running',
            autoCancelledTasks: autoCancelledCount,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[CRON] Error during ping:', error.message);
        return NextResponse.json({
            status: 'error',
            message: 'Database ping failed',
            error: error.message
        }, { status: 500 });
    }
}
