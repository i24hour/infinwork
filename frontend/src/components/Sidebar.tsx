'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signIn, signOut } from 'next-auth/react';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import {
    fetchWithCache,
    getCachedData,
    getInitialIsLightTheme,
    prefetchJson,
    subscribeCache,
} from '@/lib/client-cache';

const navItems: Array<{ href: string; label: string; prefetchEndpoints?: string[] }> = [
    { href: '/profile', label: 'Profile', prefetchEndpoints: ['/api/profile'] },
    { href: '/itime', label: 'iTime', prefetchEndpoints: ['/api/itime', '/api/user/settings'] },
    { href: '/workers', label: 'WOrKers', prefetchEndpoints: ['/api/workers'] },
    { href: '/rank-politician', label: 'Rank Politician', prefetchEndpoints: ['/api/rank-politician?sortBy=netScore'] },
    { href: '/ideas', label: 'Ideas', prefetchEndpoints: ['/api/ideas'] },
    { href: '/ichain', label: 'Chain', prefetchEndpoints: ['/api/ichain'] },
    { href: '/sf-tracker', label: 'SF Tracker', prefetchEndpoints: ['/api/sf-tracker'] },
    { href: '/settings', label: 'Settings', prefetchEndpoints: ['/api/user/settings'] },
];

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { data: session, status } = useSession();
    const [isOpen, setIsOpen] = useState(false);
    const [userProfile, setUserProfile] = useState<{ username?: string; image?: string }>(() => {
        const cached = getCachedData<{ username?: string }>('/api/user/settings');
        return cached?.username ? { username: cached.username } : {};
    });
    const [theme, setTheme] = useState<'dark' | 'light'>(() => (getInitialIsLightTheme() ? 'light' : 'dark'));

    useEffect(() => {
        setIsOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('app-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('app-theme', 'dark');
        }
    }, [theme]);

    // Eagerly prefetch all top-level routes so SPA transitions are instant
    useEffect(() => {
        for (const item of navItems) {
            router.prefetch(item.href);
        }
    }, [router]);

    useEffect(() => {
        return subscribeCache<{ username?: string }>('/api/user/settings', (data) => {
            if (data?.username) {
                setUserProfile((prev) => (prev.username === data.username ? prev : { ...prev, username: data.username }));
            }
        });
    }, []);

    const fetchUserProfile = useCallback(async () => {
        try {
            const data = await fetchWithCache<{ username?: string }>('/api/user/settings', {
                dedupingIntervalMs: 5000,
            });
            if (data?.username) {
                setUserProfile((prev) => (prev.username === data.username ? prev : { ...prev, username: data.username }));
            }
        } catch (err) {
            console.error('Error fetching profile in sidebar:', err);
        }
    }, []);

    useEffect(() => {
        if (!session?.user?.email) return;

        fetchUserProfile();

        const interval = setInterval(() => {
            fetchUserProfile();
        }, 15000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchUserProfile();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchUserProfile, session?.user?.email]);

    const handleWarmNav = useCallback((item: typeof navItems[number]) => {
        router.prefetch(item.href);
        if (!item.prefetchEndpoints) return;
        for (const endpoint of item.prefetchEndpoints) {
            // Only pre-warm auth-only endpoints when signed in
            if (
                (endpoint === '/api/profile' || endpoint === '/api/itime' || endpoint === '/api/user/settings' || endpoint === '/api/sf-tracker') &&
                status !== 'authenticated'
            ) {
                continue;
            }
            prefetchJson(endpoint, 15000);
        }
    }, [router, status]);

    return (
        <>
            {/* Mobile Header */}
            <div className={`md:hidden fixed top-0 left-0 right-0 h-16 border-b z-50 flex items-center justify-between px-4 ${theme === 'light' ? 'bg-white border-black/10' : 'bg-black border-white/10'}`}>
                <div className="flex items-center gap-1">
                    <span className={`text-xl font-semibold tracking-tight ${theme === 'light' ? 'text-black' : 'text-white'}`}>infinW</span>
                    <div className={`animate-spin-slow rounded-full h-5 w-5 border-t-2 border-b-2 mt-0.5 ${theme === 'light' ? 'border-black' : 'border-white'}`}></div>
                    <span className={`text-xl font-semibold tracking-tight ${theme === 'light' ? 'text-black' : 'text-white'}`}>rK</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                        className={`p-2 rounded-md transition-colors ${theme === 'light' ? 'text-zinc-600 hover:text-black hover:bg-black/5' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                        title="Toggle Theme"
                    >
                        {theme === 'light' ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05 5.636 5.636m12.728 0L16.95 7.05M7.05 16.95l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
                            </svg>
                        )}
                    </button>
                    <button onClick={() => setIsOpen(true)} className={`p-2 -mr-2 ${theme === 'light' ? 'text-zinc-500 hover:text-black' : 'text-zinc-400 hover:text-white'}`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Mobile Overlay */}
            {isOpen && (
                <div className="md:hidden fixed inset-0 bg-black/80 z-[60]" onClick={() => setIsOpen(false)} />
            )}

            <aside className={`fixed md:sticky top-0 left-0 z-[70] h-[100dvh] w-64 border-r p-6 flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${theme === 'light' ? 'bg-white border-black/10' : 'bg-black border-white/10'} ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>

                {/* Close Button Mobile */}
                <button onClick={() => setIsOpen(false)} className={`md:hidden absolute top-4 right-4 ${theme === 'light' ? 'text-zinc-500 hover:text-black' : 'text-zinc-400 hover:text-white'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Logo */}
                <div className="mb-8 flex items-center gap-1">
                    <span className={`text-2xl font-semibold tracking-tight ${theme === 'light' ? 'text-black' : 'text-white'}`}>infinW</span>
                    <div className={`animate-spin-slow rounded-full h-6 w-6 border-t-2 border-b-2 mt-0.5 ${theme === 'light' ? 'border-black' : 'border-white'}`}></div>
                    <span className={`text-2xl font-semibold tracking-tight ${theme === 'light' ? 'text-black' : 'text-white'}`}>rK</span>
                </div>

                {/* Nav */}
                <nav className="space-y-2 mb-8 w-full">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                prefetch={true}
                                onMouseEnter={() => handleWarmNav(item)}
                                onFocus={() => handleWarmNav(item)}
                                onTouchStart={() => handleWarmNav(item)}
                                className="block w-full"
                            >
                                <LiquidButton
                                    type="button"
                                    className={`w-full justify-start text-left px-5 py-3 rounded-full transition-all duration-300 ${isActive
                                        ? 'shadow-[0_0_15px_rgba(255,255,255,0.3)] border border-white/20 text-white bg-white/5'
                                        : theme === 'light'
                                            ? 'text-zinc-600 border border-transparent hover:text-black hover:bg-black/5'
                                            : 'text-zinc-400 border border-transparent hover:text-white hover:bg-black'
                                        }`}
                                    variant="default"
                                >
                                    <span className="font-medium text-sm flex-1">{item.label}</span>
                                </LiquidButton>
                            </Link>
                        );
                    })}
                </nav>

                <div className="mt-auto mb-6">
                    <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}`}>Theme</div>
                    <div className={`p-1 rounded-xl border flex ${theme === 'light' ? 'bg-zinc-100 border-zinc-200' : 'bg-black border-white/10'}`}>
                        <button
                            onClick={() => setTheme('light')}
                            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${theme === 'light' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                            Light
                        </button>
                        <button
                            onClick={() => setTheme('dark')}
                            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${theme === 'dark' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                            Dark
                        </button>
                    </div>
                </div>

                {/* User Info */}
                <div className="mt-6 pt-6 border-t border-white/10">
                    {status === 'loading' ? (
                        <div className="animate-pulse bg-white/5 h-10 w-full rounded-lg"></div>
                    ) : session ? (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 overflow-hidden">
                                {session.user?.image ? (
                                    <img src={session.user.image} alt="" className="w-8 h-8 rounded-full border border-white/10 shrink-0 object-cover" />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white shrink-0">
                                        {(userProfile.username || session.user?.name || session.user?.email || 'U')[0].toUpperCase()}
                                    </div>
                                )}
                                <div className="truncate pr-2">
                                    <div className="text-sm font-medium text-white truncate">{userProfile.username || session.user?.name || 'User'}</div>
                                </div>
                            </div>
                            <button onClick={() => signOut()} className="p-2 text-zinc-500 hover:text-white transition-colors shrink-0" title="Sign Out">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </button>
                        </div>
                    ) : (
                        <LiquidButton onClick={() => signIn('google')} className="w-full text-xs py-2 content-center text-center font-semibold text-white justify-center flex">
                            Sign In
                        </LiquidButton>
                    )}
                </div>
            </aside>
        </>
    );
}
