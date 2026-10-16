import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { issueMobileToken } from '@/lib/mobile-auth';

export const dynamic = 'force-dynamic';

function handoffPage(token: string): string {
    const deepLink = `infinwork://auth?token=${encodeURIComponent(token)}`;
    const intentLink = `intent://auth?token=${encodeURIComponent(token)}#Intent;scheme=infinwork;package=app.infinwork;end`;
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0;url=${deepLink}" />
  <title>Return to infinWORK</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #000; color: #fff; font-family: system-ui, sans-serif; }
    main { max-width: 24rem; padding: 2rem; text-align: center; }
    a { display: inline-block; margin-top: 1.5rem; background: #fff; color: #000; text-decoration: none; border-radius: 999px; padding: 0.9rem 1.4rem; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>Signed in</h1>
    <p>Opening the infinWORK app.</p>
    <a href="${intentLink}">Open infinWORK</a>
  </main>
  <script>location.replace(${JSON.stringify(deepLink)});</script>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.redirect(new URL('/api/mobile/auth/start', request.nextUrl.origin));
    }

    const token = await issueMobileToken(session.user.email);
    return new NextResponse(handoffPage(token), {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}
