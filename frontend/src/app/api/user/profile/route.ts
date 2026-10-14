import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import Chain from '@/models/IChain';
import User from '@/models/User';
import { ensureUserHasDefaultUsername } from '@/lib/username';
import { normalizeImageDataUrl } from '@/lib/validate';

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { image } = await request.json();
        if (!image) {
            return NextResponse.json({ error: 'Image is required' }, { status: 400 });
        }

        // Strict allowlist + size cap: raster data URLs only, max 2MB.
        const { image: normalizedImage, error: imageError } = normalizeImageDataUrl(image);
        if (imageError || !normalizedImage) {
            return NextResponse.json({ error: imageError || 'Invalid image' }, { status: 400 });
        }

        await connectDB();

        const userEmail = session.user.email;

        await ensureUserHasDefaultUsername(userEmail);

        // Update or Create User document
        await User.findOneAndUpdate(
            { email: userEmail },
            { $set: { image: normalizedImage } },
            { upsert: true }
        );

        // Update all chains where this user is a member
        // MongoDB updateMany with array filters is powerful for this
        await Chain.updateMany(
            { 'members.userId': userEmail },
            { $set: { 'members.$[elem].image': normalizedImage } },
            { arrayFilters: [{ 'elem.userId': userEmail }] }
        );

        // Note: Since we don't have a User model, we might want to store it in ITimeTask as well
        // if we ever use that as a source of truth for user info.
        // But for now, updating all chains is the most direct way to satisfy the requirement.

        return NextResponse.json({ success: true, image: normalizedImage });
    } catch (error) {
        console.error('Error updating profile image:', error);
        return NextResponse.json({ error: 'Failed to update profile image' }, { status: 500 });
    }
}
