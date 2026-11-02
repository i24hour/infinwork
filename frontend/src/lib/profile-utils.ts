import type { IUser, IUserProject } from '@/models/User';
import type { ProfileProject, PublicProfile } from '@/types/profile';

export function serializeProject(project: IUserProject): ProfileProject {
    return {
        _id: project._id?.toString(),
        title: project.title,
        description: project.description || '',
        siteUrl: project.siteUrl || '',
        githubUrl: project.githubUrl || '',
        technologies: project.technologies || [],
        createdAt: project.createdAt?.toISOString(),
    };
}

export function serializePublicProfile(
    user: IUser,
    options: { includeGithubIdentity?: boolean } = {}
): PublicProfile | null {
    if (!user.username) return null;

    const showGithub = user.showGithubContributions !== false;

    return {
        username: user.username,
        image: user.image,
        headline: user.headline || '',
        bio: user.bio || '',
        // Hiding contributions should also hide the GitHub account from
        // public visitors. The owner still needs it to manage the connection.
        githubUsername: showGithub || options.includeGithubIdentity ? user.githubUsername : undefined,
        showGithubContributions: showGithub,
        githubCommitsTotal: user.githubCommitsTotal || 0,
        points: user.points || 0,
        chainPoints: user.chainPoints || 0,
        memberSince: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
        projects: (user.projects || []).map(serializeProject),
    };
}

export function normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

export function isValidHttpUrl(url: string): boolean {
    if (!url.trim()) return true;
    try {
        const parsed = new URL(normalizeUrl(url));
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

export function sanitizeProjects(projects: ProfileProject[]): ProfileProject[] {
    return projects
        .map((project) => ({
            title: project.title?.trim().slice(0, 80) || '',
            description: project.description?.trim().slice(0, 300) || '',
            siteUrl: project.siteUrl?.trim() ? normalizeUrl(project.siteUrl) : '',
            githubUrl: project.githubUrl?.trim() ? normalizeUrl(project.githubUrl) : '',
            technologies: (project.technologies || [])
                .map((t) => t.trim().slice(0, 40))
                .filter(Boolean)
                .slice(0, 8),
        }))
        .filter((p) => p.title.length > 0)
        .slice(0, 20);
}
