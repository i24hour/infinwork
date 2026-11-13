import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { decodeDataImage, isDataImage } from '@/lib/avatar';
import { isValidObjectIdString } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/**
 * Serves a user's stored avatar as a real image so it can be cached by the
 * browser and the CDN, instead of being embedded in every JSON response.
 * Avatars are already public (leaderboard, profiles).
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ userId: string }> }
) {
    const { userId } = await context.params;
    if (!isValidObjectIdString(userId)) {
        return new NextResponse(null, { status: 404 });
    }

    try {
        await connectDB();
        const user = (await User.findById(userId).select('image').lean()) as { image?: string } | null;
        const image = user?.image;
        if (!image) {
            return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
        }

        // The `v` query is the stored image length, so a URL with it never
        // changes content. Without it, revalidate normally.
        const cacheControl = request.nextUrl.searchParams.has('v') ? IMMUTABLE : REVALIDATE;

        if (!isDataImage(image)) {
            if (!/^https:\/\//i.test(image)) return new NextResponse(null, { status: 404 });
            return NextResponse.redirect(image, { status: 302, headers: { 'Cache-Control': REVALIDATE } });
        }

        const decoded = decodeDataImage(image);
        if (!decoded) {
            return new NextResponse(null, { status: 404 });
        }

        return new NextResponse(new Uint8Array(decoded.bytes), {
            headers: {
                'Content-Type': decoded.mime,
                'Content-Length': String(decoded.bytes.length),
                'Cache-Control': cacheControl,
                'X-Content-Type-Options': 'nosniff',
                // SVG is not accepted on upload; belt and braces for any image.
                'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; sandbox",
            },
        });
    } catch (error) {
        console.error('Error serving avatar:', error);
        return new NextResponse(null, { status: 500 });
    }
}
