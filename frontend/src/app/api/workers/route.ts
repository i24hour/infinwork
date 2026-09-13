import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import ITimeTask from '@/models/ITimeTask';
import User from '@/models/User';
import { syncGithubForUserByEmail } from '@/lib/github-sync';
import { autoCancelExpiredActiveTasks } from '@/lib/itime-runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        // The workers leaderboard is intentionally public; only public tasks are
        // returned (see the isPublic filter below). The session is only used
        // for the signed-in viewer's optional GitHub sync.
        if (!session?.user?.email) {
            console.log("No session found in /api/workers, serving public leaderboard");
        }

        await connectDB();
        await autoCancelExpiredActiveTasks();

        if (session?.user?.email) {
            try {
                await syncGithubForUserByEmail(session.user.email);
            } catch (syncError) {
                console.error('GitHub auto-sync failed in workers route:', syncError);
            }
        }

        // The workers leaderboard is intentionally public. Only public tasks are
        // included so private task titles, descriptions, and timings never leak
        // to other users. Legacy tasks without the flag default to public.
        const allTasks = await ITimeTask.find({ isPublic: { $ne: false } }).lean() as any[];

        // Fetch all users to map emails to usernames
        let allUsers = await User.find().lean() as any[];
        
        // --- START LAZY REGISTRATION ---
        // If some users are missing from the User collection but have tasks, 
        // they won't be counted in totalSignup. Let's fix this once here.
        const taskUserEmails = [...new Set(allTasks.map(t => t.userId))];
        const existingUserEmails = new Set(allUsers.map(u => u.email));
        
        const missingEmails = taskUserEmails.filter(email => !existingUserEmails.has(email));
        if (missingEmails.length > 0) {
            console.log(`[DEBUG_LOG] Found ${missingEmails.length} missing users in User collection. Registering them now...`);
            for (const email of missingEmails) {
                try {
                    await User.findOneAndUpdate(
                        { email },
                        { $setOnInsert: { email } },
                        { upsert: true }
                    );
                } catch (e) {
                    console.error(`Error lazy-registering user ${email}:`, e);
                }
            }
            // Refresh allUsers list after lazy registration
            allUsers = await User.find().lean() as any[];
        }
        // --- END LAZY REGISTRATION ---

        const emailToUserMap = new Map();
        allUsers.forEach(u => {
            emailToUserMap.set(u.email, {
                username: u.username,
                image: u.image,
                points: u.points || 0,
                githubPointsLastUpdatedAt: u.githubPointsLastUpdatedAt || u.githubConnectedAt || null,
                githubPointsHistory: u.githubPointsHistory || [],
                chainPoints: u.chainPoints || 0,
                chainPointsHistory: u.chainPointsHistory || []
            });
        });

        const now = Date.now();
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
                    chainPointsHistory: userData?.chainPointsHistory || []
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
        const workers = Array.from(userStatsMap.values()).map(w => {
            // Rank Score = completedTasks / AllTime
            // Multiply by a factor (e.g. 10000) to make it a readable non-decimal number if desired, 
            // but we'll stick to the strict completedTasks / allTimeSeconds value for math sorting
            let rankScore = 0;
            if (w.allTimeSeconds > 0) {
                rankScore = w.completedTasks / w.allTimeSeconds;
            } else if (w.completedTasks > 0) {
                // Edge case where time was zero but complete (instant complete)
                rankScore = w.completedTasks;
            }

            return {
                ...w,
                rankScore
            };
        });

        // Sort by Rank Score descending
        workers.sort((a, b) => b.rankScore - a.rankScore);

        const totalSignup = await User.countDocuments();
        console.log(`[DEBUG_LOG] API /api/workers - totalSignup count from DB: ${totalSignup}`);
        
        // Return only users that have tasks, or include all users in the ranking?
        // To maintain existing behavior of showing a list of workers with stats:
        return NextResponse.json({ workers, totalSignup });
    } catch (error) {
        console.error('Error fetching workers:', error);
        return NextResponse.json({ error: 'Failed to fetch workers' }, { status: 500 });
    }
}
