'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Sidebar } from '@/components/Sidebar';
import { PortfolioView } from '@/components/profile/PortfolioView';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import type { PublicProfile } from '@/types/profile';
import type { GithubContributionCalendar } from '@/types/github-contributions';

export default function ProfileEditorPage() {
    const { data: session, status } = useSession();
    const [profile, setProfile] = useState<PublicProfile | null>(null);
    const [githubCalendar, setGithubCalendar] = useState<GithubContributionCalendar | null>(null);
    const [loading, setLoading] = useState(true);
    const [githubLoading, setGithubLoading] = useState(false);

    const loadGithub = useCallback(async (username: string) => {
        setGithubLoading(true);
        try {
            const res = await fetch(`/api/profiles/${encodeURIComponent(username)}/github`);
            const data = await res.json();
            if (data.hidden) {
                setGithubCalendar(null);
                return;
            }
            setGithubCalendar(data.calendar || null);
        } catch {
            setGithubCalendar(null);
        } finally {
            setGithubLoading(false);
        }
    }, []);

    const userEmail = session?.user?.email;
    const loadedRef = useRef(false);

    useEffect(() => {
        if (!userEmail) {
            setLoading(false);
            return;
        }
        if (loadedRef.current) return;

        async function load() {
            try {
                const res = await fetch('/api/profile');
                if (!res.ok) throw new Error('Failed to load');
                const data = await res.json();
                setProfile(data.profile);
                loadedRef.current = true;
                if (data.profile?.githubUsername && data.profile?.showGithubContributions !== false) {
                    await loadGithub(data.profile.username);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [userEmail, loadGithub]);

    const handleConnectGithub = async () => {
        try {
            await fetch('/api/user/link-github-init', { method: 'POST' });
        } catch {
            // fall through to signIn below
        }
        signIn('github');
    };

    const handleHideGithub = async () => {
        await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showGithubContributions: false }),
        });
        setProfile((p) => (p ? { ...p, showGithubContributions: false } : p));
        setGithubCalendar(null);
    };

    const handleShowGithub = async () => {
        await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showGithubContributions: true }),
        });
        setProfile((p) => (p ? { ...p, showGithubContributions: true } : p));
        if (profile?.username) await loadGithub(profile.username);
    };

    if (status === 'loading' || loading) {
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
                    onProfileSaved={setProfile}
                />
            </main>
        </div>
    );
}
