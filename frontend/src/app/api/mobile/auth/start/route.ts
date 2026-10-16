import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Opens Google sign-in and returns to the app token handoff when it succeeds. */
export async function GET(request: NextRequest) {
    const finish = new URL('/api/mobile/auth/finish', request.nextUrl.origin);
    const signIn = new URL('/api/auth/signin/google', request.nextUrl.origin);
    signIn.searchParams.set('callbackUrl', finish.toString());
    return NextResponse.redirect(signIn);
}
