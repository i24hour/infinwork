import { randomUUID } from 'node:crypto';
import User from '@/models/User';

// GitHub GraphQL is expensive. A 15s auto-sync loop could exhaust the hourly
// point quota in minutes; two minutes still feels live without the risk.
const DEFAULT_GITHUB_SYNC_INTERVAL_MS = 2 * 60 * 1000;
const GITHUB_SYNC_LOCK_MS = 60 * 1000;
const GITHUB_FETCH_TIMEOUT_MS = 20 * 1000;
const GITHUB_ERROR_BACKOFF_MS = 10 * 60 * 1000;
const GITHUB_RATE_LIMIT_BACKOFF_MS = 30 * 60 * 1000;
const MAX_CONTRIBUTION_WINDOW_DAYS = 364;
const MAX_CONTRIBUTION_WINDOWS = 15;
const COMMIT_REWARD_POINTS = 10;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type SyncSkipReason = 'missing_user' | 'not_connected' | 'cooldown' | 'locked' | 'backoff';

type GithubSyncErrorCode =
    | 'reconnect_required'
    | 'rate_limited'
    | 'not_found'
    | 'github_error';

export class GithubSyncError extends Error {
    code: GithubSyncErrorCode;
    reconnectRequired: boolean;

    constructor(code: GithubSyncErrorCode, message: string) {
        super(message);
        this.name = 'GithubSyncError';
        this.code = code;
        this.reconnectRequired = code === 'reconnect_required';
    }
}

export interface GithubSyncResult {
    status: 'synced' | 'skipped' | 'error';
    reason?: SyncSkipReason;
    error?: string;
    errorCode?: GithubSyncErrorCode;
    reconnectRequired?: boolean;
    isFirstSync: boolean;
    newCommits: number;
    pointsEarned: number;
    totalPoints: number;
    lastGithubSyncAt: Date | null;
    githubPointsLastUpdatedAt: Date | null;
}

interface SyncGithubOptions {
    force?: boolean;
    minIntervalMs?: number;
}

interface SyncableGithubUser {
    _id: string;
    email?: string;
    githubUsername?: string;
    githubAccessToken?: string;
    githubConnectedAt?: Date | string;
    githubPointsLastUpdatedAt?: Date | string;
    githubPointsHistory?: unknown;
    githubCommitsTotal?: number;
    githubSyncLockUntil?: Date | string;
    githubSyncLockId?: string;
    githubSyncError?: string | null;
    githubSyncRetryAt?: Date | string | null;
    lastGithubSyncAt?: Date | string;
    points?: number;
    save: () => Promise<unknown>;
}

interface GithubPointsHistoryEntry {
    timestamp: Date;
    points: number;
}

function normalizeGithubPointsHistory(rawHistory: unknown): GithubPointsHistoryEntry[] {
    if (!Array.isArray(rawHistory)) return [];

    return rawHistory
        .map((entry) => {
            const safeEntry = (entry && typeof entry === 'object')
                ? (entry as { timestamp?: unknown; points?: unknown })
                : {};
            const rawTimestamp = safeEntry.timestamp;
            const timestamp = rawTimestamp instanceof Date
                ? rawTimestamp
                : typeof rawTimestamp === 'string' || typeof rawTimestamp === 'number'
                    ? new Date(rawTimestamp)
                    : new Date(Number.NaN);
            const points = Math.max(0, Math.round(Number(safeEntry.points || 0)));
            if (Number.isNaN(timestamp.getTime())) return null;
            return { timestamp, points };
        })
        .filter((entry): entry is GithubPointsHistoryEntry => !!entry)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function isWithinInterval(value: Date | string | undefined, intervalMs: number) {
    if (!value) return false;

    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return false;

    return Date.now() - timestamp < intervalMs;
}

function getIstDayEndFromGithubDate(dateString: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);

    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
        return null;
    }

    const istMidnightUtcMs = Date.UTC(year, monthIndex, day, 0, 0, 0, 0) - IST_OFFSET_MS;
    return new Date(istMidnightUtcMs + DAY_MS - 1);
}

function getIstDateKeyFromTimestamp(timestampMs: number): string | null {
    if (!Number.isFinite(timestampMs)) return null;
    const istDate = new Date(timestampMs + IST_OFFSET_MS);
    const y = istDate.getUTCFullYear();
    const m = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(istDate.getUTCDate()).padStart(2, '0');
    if (!Number.isFinite(y)) return null;
    return `${y}-${m}-${d}`;
}

