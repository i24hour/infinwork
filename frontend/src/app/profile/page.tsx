'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Sidebar } from '@/components/Sidebar';
import { PortfolioView } from '@/components/profile/PortfolioView';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import type { PublicProfile } from '@/types/profile';
import type { GithubContributionCalendar } from '@/types/github-contributions';
import { fetchWithCache, getCachedData, setCachedData } from '@/lib/client-cache';

export default function ProfileEditorPage() {
    const { data: session, status } = useSession();
    const initialCached = getCachedData<{ profile?: PublicProfile }>('/api/profile');
    const [profile, setProfile] = useState<PublicProfile | null>(() => initialCached?.profile || null);
    const [githubCalendar, setGithubCalendar] = useState<GithubContributionCalendar | null>(() => {
        if (!initialCached?.profile?.username) return null;
        const cachedGh = getCachedData<{ calendar?: GithubContributionCalendar | null; hidden?: boolean }>(
            `/api/profiles/${encodeURIComponent(initialCached.profile.username)}/github`
        );
        return cachedGh?.hidden ? null : cachedGh?.calendar || null;
    });
    const [loading, setLoading] = useState<boolean>(() => !initialCached?.profile);
    const [githubLoading, setGithubLoading] = useState(false);

    const loadGithub = useCallback(async (username: string) => {
        const ghUrl = `/api/profiles/${encodeURIComponent(username)}/github`;
        const cachedGh = getCachedData<{ calendar?: GithubContributionCalendar | null; hidden?: boolean }>(ghUrl);
        if (cachedGh) {
            setGithubCalendar(cachedGh.hidden ? null : cachedGh.calendar || null);
        } else {
            setGithubLoading(true);
        }
        try {
            const data = await fetchWithCache<{ calendar?: GithubContributionCalendar | null; hidden?: boolean }>(
                ghUrl,
                { dedupingIntervalMs: 10000 }
            );
            if (data.hidden) {
                setGithubCalendar(null);
                return;
            }
            setGithubCalendar(data.calendar || null);
        } catch {
            if (!cachedGh) setGithubCalendar(null);
        } finally {
            setGithubLoading(false);
        }
    }, []);

    const loadedRef = useRef(false);

    useEffect(() => {
        if (status === 'unauthenticated') {
            setLoading(false);
            return;
        }
        if (loadedRef.current) return;

        async function load() {
            try {
                const data = await fetchWithCache<{ profile?: PublicProfile }>('/api/profile', {
                    dedupingIntervalMs: 3000,
                });
                if (data.profile) {
                    setProfile(data.profile);
                }
                loadedRef.current = true;
                if (data.profile?.githubUsername && data.profile?.showGithubContributions !== false) {
                    await loadGithub(data.profile.username);
                }
            } catch (err) {
                if (status === 'loading') return;
                console.error(err);
            } finally {
                if (status !== 'loading' || loadedRef.current) {
                    setLoading(false);
                }
            }
        }
        load();
    }, [status, loadGithub]);

    const handleConnectGithub = () => {
        if (session?.user?.email) {
            document.cookie = `github_link_email=${encodeURIComponent(session.user.email)}; path=/; max-age=300`;
        }
        signIn('github');
    };

    const handleHideGithub = async () => {
        await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showGithubContributions: false }),
        });
        setProfile((p) => {
            const next = p ? { ...p, showGithubContributions: false } : p;
            if (next) setCachedData('/api/profile', { profile: next });
            return next;
        });
        setGithubCalendar(null);
    };

    const handleShowGithub = async () => {
        await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showGithubContributions: true }),
        });
        setProfile((p) => {
            const next = p ? { ...p, showGithubContributions: true } : p;
            if (next) setCachedData('/api/profile', { profile: next });
            return next;
        });
        if (profile?.username) await loadGithub(profile.username);
    };

    if ((status === 'loading' && !profile) || loading) {
        return (
            <div className="flex min-h-screen bg-black">
                <Sidebar />
                <main className="flex flex-1 items-center justify-center pt-20 md:pt-0">
                    <div className="folio-spinner h-8 w-8 animate-spin rounded-full border-2" />
                </main>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex min-h-screen flex-col bg-black md:flex-row">
                <Sidebar />
                <main className="flex flex-1 flex-col items-center justify-center px-6 pt-20 text-center md:pt-8">
                    <h1 className="text-3xl font-bold text-white">Your builder portfolio</h1>
                    <p className="mt-3 max-w-md text-zinc-400">
                        Sign in to build your profile — projects, site links, GitHub repos, and tech stack.
                    </p>
                    <LiquidButton onClick={() => signIn('google')} className="mt-8 px-8 py-3 text-white">
                        Sign In to Continue
                    </LiquidButton>
                </main>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="flex min-h-screen flex-col bg-black md:flex-row">
                <Sidebar />
                <main className="flex flex-1 items-center justify-center pt-20 md:pt-8">
                    <p className="text-zinc-400">Could not load your profile.</p>
                </main>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen flex-col bg-black md:flex-row">
            <Sidebar />
            <main className="flex-1 w-full p-4 pt-20 md:p-8 md:pt-8">
                <PortfolioView
                    profile={profile}
                    isOwner
                    editMode
                    githubCalendar={githubCalendar}
                    githubLoading={githubLoading}
                    githubHidden={profile.showGithubContributions === false}
                    onConnectGithub={handleConnectGithub}
                    onHideGithub={handleHideGithub}
                    onShowGithub={handleShowGithub}
                    onProfileSaved={(updated) => {
                        setProfile(updated);
                        setCachedData('/api/profile', { profile: updated });
                    }}
                />
            </main>
        </div>
    );
}
