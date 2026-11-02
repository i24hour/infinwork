import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import { isGithubOAuthConfigured } from '@/lib/auth-env';
import {
    GITHUB_LINK_ATTEMPT_COOKIE,
    GITHUB_LINK_COOKIE,
    GITHUB_LINK_COOKIE_MAX_AGE_SECONDS,
    createGithubLinkToken,
} from '@/lib/github-link';

export const dynamic = 'force-dynamic';

/**
 * Start a GitHub account link for the currently signed-in user.
 * Sets a short-lived, server-signed HttpOnly cookie that the NextAuth jwt
 * callback verifies before merging the GitHub identity onto this account.
 */
export async function POST(request: NextRequest) {
    const email = await getAuthorizedEmail(request);
    if (!email) {
        return NextResponse.json({ error: 'Please sign in again before connecting GitHub.' }, { status: 401 });
    }

    if (!isGithubOAuthConfigured()) {
        return NextResponse.json(
            { error: 'GitHub sign-in is not configured on this deployment.' },
            { status: 503 }
        );
    }

    const token = createGithubLinkToken(email);
    const response = NextResponse.json({ success: true });
    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge: GITHUB_LINK_COOKIE_MAX_AGE_SECONDS,
    };

    response.cookies.set(GITHUB_LINK_COOKIE, token, cookieOptions);
    response.cookies.set(GITHUB_LINK_ATTEMPT_COOKIE, '1', cookieOptions);
    return response;
}
