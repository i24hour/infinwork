import mongoose from 'mongoose';
import User from '@/models/User';

import { DATA_PREFIX, isDataImage, resolveAvatar, avatarUrlFor } from './avatar-url';

export { isDataImage, resolveAvatar, avatarUrlFor };

// Evaluated by MongoDB so the image bytes never leave the database.
const IS_DATA = { $eq: [{ $substrCP: [{ $ifNull: ['$image', ''] }, 0, DATA_PREFIX.length] }, DATA_PREFIX] };

const AVATAR_FIELDS = {
    __avatarData: IS_DATA,
    __avatarVersion: { $cond: [IS_DATA, { $strLenCP: { $ifNull: ['$image', ''] } }, 0] },
    image: { $cond: [IS_DATA, null, { $ifNull: ['$image', null] }] },
};

type Row = Record<string, any>;

/**
 * Like `User.find(match).select(fields).lean()`, but `image` is always a small
 * string (or null) and the stored data URL is never transferred.
 * Omit `fields` to keep every other field.
 */
export async function findUsersWithAvatar(
    match: Record<string, unknown>,
    fields?: string[],
    options: { sort?: Record<string, 1 | -1>; limit?: number } = {}
): Promise<Row[]> {
    const stages: Record<string, unknown>[] = [{ $match: match }];
    if (options.sort) stages.push({ $sort: options.sort });
    if (options.limit) stages.push({ $limit: options.limit });

    if (fields) {
        const project: Record<string, unknown> = { _id: 1, __avatarData: 1, __avatarVersion: 1, image: 1 };
        for (const field of fields) {
            if (field !== 'image') project[field] = 1;
        }
        stages.push({ $addFields: AVATAR_FIELDS }, { $project: project });
    } else {
        stages.push({ $addFields: AVATAR_FIELDS });
    }

    const rows = (await User.aggregate(stages as any)) as Row[];
    return rows.map(finalizeAvatarRow);
}

export async function findOneUserWithAvatar(
    match: Record<string, unknown>,
    fields?: string[]
): Promise<Row | null> {
    const rows = await findUsersWithAvatar(match, fields, { limit: 1 });
    return rows[0] || null;
}

function finalizeAvatarRow(row: Row): Row {
    const { __avatarData, __avatarVersion, ...rest } = row;
    rest.image = resolveAvatar({ _id: row._id, image: row.image, __avatarData, __avatarVersion });
    return rest;
}

/** Aggregation does not cast ids the way `find` does. */
export function toObjectId(value: string): mongoose.Types.ObjectId | null {
    return mongoose.Types.ObjectId.isValid(value) && /^[a-fA-F0-9]{24}$/.test(value)
        ? new mongoose.Types.ObjectId(value)
        : null;
}

/** Decode a stored data URL into bytes for the avatar route. */
export function decodeDataImage(value: string): { mime: string; bytes: Buffer } | null {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match) return null;
    return { mime: match[1] === 'image/jpg' ? 'image/jpeg' : match[1], bytes: Buffer.from(match[2], 'base64') };
}
