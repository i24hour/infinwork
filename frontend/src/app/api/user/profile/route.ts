import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import Chain from '@/models/IChain';
import User from '@/models/User';
import { ensureUserHasDefaultUsername } from '@/lib/username';
import { normalizeImageDataUrl } from '@/lib/validate';
import { shrinkAvatarDataUrl } from '@/lib/avatar-resize';

export async function POST(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
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

        // Store a small 256px WebP instead of the original upload. Keeps the
        // User document (and every response built from it) tiny.
        let storedImage: string;
        try {
            storedImage = await shrinkAvatarDataUrl(normalizedImage);
        } catch {
            return NextResponse.json({ error: 'Could not read that image' }, { status: 400 });
        }

        await connectDB();

        const userEmail = email;

        await ensureUserHasDefaultUsername(userEmail);

        // Update or Create User document
        await User.findOneAndUpdate(
            { email: userEmail },
            { $set: { image: storedImage } },
            { upsert: true }
        );

        // Update all chains where this user is a member
        // MongoDB updateMany with array filters is powerful for this
        await Chain.updateMany(
            { 'members.userId': userEmail },
            { $set: { 'members.$[elem].image': storedImage } },
            { arrayFilters: [{ 'elem.userId': userEmail }] }
        );

        // Note: Since we don't have a User model, we might want to store it in ITimeTask as well
        // if we ever use that as a source of truth for user info.
        // But for now, updating all chains is the most direct way to satisfy the requirement.

        return NextResponse.json({ success: true, image: storedImage });
    } catch (error) {
        console.error('Error updating profile image:', error);
        return NextResponse.json({ error: 'Failed to update profile image' }, { status: 500 });
    }
}
