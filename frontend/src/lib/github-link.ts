import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveAuthSecret } from './auth-env';

export const GITHUB_LINK_COOKIE = 'gh_link';
export const GITHUB_LINK_COOKIE_MAX_AGE_SECONDS = 300;

interface GithubLinkPayload {
    email: string;
    exp: number;
    nonce: string;
}

function base64UrlEncode(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
    return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(encodedPayload: string): string {
    return createHmac('sha256', resolveAuthSecret()).update(encodedPayload).digest('hex');
}

/**
 * Mint a short-lived, server-signed GitHub link token for an authenticated
 * user. Stored in an HttpOnly cookie by /api/user/link-github-init and
 * verified in the NextAuth jwt callback before linking a GitHub identity.
 */
export function createGithubLinkToken(email: string): string {
    const payload: GithubLinkPayload = {
        email: email.trim().toLowerCase(),
        exp: Date.now() + GITHUB_LINK_COOKIE_MAX_AGE_SECONDS * 1000,
        nonce: randomBytes(16).toString('hex'),
    };
    const encoded = base64UrlEncode(JSON.stringify(payload));
    return `${encoded}.${sign(encoded)}`;
}

/**
 * Verify a link token. Returns the linked email, or null when the token is
 * missing, malformed, expired, or not signed by this server.
 */
export function verifyGithubLinkToken(token: string | undefined | null): string | null {
    if (!token || typeof token !== 'string') return null;
    const separatorIndex = token.lastIndexOf('.');
    if (separatorIndex <= 0) return null;

    const encoded = token.slice(0, separatorIndex);
    const signature = token.slice(separatorIndex + 1);
    const expected = sign(encoded);

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    try {
        const payload = JSON.parse(base64UrlDecode(encoded)) as Partial<GithubLinkPayload>;
        if (!payload.email || typeof payload.email !== 'string') return null;
        if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
        return payload.email.trim().toLowerCase();
    } catch {
        return null;
    }
}
