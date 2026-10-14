'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import { Sidebar } from '@/components/Sidebar';
import { PortfolioView } from '@/components/profile/PortfolioView';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import Link from 'next/link';
import type { PublicProfile } from '@/types/profile';
import type { GithubContributionCalendar } from '@/types/github-contributions';

export default function PublicProfilePage() {
    const params = useParams();
    const username = decodeURIComponent(params.username as string);
    const { data: session } = useSession();

    const [profile, setProfile] = useState<PublicProfile | null>(null);
    const [githubCalendar, setGithubCalendar] = useState<GithubContributionCalendar | null>(null);
    const [loading, setLoading] = useState(true);
    const [githubLoading, setGithubLoading] = useState(false);
    const [notFound, setNotFound] = useState(false);
    const [ownerUsername, setOwnerUsername] = useState<string | null>(null);

    useEffect(() => {
        if (!session) {
            setOwnerUsername(null);
            return;
        }
        fetch('/api/profile')
            .then((r) => r.ok ? r.json() : null)
            .then((data) => setOwnerUsername(data?.profile?.username || null))
            .catch(() => setOwnerUsername(null));
    }, [session]);

    const isProfileOwner = !!ownerUsername && ownerUsername === profile?.username;

    const loadGithub = useCallback(async (uname: string) => {
        setGithubLoading(true);
        try {
            const res = await fetch(`/api/profiles/${encodeURIComponent(uname)}/github`);
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

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch(`/api/profiles/${encodeURIComponent(username)}`);
                if (res.status === 404) {
                    setNotFound(true);
                    return;
                }
                const data = await res.json();
                setProfile(data.profile);
                if (data.profile?.githubUsername && data.profile?.showGithubContributions !== false) {
                    await loadGithub(username);
                }
            } catch {
                setNotFound(true);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [username, loadGithub]);

    const handleHideGithub = async () => {
        if (!isProfileOwner) return;
        await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showGithubContributions: false }),
        });
        setProfile((p) => (p ? { ...p, showGithubContributions: false } : p));
        setGithubCalendar(null);
    };

    const handleShowGithub = async () => {
        if (!isProfileOwner) return;
        await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showGithubContributions: true }),
        });
        setProfile((p) => (p ? { ...p, showGithubContributions: true } : p));
        await loadGithub(username);
    };

    const handleConnectGithub = async () => {
        try {
            await fetch('/api/user/link-github-init', { method: 'POST' });
        } catch {
            // fall through to signIn below
        }
        signIn('github');
    };

    return (
        <div className="flex min-h-screen flex-col bg-black md:flex-row">
            <Sidebar />
            <main className="flex-1 w-full p-4 pt-20 md:p-8 md:pt-8">
                {loading ? (
                    <div className="flex min-h-[50vh] items-center justify-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-white/40" />
                    </div>
                ) : notFound || !profile ? (
                    <div className="mx-auto max-w-lg py-20 text-center">
                        <h1 className="text-2xl font-bold text-white">Profile not found</h1>
                        <Link href="/profiles" className="mt-6 inline-block">
                            <LiquidButton className="text-white">Back to profiles</LiquidButton>
                        </Link>
                    </div>
                ) : (
                    <PortfolioView
                        profile={profile}
                        isOwner={isProfileOwner}
                        githubCalendar={githubCalendar}
                        githubLoading={githubLoading}
                        githubHidden={profile.showGithubContributions === false}
                        onConnectGithub={handleConnectGithub}
                        onHideGithub={handleHideGithub}
                        onShowGithub={handleShowGithub}
                    />
                )}
            </main>
        </div>
    );
}
