import Chain from '@/models/IChain';
import User from '@/models/User';

export const CHAIN_REWARD_BLOCK_SECONDS = 3 * 60 * 60;
export const CHAIN_REWARD_STEP_POINTS = 10;
const MAX_HISTORY_SNAPSHOTS = 2000;
const CHAIN_REWARD_BLOCK_MS = CHAIN_REWARD_BLOCK_SECONDS * 1000;

type PointsHistoryEntry = { timestamp: Date; points: number };

function toTimestampMs(value: unknown): number | null {
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const ms = new Date(value).getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    return null;
}

function normalizePointsHistory(rawHistory: unknown): PointsHistoryEntry[] {
    if (!Array.isArray(rawHistory)) return [];

    return rawHistory
        .map((entry) => {
            const safeEntry = (entry && typeof entry === 'object')
                ? (entry as { timestamp?: unknown; points?: unknown })
                : {};
            const timestampMs = toTimestampMs(safeEntry.timestamp);
            const points = Math.max(0, Math.round(Number(safeEntry.points || 0)));
            if (timestampMs === null) return null;
            return { timestamp: new Date(timestampMs), points };
        })
        .filter((entry): entry is PointsHistoryEntry => !!entry)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function getPointsForCompletedBlocks(completedBlocks: number): number {
    const safeBlocks = Math.max(0, Math.floor(Number(completedBlocks || 0)));
    if (safeBlocks <= 0) return 0;

    // 10 + 20 + 30 + ... + (completedBlocks * 10)
    return Math.round((CHAIN_REWARD_STEP_POINTS * safeBlocks * (safeBlocks + 1)) / 2);
}

function rewardPointsFromContributionSeconds(contributionSeconds: number): number {
    const safeSeconds = Math.max(0, Math.floor(Number(contributionSeconds || 0)));
    const completedBlocks = Math.floor(safeSeconds / CHAIN_REWARD_BLOCK_SECONDS);
    return getPointsForCompletedBlocks(completedBlocks);
}

function buildHistoryFromContributionSeconds(
    contributionSeconds: number,
    anchorMs: number,
    nowMs: number
): PointsHistoryEntry[] {
    const safeSeconds = Math.max(0, Math.floor(Number(contributionSeconds || 0)));
    const completedBlocks = Math.floor(safeSeconds / CHAIN_REWARD_BLOCK_SECONDS);
    if (completedBlocks <= 0) return [];

    const requiredSpanMs = completedBlocks * CHAIN_REWARD_BLOCK_MS;
    const latestValidAnchor = nowMs - requiredSpanMs;
    const effectiveAnchorMs = Math.min(anchorMs, latestValidAnchor);

    const history: PointsHistoryEntry[] = [];
    for (let blockIndex = 1; blockIndex <= completedBlocks; blockIndex++) {
        const timestampMs = effectiveAnchorMs + (blockIndex * CHAIN_REWARD_BLOCK_MS);
        history.push({
            timestamp: new Date(timestampMs),
            points: getPointsForCompletedBlocks(blockIndex),
        });
    }

    return history.slice(-MAX_HISTORY_SNAPSHOTS);
}

function areHistoriesEqual(a: PointsHistoryEntry[], b: PointsHistoryEntry[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].points !== b[i].points) return false;
        if (a[i].timestamp.getTime() !== b[i].timestamp.getTime()) return false;
    }
    return true;
}

export async function recomputeChainPointsForUsers(userIds: string[]): Promise<void> {
    const normalizedUserIds = [...new Set(
        (userIds || [])
            .map((id) => String(id || '').trim().toLowerCase())
            .filter(Boolean)
    )];

    if (normalizedUserIds.length === 0) return;

    const aggregateRows = await Chain.aggregate([
        { $match: { 'members.userId': { $in: normalizedUserIds } } },
        { $unwind: '$members' },
        { $match: { 'members.userId': { $in: normalizedUserIds } } },
        {
            $project: {
                userId: '$members.userId',
                contributionTime: { $ifNull: ['$members.contributionTime', 0] },
                joinedAt: '$members.joinedAt',
                chainCreatedAt: '$createdAt',
            },
        },
    ]);

    const contributionSecondsByUser = new Map<string, number>();
    const earliestAnchorByUser = new Map<string, number>();
    for (const row of aggregateRows) {
        const userId = String(row?.userId || '').trim().toLowerCase();
        if (!userId) continue;

        const chainContributionSeconds = Number(row?.contributionTime || 0);
        const safeContributionSeconds = Math.max(0, Math.floor(chainContributionSeconds));

        contributionSecondsByUser.set(
            userId,
            (contributionSecondsByUser.get(userId) || 0) + safeContributionSeconds
        );

        if (safeContributionSeconds > 0) {
            const joinedAtMs = toTimestampMs(row?.joinedAt);
            const chainCreatedAtMs = toTimestampMs(row?.chainCreatedAt);
            const anchorCandidate = joinedAtMs ?? chainCreatedAtMs;
            if (anchorCandidate !== null) {
                const existingAnchor = earliestAnchorByUser.get(userId);
                if (existingAnchor === undefined || anchorCandidate < existingAnchor) {
                    earliestAnchorByUser.set(userId, anchorCandidate);
                }
            }
        }
    }

    const totalsByUser = new Map<string, number>();
    for (const [userId, totalContributionSeconds] of contributionSecondsByUser.entries()) {
        totalsByUser.set(userId, rewardPointsFromContributionSeconds(totalContributionSeconds));
    }

    const users = await User.find({ email: { $in: normalizedUserIds } });
    const now = new Date();

    for (const user of users) {
        const targetPoints = Math.max(0, Math.round(totalsByUser.get(String(user.email).toLowerCase()) || 0));
        const currentPoints = Math.max(0, Math.round(Number(user.chainPoints || 0)));
        const totalContributionSeconds = Math.max(0, Math.floor(contributionSecondsByUser.get(String(user.email).toLowerCase()) || 0));
        const fallbackAnchorMs = now.getTime() - (totalContributionSeconds * 1000);
        const anchorMs = earliestAnchorByUser.get(String(user.email).toLowerCase()) ?? fallbackAnchorMs;

        const history = normalizePointsHistory(user.chainPointsHistory);
        const targetHistory = buildHistoryFromContributionSeconds(totalContributionSeconds, anchorMs, now.getTime());
        const shouldUpdatePoints = targetPoints !== currentPoints;
        const shouldUpdateHistory = !areHistoriesEqual(history, targetHistory);

        if (!shouldUpdatePoints && !shouldUpdateHistory) continue;

        if (shouldUpdatePoints) {
            user.chainPoints = targetPoints;
        }
        user.chainPointsLastUpdatedAt = now;
        user.chainPointsHistory = targetHistory;

        await user.save();
    }
}
