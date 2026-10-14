import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import ITimeTask from '@/models/ITimeTask';
import User from '@/models/User';
import { syncGithubForUserByEmail } from '@/lib/github-sync';
import { autoCancelExpiredActiveTasks } from '@/lib/itime-runtime';

export const dynamic = 'force-dynamic';

const WORKERS_CACHE_TTL_MS = 3000;
const AUTO_CANCEL_MIN_INTERVAL_MS = 15000;

let cachedWorkersPayload: { workers: unknown[]; totalSignup: number; expiresAt: number } | null = null;
let lastAutoCancelCheckAt = 0;

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        // Trigger background GitHub sync without blocking the leaderboard HTTP response
        if (session?.user?.email) {
            const email = session.user.email;
            connectDB()
                .then(() => syncGithubForUserByEmail(email))
                .catch((syncError) => {
                    console.error('GitHub auto-sync failed in workers route:', syncError);
                });
        }

        const now = Date.now();
        if (cachedWorkersPayload && cachedWorkersPayload.expiresAt > now) {
            return NextResponse.json({
                workers: cachedWorkersPayload.workers,
                totalSignup: cachedWorkersPayload.totalSignup,
            });
        }

        await connectDB();

        if (now - lastAutoCancelCheckAt >= AUTO_CANCEL_MIN_INTERVAL_MS) {
            lastAutoCancelCheckAt = now;
            await autoCancelExpiredActiveTasks();
        }

        // The workers leaderboard is intentionally public. Only public tasks are
        // included so private task titles, descriptions, and timings never leak
        // to other users. Legacy tasks without the flag default to public.
        const [allTasks, initialUsers] = await Promise.all([
            ITimeTask.find({ isPublic: { $ne: false } })
                .select('userId startTime pausedElapsed enabled completed completedAt cancelledAt events updatedAt isPublic')
                .lean() as Promise<any[]>,
            User.find({})
                .select('email username image points githubPointsLastUpdatedAt githubConnectedAt githubPointsHistory chainPoints chainPointsHistory')
                .lean() as Promise<any[]>,
        ]);

        let allUsers = initialUsers;

        // --- START LAZY REGISTRATION ---
        // If some users are missing from the User collection but have tasks,
        // they won't be counted in totalSignup. Let's fix this once here.
        const taskUserEmails = [...new Set(allTasks.map((t) => t.userId))];
        const existingUserEmails = new Set(allUsers.map((u) => u.email));

        const missingEmails = taskUserEmails.filter((email) => !existingUserEmails.has(email));
        if (missingEmails.length > 0) {
            // Upsert missing users in a single bulkWrite in the background instead of blocking sequential round-trips
            User.bulkWrite(
                missingEmails.map((email) => ({
                    updateOne: {
                        filter: { email },
                        update: { $setOnInsert: { email } },
                        upsert: true,
                    },
                })),
                { ordered: false }
            ).catch((e) => console.error('Error lazy-registering users in bulk:', e));

            for (const email of missingEmails) {
                allUsers.push({ email });
            }
        }
        // --- END LAZY REGISTRATION ---

        const emailToUserMap = new Map();
        allUsers.forEach((u) => {
            emailToUserMap.set(u.email, {
                username: u.username,
                image: u.image,
                points: u.points || 0,
                githubPointsLastUpdatedAt: u.githubPointsLastUpdatedAt || u.githubConnectedAt || null,
                githubPointsHistory: u.githubPointsHistory || [],
                chainPoints: u.chainPoints || 0,
                chainPointsHistory: u.chainPointsHistory || [],
            });
        });

        const userStatsMap = new Map<string, any>();

        for (const task of allTasks) {
            const userId = task.userId;

            if (!userStatsMap.has(userId)) {
                const userData = emailToUserMap.get(userId);
                userStatsMap.set(userId, {
                    userId,
                    username: userData?.username || userId.split('@')[0],
                    image: userData?.image || null,
                    totalTasks: 0,
                    completedTasks: 0,
                    runningTasks: 0,
                    allTimeSeconds: 0,
                    lastActive: task.updatedAt || new Date(0),
                    tasks: [], // Provide tasks to frontend for precise score calculation
                    gamificationPoints: userData?.points || 0,
                    gamificationPointsLastUpdatedAt: userData?.githubPointsLastUpdatedAt || null,
                    githubPointsHistory: userData?.githubPointsHistory || [],
                    chainPoints: userData?.chainPoints || 0,
                    chainPointsHistory: userData?.chainPointsHistory || [],
                });
            }

            const stats = userStatsMap.get(userId);
            stats.totalTasks += 1;
            stats.tasks.push(task);

            if (task.completed) {
                stats.completedTasks += 1;
            } else if (task.enabled) {
                stats.runningTasks += 1;
            }

            if (task.updatedAt && task.updatedAt > stats.lastActive) {
                stats.lastActive = task.updatedAt;
            }

            // Calculate exact elapsed seconds for "All Time"
            let elapsedSeconds = task.pausedElapsed || 0;

            if (task.events && task.events.length > 0) {
                let totalMs = 0;
                let isRunning = false;
                let lastStartTime = 0;

                for (const ev of task.events) {
                    if (ev.type === 'start') {
                        if (!isRunning) {
                            isRunning = true;
                            lastStartTime = ev.timestamp;
                        }
                    } else if (ev.type === 'pause' || ev.type === 'complete') {
                        if (isRunning) {
                            totalMs += (ev.timestamp - lastStartTime);
                            isRunning = false;
                        }
                    }
                }

                if (isRunning && !task.completed) {
                    totalMs += (now - lastStartTime);
                }

                if (task.events[0].type !== 'start') {
                    totalMs += ((task.pausedElapsed || 0) * 1000);
                }

                elapsedSeconds = Math.floor(totalMs / 1000);
            } else if (!task.completed && task.enabled && task.startTime) {
                // Legacy fallback for active tasks without events
                const runningSince = (now - task.startTime) / 1000;
                elapsedSeconds = Math.floor((task.pausedElapsed || 0) + runningSince);
            }

            stats.allTimeSeconds += elapsedSeconds;
        }

        // Calculate Rank Score and convert to array
        const workers = Array.from(userStatsMap.values()).map((w) => {
            let rankScore = 0;
            if (w.allTimeSeconds > 0) {
                rankScore = w.completedTasks / w.allTimeSeconds;
            } else if (w.completedTasks > 0) {
                rankScore = w.completedTasks;
            }

            return {
                ...w,
                rankScore,
            };
        });

        // Sort by Rank Score descending
        workers.sort((a, b) => b.rankScore - a.rankScore);

        const totalSignup = allUsers.length;

        cachedWorkersPayload = {
            workers,
            totalSignup,
            expiresAt: Date.now() + WORKERS_CACHE_TTL_MS,
        };

        return NextResponse.json({ workers, totalSignup });
    } catch (error) {
        console.error('Error fetching workers:', error);
        return NextResponse.json({ error: 'Failed to fetch workers' }, { status: 500 });
    }
}
