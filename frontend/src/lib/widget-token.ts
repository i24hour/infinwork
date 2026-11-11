import { createHash, randomBytes } from 'crypto';

const TOKEN_PATTERN = /^inw_[a-f0-9]{64}$/;

export function isWidgetToken(token: string): boolean {
    return TOKEN_PATTERN.test(token);
}

export function hashWidgetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/** Raw key is returned once. Only the hash is stored. */
export function createWidgetToken(): { token: string; hash: string; prefix: string } {
    const token = `inw_${randomBytes(32).toString('hex')}`;
    return {
        token,
        hash: hashWidgetToken(token),
        prefix: `${token.slice(0, 8)}…`,
    };
}
