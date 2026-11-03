import type { Metadata } from 'next';

export async function generateMetadata({
    params,
}: {
    params: Promise<{ username: string }>;
}): Promise<Metadata> {
    const { username } = await params;
    let displayName = username;
    try {
        displayName = decodeURIComponent(username);
    } catch {
        displayName = username;
    }

    return {
        title: `${displayName} — builder portfolio`,
        description: `${displayName}'s projects, GitHub work and measurable progress on infinWORK.`,
        openGraph: {
            title: `${displayName} — builder portfolio`,
            description: `Projects, GitHub work and measurable progress on infinWORK.`,
            type: 'profile',
        },
        twitter: {
            card: 'summary_large_image',
            title: `${displayName} — builder portfolio`,
            description: `Projects, GitHub work and measurable progress on infinWORK.`,
        },
    };
}

export default function PublicProfileLayout({ children }: { children: React.ReactNode }) {
    return children;
}
