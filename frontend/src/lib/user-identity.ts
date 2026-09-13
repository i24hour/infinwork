export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeUserId(value?: string | null): string {
    return (value || '').trim().toLowerCase();
}

export function sameUserId(left?: string | null, right?: string | null): boolean {
    const a = normalizeUserId(left);
    const b = normalizeUserId(right);
    return Boolean(a && b && a === b);
}

export function userIdentifierQuery(identifier: string) {
    const normalized = normalizeUserId(identifier);
    const exact = new RegExp(`^${escapeRegex(normalized)}$`, 'i');

    return {
        $or: [
            { email: exact },
            { username: exact },
        ],
    };
}

export function isUserOnChain(
    chain: { members?: Array<{ userId?: string }>; createdBy?: string },
    userId?: string | null
): boolean {
    if (!normalizeUserId(userId)) return false;
    if (sameUserId(chain.createdBy, userId)) return true;
    return (chain.members || []).some((member) => sameUserId(member.userId, userId));
}