function buildPointsHistoryFromCommitDays(
    commitDays: Array<{ date: string; commits: number }>,
    connectionDate: Date,
    now: Date,
    authoritativeCommits: number
): GithubPointsHistoryEntry[] {
    const pointsByTimestamp = new Map<number, number>();

    const connectionAt = connectionDate.getTime();
    if (Number.isFinite(connectionAt)) {
        pointsByTimestamp.set(connectionAt, 0);
    }

    let cumulativeCommits = 0;
    const normalizedDays = commitDays
        .filter((day) => typeof day.date === 'string')
        .map((day) => ({
            date: day.date,
            commits: Math.max(0, Math.round(Number(day.commits || 0))),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    for (const day of normalizedDays) {
        cumulativeCommits += day.commits;
        const dayEnd = getIstDayEndFromGithubDate(day.date);
        if (!dayEnd) continue;

        const dayEndMs = dayEnd.getTime();
        if (!Number.isFinite(dayEndMs)) continue;

        const dayPoints = cumulativeCommits * COMMIT_REWARD_POINTS;
        const existing = pointsByTimestamp.get(dayEndMs);
        if (existing === undefined || dayPoints > existing) {
            pointsByTimestamp.set(dayEndMs, dayPoints);
        }
    }

    const authoritativePoints = Math.max(0, Math.round(authoritativeCommits)) * COMMIT_REWARD_POINTS;
    pointsByTimestamp.set(now.getTime(), authoritativePoints);

    return Array.from(pointsByTimestamp.entries())
        .map(([timestamp, points]) => ({
            timestamp: new Date(timestamp),
            points: Math.max(0, Math.round(points)),
        }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .slice(-2000);
}

function buildPointsHistoryFromSnapshots(
    rawExistingHistory: unknown,
    connectionDate: Date,
    now: Date,
    authoritativeCommits: number
): GithubPointsHistoryEntry[] {
    const history = normalizeGithubPointsHistory(rawExistingHistory);
    const connectionAt = connectionDate.getTime();
    const authoritativePoints = Math.max(0, Math.round(authoritativeCommits)) * COMMIT_REWARD_POINTS;

    if (history.length === 0 && Number.isFinite(connectionAt)) {
        history.push({ timestamp: connectionDate, points: 0 });
    }

    const lastSnapshot = history[history.length - 1];
    if (!lastSnapshot || lastSnapshot.points !== authoritativePoints) {
        history.push({ timestamp: now, points: authoritativePoints });
    }

    return history
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .slice(-2000);
}

async function releaseGithubSyncLock(userId: string, lockId: string) {
    // Only the request that owns the lock may release it. Without this check a
    // slow request whose lock expired could unset a newer request's lock.
    await User.updateOne(
        { _id: userId, githubSyncLockId: lockId },
        { $unset: { githubSyncLockUntil: '', githubSyncLockId: '' } }
    );
}

async function persistSyncFailure(userId: string, message: string, retryAt: Date) {
    await User.updateOne(
        { _id: userId },
        {
            $set: {
                githubSyncError: message.slice(0, 500),
                githubSyncRetryAt: retryAt,
            },
        }
    );
}

export async function syncGithubForUserByEmail(
    email: string,
    options: SyncGithubOptions = {}
): Promise<GithubSyncResult> {
    const user = await User.findOne({ email });

    if (!user) {
        return {
            status: 'skipped',
            reason: 'missing_user',
            isFirstSync: false,
            newCommits: 0,
            pointsEarned: 0,
            totalPoints: 0,
            lastGithubSyncAt: null,
            githubPointsLastUpdatedAt: null,
        };
    }

    return syncGithubForUser(user, options);
}

export async function syncGithubForUser(
    user: SyncableGithubUser,
    options: SyncGithubOptions = {}
): Promise<GithubSyncResult> {
    const minIntervalMs = options.minIntervalMs ?? DEFAULT_GITHUB_SYNC_INTERVAL_MS;
    const currentPoints = Math.max(0, Math.round(user.points || 0));
    const currentLastSyncAt = user.lastGithubSyncAt ? new Date(user.lastGithubSyncAt) : null;
    const currentRetryAt = user.githubSyncRetryAt ? new Date(user.githubSyncRetryAt) : null;

    if (!options.force && currentRetryAt && currentRetryAt.getTime() > Date.now()) {
        return {
            status: 'skipped',
            reason: 'backoff',
            error: user.githubSyncError || 'GitHub sync is cooling down after an error.',
            isFirstSync: !user.lastGithubSyncAt,
            newCommits: 0,
            pointsEarned: 0,
            totalPoints: currentPoints,
            lastGithubSyncAt: currentLastSyncAt,
            githubPointsLastUpdatedAt: user.githubPointsLastUpdatedAt ? new Date(user.githubPointsLastUpdatedAt) : null,
        };
    }

    if (!user.githubUsername) {
        return {
            status: 'skipped',
            reason: 'not_connected',
            isFirstSync: !user.lastGithubSyncAt,
            newCommits: 0,
            pointsEarned: 0,
            totalPoints: currentPoints,
            lastGithubSyncAt: currentLastSyncAt,
            githubPointsLastUpdatedAt: user.githubPointsLastUpdatedAt ? new Date(user.githubPointsLastUpdatedAt) : null,
        };
    }

    if (!options.force && isWithinInterval(user.lastGithubSyncAt, minIntervalMs)) {
        return {
            status: 'skipped',
            reason: 'cooldown',
            isFirstSync: !user.lastGithubSyncAt,
            newCommits: 0,
            pointsEarned: 0,
            totalPoints: currentPoints,
            lastGithubSyncAt: currentLastSyncAt,
            githubPointsLastUpdatedAt: user.githubPointsLastUpdatedAt ? new Date(user.githubPointsLastUpdatedAt) : null,
        };
    }

    const now = new Date();
    const lockId = randomUUID();
    const lockedUser = await User.findOneAndUpdate(
        {
            _id: user._id,
            $or: [
                { githubSyncLockUntil: { $exists: false } },
                { githubSyncLockUntil: null },
                { githubSyncLockUntil: { $lte: now } },
            ],
        },
        {
            $set: {
                githubSyncLockUntil: new Date(now.getTime() + GITHUB_SYNC_LOCK_MS),
                githubSyncLockId: lockId,
            },
        },
        { new: true }
    );

    if (!lockedUser) {
        const latestUser = await User.findById(user._id).lean();

        return {
            status: 'skipped',
            reason: 'locked',
            isFirstSync: !latestUser?.lastGithubSyncAt,
            newCommits: 0,
            pointsEarned: 0,
            totalPoints: latestUser?.points || currentPoints,
            lastGithubSyncAt: latestUser?.lastGithubSyncAt ? new Date(latestUser.lastGithubSyncAt) : currentLastSyncAt,
            githubPointsLastUpdatedAt: latestUser?.githubPointsLastUpdatedAt ? new Date(latestUser.githubPointsLastUpdatedAt) : null,
        };
    }

    let shouldReleaseLock = true;

    try {
        if (!options.force && isWithinInterval(lockedUser.lastGithubSyncAt, minIntervalMs)) {
            return {
                status: 'skipped',
                reason: 'cooldown',
                isFirstSync: !lockedUser.lastGithubSyncAt,
                newCommits: 0,
                pointsEarned: 0,
                totalPoints: lockedUser.points || 0,
                lastGithubSyncAt: lockedUser.lastGithubSyncAt ? new Date(lockedUser.lastGithubSyncAt) : null,
                githubPointsLastUpdatedAt: lockedUser.githubPointsLastUpdatedAt ? new Date(lockedUser.githubPointsLastUpdatedAt) : null,
            };
        }

        const isFirstSync = !lockedUser.lastGithubSyncAt;
        const connectionDate = lockedUser.githubConnectedAt
            ? new Date(lockedUser.githubConnectedAt)
            : now;
        const previousCommitCheckpoint = Math.max(0, Number(lockedUser.githubCommitsTotal || 0));

        const githubToken = lockedUser.githubAccessToken;
        if (!githubToken) {
            throw new GithubSyncError(
                'reconnect_required',
                'GitHub access token is missing. Reconnect GitHub to resume syncing.'
            );
        }

        const query = `
          query($login: String!, $connectionDate: DateTime!, $now: DateTime!) {
            user(login: $login) {
              commitsSinceConnection: contributionsCollection(from: $connectionDate, to: $now) {
                totalCommitContributions
                restrictedContributionsCount
                commitContributionsByRepository(maxRepositories: 100) {
                  contributions(first: 100) {
                    pageInfo {
                      hasNextPage
                    }
                    nodes {
                      occurredAt
                      commitCount
                    }
                  }
                }
              }
            }
          }
        `;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${githubToken}`,
        };

        // GitHub caps a contributionsCollection window at one year. Walk the
        // connection period in <=364-day windows so accounts connected for
        // longer than a year keep syncing instead of failing permanently.
        const windowMs = MAX_CONTRIBUTION_WINDOW_DAYS * DAY_MS;
        const endMs = now.getTime();
        let cursorMs = connectionDate.getTime();
        if (!Number.isFinite(cursorMs) || cursorMs >= endMs) {
            cursorMs = endMs - 1000;
        }

        const windows: Array<{ from: Date; to: Date }> = [];
        while (cursorMs < endMs && windows.length < MAX_CONTRIBUTION_WINDOWS) {
            const windowEndMs = Math.min(cursorMs + windowMs, endMs);
            windows.push({ from: new Date(cursorMs), to: new Date(windowEndMs) });
            cursorMs = windowEndMs;
        }
        if (windows.length === 0) {
            windows.push({ from: new Date(endMs - 1000), to: new Date(endMs) });
        }

        const commitDayMap = new Map<string, number>();
        let contributionNodesCommitTotal = 0;
        let hasPaginationTruncation = false;
        let authoritativeCommitTotal = 0;

        for (const window of windows) {
            const githubRes = await fetch('https://api.github.com/graphql', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    query,
                    variables: {
                        login: lockedUser.githubUsername,
                        connectionDate: window.from.toISOString(),
                        now: window.to.toISOString(),
                    },
                }),
                cache: 'no-store',
                signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
            });

            if (!githubRes.ok) {
                const errorText = await githubRes.text().catch(() => '');
                const rateLimitRemaining = githubRes.headers.get('x-ratelimit-remaining');
                console.error('GitHub GraphQL API error:', githubRes.status, errorText.slice(0, 500));

                if (githubRes.status === 429 || (githubRes.status === 403 && rateLimitRemaining === '0')) {
                    throw new GithubSyncError(
                        'rate_limited',
                        'GitHub rate limit reached. Sync will retry automatically later.'
                    );
                }
                if (githubRes.status === 401 || githubRes.status === 403) {
                    throw new GithubSyncError(
                        'reconnect_required',
                        'GitHub rejected the saved token. Reconnect GitHub to resume syncing.'
                    );
                }
                throw new GithubSyncError(
                    'github_error',
                    `GitHub request failed (${githubRes.status}).`
                );
            }

            const jsonRes = await githubRes.json();
            if (Array.isArray(jsonRes.errors) && jsonRes.errors.length > 0) {
                const message = jsonRes.errors
                    .map((entry: { message?: string }) => entry?.message)
                    .filter(Boolean)
                    .join(' | ');
                console.error('GitHub GraphQL errors:', message);
                if (/rate limit|rate-limit/i.test(message)) {
                    throw new GithubSyncError('rate_limited', 'GitHub rate limit reached. Sync will retry automatically later.');
                }
                if (/not found|could not resolve/i.test(message)) {
                    throw new GithubSyncError('not_found', `GitHub user @${lockedUser.githubUsername} could not be found.`);
                }
                throw new GithubSyncError('github_error', 'GitHub returned an error while reading contributions.');
            }

            const commitsCollection = jsonRes.data?.user?.commitsSinceConnection;
            if (!commitsCollection) {
                throw new GithubSyncError(
                    'not_found',
                    `GitHub user @${lockedUser.githubUsername} could not be found.`
                );
            }

            authoritativeCommitTotal += Math.max(0, Math.round(Number(commitsCollection.totalCommitContributions || 0)));
            const repoCommitContributions = Array.isArray(commitsCollection.commitContributionsByRepository)
                ? commitsCollection.commitContributionsByRepository
                : [];

            for (const repoEntry of repoCommitContributions) {
                const contributions = repoEntry?.contributions;
                if (contributions?.pageInfo?.hasNextPage) {
                    hasPaginationTruncation = true;
                }

                const nodes = Array.isArray(contributions?.nodes) ? contributions.nodes : [];
                for (const node of nodes) {
                    const commitCount = Math.max(0, Math.round(Number(node?.commitCount || 0)));
                    if (commitCount <= 0) continue;

                    const occurredAtMs = new Date(node.occurredAt).getTime();
                    if (!Number.isFinite(occurredAtMs)) continue;

                    const istDateKey = getIstDateKeyFromTimestamp(occurredAtMs);
                    if (!istDateKey) continue;

                    commitDayMap.set(istDateKey, (commitDayMap.get(istDateKey) || 0) + commitCount);
                    contributionNodesCommitTotal += commitCount;
                }
            }
        }

        const commitDays = Array.from(commitDayMap.entries())
            .map(([date, commits]) => ({
                date,
                commits: Math.max(0, Math.round(commits)),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // Keep earned points monotonic for a connection. A repo deletion or a
        // temporary GitHub recount must not silently wipe a user's points.
        const commitsSinceConnection = Math.max(previousCommitCheckpoint, authoritativeCommitTotal);
        const newCommits = isFirstSync
            ? commitsSinceConnection
            : Math.max(0, commitsSinceConnection - previousCommitCheckpoint);
        const pointsEarned = newCommits * COMMIT_REWARD_POINTS;
        const authoritativeGithubPoints = commitsSinceConnection * COMMIT_REWARD_POINTS;
        const canBuildCompleteDayHistory = !hasPaginationTruncation && contributionNodesCommitTotal === authoritativeCommitTotal;
        const updatedHistory = canBuildCompleteDayHistory
            ? buildPointsHistoryFromCommitDays(
                commitDays,
                connectionDate,
                now,
                commitsSinceConnection
            )
            : buildPointsHistoryFromSnapshots(
                lockedUser.githubPointsHistory,
                connectionDate,
                now,
                commitsSinceConnection
            );

        if (lockedUser.points !== authoritativeGithubPoints) {
            lockedUser.points = authoritativeGithubPoints;
            lockedUser.githubPointsLastUpdatedAt = now;
        }

        if (!lockedUser.githubConnectedAt) {
            lockedUser.githubConnectedAt = connectionDate;
        }

        lockedUser.githubCommitsTotal = Math.max(0, commitsSinceConnection);
        lockedUser.githubPointsHistory = updatedHistory;
        lockedUser.lastGithubSyncAt = now;
        lockedUser.githubSyncError = null;
        lockedUser.githubSyncRetryAt = null;
        lockedUser.githubSyncLockUntil = undefined;
        lockedUser.githubSyncLockId = undefined;
        await lockedUser.save();

        await User.updateOne(
            { _id: lockedUser._id },
            {
                $set: { githubSyncError: null },
                $unset: {
                    githubSyncLockUntil: '',
                    githubSyncLockId: '',
                    githubSyncRetryAt: '',
                },
            }
        );
        shouldReleaseLock = false;

        return {
            status: 'synced',
            isFirstSync,
            newCommits,
            pointsEarned,
            totalPoints: Math.max(0, Math.round(lockedUser.points || 0)),
            lastGithubSyncAt: lockedUser.lastGithubSyncAt ? new Date(lockedUser.lastGithubSyncAt) : null,
            githubPointsLastUpdatedAt: lockedUser.githubPointsLastUpdatedAt ? new Date(lockedUser.githubPointsLastUpdatedAt) : null,
        };
    } catch (error) {
        const syncError = error instanceof GithubSyncError
            ? error
            : new GithubSyncError(
                'github_error',
                error instanceof Error ? error.message : 'GitHub sync failed.'
            );

        const retryAt = new Date(
            Date.now() + (syncError.code === 'rate_limited'
                ? GITHUB_RATE_LIMIT_BACKOFF_MS
                : GITHUB_ERROR_BACKOFF_MS)
        );

        await persistSyncFailure(String(user._id), syncError.message, retryAt).catch((persistError) => {
            console.error('Could not persist GitHub sync error:', persistError);
        });
        console.error('GitHub sync failed:', syncError.code, syncError.message);

        return {
            status: 'error',
            error: syncError.message,
            errorCode: syncError.code,
            reconnectRequired: syncError.reconnectRequired,
            isFirstSync: !user.lastGithubSyncAt,
            newCommits: 0,
            pointsEarned: 0,
            totalPoints: currentPoints,
            lastGithubSyncAt: currentLastSyncAt,
            githubPointsLastUpdatedAt: user.githubPointsLastUpdatedAt ? new Date(user.githubPointsLastUpdatedAt) : null,
        };
    } finally {
        if (shouldReleaseLock) {
            await releaseGithubSyncLock(String(user._id), lockId).catch((releaseError) => {
                console.error('Could not release GitHub sync lock:', releaseError);
            });
        }
    }
}
