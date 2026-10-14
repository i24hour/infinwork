import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import {
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
export async function POST() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = createGithubLinkToken(session.user.email);
    const response = NextResponse.json({ success: true });
    response.cookies.set(GITHUB_LINK_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: GITHUB_LINK_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
}
