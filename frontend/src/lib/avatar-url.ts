/**
 * Pure avatar helpers. No server imports, so client components (and anything
 * they import, like profile-utils) can use them without bundling the DB driver.
 *
 * Avatars used to be stored as base64 data URLs inside the User document (one
 * was 1.4 MB) and were copied into every list API response. The data URL now
 * stays on the server and clients get a small, cacheable URL instead.
 *
 * - `https://…` images (Google/GitHub avatars) are returned untouched.
 * - `data:image/…` images become `/api/avatar/<userId>?v=<length>`. The version
 *   changes whenever the stored image changes, so the URL can be cached forever.
 */

export const DATA_PREFIX = 'data:';

export function isDataImage(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(DATA_PREFIX);
}

export function avatarUrlFor(userId: unknown, version: number): string {
    return `/api/avatar/${String(userId)}?v=${version}`;
}

/**
 * Resolve the client-facing image for a user-like object. Works for full
 * documents (image is a data URL) and for documents produced by
 * `findUsersWithAvatar` (flags only, image never loaded).
 */
export function resolveAvatar(user: {
    _id?: unknown;
    image?: unknown;
    __avatarData?: boolean;
    __avatarVersion?: number;
}): string | null {
    if (user.__avatarData) {
        return avatarUrlFor(user._id, user.__avatarVersion || 0);
    }
    if (isDataImage(user.image)) {
        return avatarUrlFor(user._id, user.image.length);
    }
    return typeof user.image === 'string' && user.image ? user.image : null;
}

