import User from '@/models/User';
import Chain from '@/models/IChain';
import { shrinkAvatarDataUrl } from '@/lib/avatar-resize';

// A 256px WebP is ~10-20 KB of base64. Anything bigger is a legacy original.
export const OVERSIZE_CHARS = 60_000;
export const DEFAULT_BATCH = 10;
export const MAX_BATCH = 25;

const oversizeMatch = {
    image: { $type: 'string', $regex: /^data:image\// },
    $expr: { $gt: [{ $strLenCP: { $ifNull: ['$image', ''] } }, OVERSIZE_CHARS] },
};

export interface AvatarMigrationReport {
    dryRun: boolean;
    processed: number;
    savedKB: number;
    remaining: number;
    results: Array<Record<string, unknown>>;
}

/**
 * Re-encodes oversized legacy avatars to 256px WebP, in place, in small
 * batches. Safe to re-run: migrated images fall under the threshold, and each
 * write only applies if the image was not changed in the meantime.
 */
export async function migrateOversizedAvatars(options: { limit?: number; dryRun?: boolean } = {}): Promise<AvatarMigrationReport> {
    const dryRun = options.dryRun === true;
    const limit = Math.min(MAX_BATCH, Math.max(1, options.limit ?? DEFAULT_BATCH));

    const batch = (await User.aggregate([
        { $match: oversizeMatch },
        { $sort: { _id: 1 } },
        { $limit: limit },
        { $project: { email: 1, username: 1, image: 1 } },
    ])) as Array<{ _id: unknown; email: string; username?: string; image: string }>;

    const results: Array<Record<string, unknown>> = [];
    let savedChars = 0;

    for (const user of batch) {
        const label = user.username || String(user._id);
        const before = user.image.length;
        try {
            const shrunk = await shrinkAvatarDataUrl(user.image);
            if (shrunk.length >= before) {
                results.push({ user: label, status: 'skipped', reason: 'not smaller' });
                continue;
            }
            if (!dryRun) {
                // Compare-and-set: do nothing if the user uploaded a new
                // picture while this batch was running.
                const updated = await User.updateOne({ _id: user._id, image: user.image }, { $set: { image: shrunk } });
                if (!updated.modifiedCount) {
                    results.push({ user: label, status: 'skipped', reason: 'changed meanwhile' });
                    continue;
                }
                if (user.email) {
                    await Chain.updateMany(
                        { 'members.userId': user.email },
                        { $set: { 'members.$[m].image': shrunk } },
                        { arrayFilters: [{ 'm.userId': user.email }] }
                    );
                }
            }
            savedChars += before - shrunk.length;
            results.push({
                user: label,
                status: dryRun ? 'would-migrate' : 'migrated',
                beforeKB: Math.round(before / 1024),
                afterKB: Math.round(shrunk.length / 1024),
            });
        } catch (error) {
            results.push({ user: label, status: 'failed', error: error instanceof Error ? error.message : 'unknown' });
        }
    }

    return {
        dryRun,
        processed: batch.length,
        savedKB: Math.round(savedChars / 1024),
        remaining: await User.countDocuments(oversizeMatch),
        results,
    };
}
