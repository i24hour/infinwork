import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getAuthorizedEmail } from '@/lib/mobile-auth';
import User from '@/models/User';
import { ensureUserHasDefaultUsername } from '@/lib/username';
import { sanitizeProjects, isValidHttpUrl, serializeProject, serializePublicProfile } from '@/lib/profile-utils';
import { isPlainObject, readJsonBody } from '@/lib/validate';
import type { ProfileUpdatePayload } from '@/types/profile';

export async function GET(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const user = await ensureUserHasDefaultUsername(email);
        const profile = serializePublicProfile(
            user as Parameters<typeof serializePublicProfile>[0],
            { includeGithubIdentity: true }
        );

        return NextResponse.json({
            profile,
            email,
        });
    } catch (error) {
        console.error('Error fetching own profile:', error);
        return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const email = await getAuthorizedEmail(request);
        if (!email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = await readJsonBody<unknown>(request);
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        if (!isPlainObject(parsed.body)) {
            return NextResponse.json({ error: 'Invalid profile payload' }, { status: 400 });
        }
        const body = parsed.body as ProfileUpdatePayload;
        await connectDB();
        await ensureUserHasDefaultUsername(email);

        const update: Record<string, unknown> = {};

        if (typeof body.headline === 'string') {
            update.headline = body.headline.trim().slice(0, 120);
        }
        if (typeof body.bio === 'string') {
            update.bio = body.bio.trim().slice(0, 500);
        }
        if (Array.isArray(body.projects)) {
            const sanitized = sanitizeProjects(body.projects);
            for (const project of sanitized) {
                if (project.siteUrl && !isValidHttpUrl(project.siteUrl)) {
                    return NextResponse.json({ error: 'Invalid site URL' }, { status: 400 });
                }
                if (project.githubUrl && !isValidHttpUrl(project.githubUrl)) {
                    return NextResponse.json({ error: 'Invalid GitHub URL' }, { status: 400 });
                }
            }
            const previousProjects = Array.isArray(body.projects) ? body.projects : [];
            update.projects = sanitized.map((project, index) => {
                const previous = previousProjects[index];
                const previousCreatedAt = previous?.createdAt
                    ? new Date(previous.createdAt)
                    : null;
                return {
                    // Preserve ids/createdAt across saves when the order is
                    // unchanged; otherwise every edit rewrote project history.
                    ...(previous?._id ? { _id: previous._id } : {}),
                    title: project.title,
                    description: project.description,
                    siteUrl: project.siteUrl,
                    githubUrl: project.githubUrl,
                    technologies: project.technologies,
                    createdAt: previousCreatedAt && Number.isFinite(previousCreatedAt.getTime())
                        ? previousCreatedAt
                        : new Date(),
                };
            });
        }
        if (typeof body.showGithubContributions === 'boolean') {
            update.showGithubContributions = body.showGithubContributions;
        }

        const updatedUser = await User.findOneAndUpdate(
            { email },
            { $set: update },
            { new: true, upsert: true }
        ).lean();

        const profile = serializePublicProfile(
            updatedUser as Parameters<typeof serializePublicProfile>[0],
            { includeGithubIdentity: true }
        );

        return NextResponse.json({
            success: true,
            profile,
            projects: (updatedUser?.projects || []).map(serializeProject),
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
}
