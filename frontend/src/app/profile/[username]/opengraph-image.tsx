import { ImageResponse } from 'next/og';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const alt = 'infinWORK builder portfolio';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface OgUser {
    username?: string;
    headline?: string;
    bio?: string;
    image?: string;
    projects?: Array<{ technologies?: string[] }>;
    points?: number;
    chainPoints?: number;
    githubUsername?: string;
    githubCommitsTotal?: number;
}

export default async function ProfileOpengraphImage({
    params,
}: {
    params: Promise<{ username: string }>;
}) {
    const { username } = await params;
    let user: OgUser | null = null;

    try {
        await connectDB();
        user = await User.findOne({ username: username.toLowerCase() })
            .select('username headline bio image projects points chainPoints githubUsername githubCommitsTotal')
            .lean() as OgUser | null;
    } catch {
        user = null;
    }

    const displayName = user?.username || username;
    const headline = user?.headline || 'Builder portfolio';
    const bio = (user?.bio || 'Projects, GitHub work and measurable progress on infinWORK.').slice(0, 180);
    const projectCount = Array.isArray(user?.projects) ? user.projects.length : 0;
    const techCount = new Set(
        (user?.projects || []).flatMap((project) => project.technologies || [])
    ).size;

    const stats = [
        { label: 'Projects', value: String(projectCount) },
        { label: 'Commits', value: String(user?.githubCommitsTotal || 0) },
        { label: 'Points', value: String(user?.points || 0) },
        { label: 'Chain', value: String(user?.chainPoints || 0) },
    ];

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: '#050505',
                    color: '#ffffff',
                    padding: '64px 72px',
                    fontFamily: 'sans-serif',
                    position: 'relative',
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        top: -180,
                        right: -140,
                        width: 520,
                        height: 520,
                        borderRadius: 9999,
                        background: 'rgba(76,175,80,0.16)',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        bottom: -220,
                        left: -120,
                        width: 480,
                        height: 480,
                        borderRadius: 9999,
                        background: 'rgba(255,255,255,0.05)',
                    }}
                />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div
                            style={{
                                width: 44,
                                height: 44,
                                borderRadius: 9999,
                                border: '3px solid #4CAF50',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 18,
                                fontWeight: 700,
                            }}
                        >
                            iW
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>infinWORK</span>
                            <span style={{ fontSize: 13, color: '#a1a1aa', letterSpacing: 2 }}>BUILDER PORTFOLIO</span>
                        </div>
                    </div>
                    <span style={{ fontSize: 15, color: '#71717a' }}>infinwork.app</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 36, marginTop: 12 }}>
                    <div
                        style={{
                            width: 132,
                            height: 132,
                            borderRadius: 9999,
                            background: '#18181b',
                            border: '2px solid rgba(255,255,255,0.18)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 56,
                            fontWeight: 700,
                            color: '#ffffff',
                        }}
                    >
                        {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                            <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>
                                {displayName}
                            </span>
                            <span style={{ fontSize: 28, color: '#4CAF50' }}>.os</span>
                        </div>
                        <span style={{ fontSize: 26, color: '#e4e4e7', marginTop: 4 }}>{headline}</span>
                        <span style={{ fontSize: 19, color: '#a1a1aa', marginTop: 14, lineHeight: 1.45 }}>
                            {bio}
                        </span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'stretch', gap: 14 }}>
                    {stats.map((stat) => (
                        <div
                            key={stat.label}
                            style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: 18,
                                padding: '18px 22px',
                                background: 'rgba(255,255,255,0.04)',
                            }}
                        >
                            <span style={{ fontSize: 13, color: '#71717a', letterSpacing: 1.5 }}>
                                {stat.label.toUpperCase()}
                            </span>
                            <span style={{ fontSize: 34, fontWeight: 700, marginTop: 4 }}>{stat.value}</span>
                        </div>
                    ))}
                    <div
                        style={{
                            flex: 1.4,
                            display: 'flex',
                            flexDirection: 'column',
                            border: '1px solid rgba(76,175,80,0.35)',
                            borderRadius: 18,
                            padding: '18px 22px',
                            background: 'rgba(76,175,80,0.08)',
                        }}
                    >
                        <span style={{ fontSize: 13, color: '#4CAF50', letterSpacing: 1.5 }}>STACK</span>
                        <span style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>
                            {techCount > 0 ? `${techCount} technologies` : 'Building in public'}
                        </span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 18, color: '#a1a1aa' }}>
                        {user?.githubUsername ? `GitHub @${user.githubUsername}` : 'infinWORK member'}
                    </span>
                    <span style={{ fontSize: 18, color: '#4CAF50' }}>Measure your work →</span>
                </div>
            </div>
        ),
        { width: 1200, height: 630 }
    );
}
