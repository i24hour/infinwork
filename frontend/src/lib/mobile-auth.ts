import { createHash, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import MobileSession from '@/models/MobileSession';

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function hashMobileToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/** Issue a bearer token for the Android app. The raw token is returned once. */
export async function issueMobileToken(email: string): Promise<string> {
    await connectDB();
    const token = randomBytes(32).toString('base64url');
    await MobileSession.create({
        tokenHash: hashMobileToken(token),
        email,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });
    return token;
}

export async function revokeMobileToken(token: string): Promise<void> {
    if (!token) return;
    await connectDB();
    await MobileSession.deleteOne({ tokenHash: hashMobileToken(token) });
}

async function emailFromAuthorizationHeader(header: string | null): Promise<string | null> {
    if (!header?.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    if (token.length < 32 || token.length > 200) return null;

    await connectDB();
    const row = await MobileSession.findOne({
        tokenHash: hashMobileToken(token),
        expiresAt: { $gt: new Date() },
    })
        .select('email')
        .lean();

    return (row as { email?: string } | null)?.email || null;
}

/** Android sends Authorization: Bearer. The website keeps using the NextAuth cookie. */
export async function getAuthorizedEmail(request: NextRequest): Promise<string | null> {
    const fromBearer = await emailFromAuthorizationHeader(request.headers.get('authorization'));
    if (fromBearer) return fromBearer;

    const session = await getServerSession(authOptions);
    return session?.user?.email || null;
}
