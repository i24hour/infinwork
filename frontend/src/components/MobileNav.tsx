'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const ITEMS = [
    {
        href: '/workers',
        label: 'Workers',
        icon: (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-2.13a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6 3 3 0 000 6zM6 9a3 3 0 100-6 3 3 0 000 6z" />
        ),
    },
    {
        href: '/steps',
        label: 'Steps',
        icon: (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5h10M9 12h10M9 19h10M5 5h.01M5 12h.01M5 19h.01" />
        ),
    },
    {
        href: '/itime',
        label: 'iTime',
        icon: (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        ),
    },
    {
        href: '/ichain',
        label: 'Chain',
        icon: (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.828 10.172a4 4 0 010 5.656l-2 2a4 4 0 01-5.656-5.656l1-1m7.656-3.656a4 4 0 00-5.656 0l-2 2a4 4 0 005.656 5.656l1-1" />
        ),
    },
    {
        href: '/ideas',
        label: 'Ideas',
        icon: (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.663 17h4.674M12 3a6 6 0 00-3.6 10.8c.5.4.8 1 .8 1.7V17h5.6v-1.5c0-.7.3-1.3.8-1.7A6 6 0 0012 3z" />
        ),
    },
    {
        href: '/sf-tracker',
        label: 'SF',
        icon: (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v18m5-15H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
        ),
    },
];

function useIsLightTheme() {
    const [isLight, setIsLight] = useState(false);

    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setIsLight(root.getAttribute('data-theme') === 'light');
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    return isLight;
}

export function MobileNav() {
    const pathname = usePathname();
    const isLight = useIsLightTheme();

    return (
        <nav
            className={`fixed inset-x-0 bottom-0 z-[80] border-t px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl md:hidden ${
                isLight ? 'border-black/10 bg-white/95' : 'border-white/10 bg-black/90'
            }`}
            aria-label="Primary navigation"
        >
            <div className="mx-auto flex max-w-lg items-stretch justify-between">
                {ITEMS.map((item) => {
                    const active =
                        pathname === item.href ||
                        (item.href !== '/' && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            prefetch
                            aria-current={active ? 'page' : undefined}
                            className={`group flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors ${
                                active
                                    ? isLight
                                        ? 'text-black'
                                        : 'text-white'
                                    : isLight
                                        ? 'text-zinc-500 hover:text-zinc-800'
                                        : 'text-zinc-500 hover:text-zinc-200'
                            }`}
                        >
                            <span
                                className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors ${
                                    active
                                        ? isLight
                                            ? 'bg-[#111111] text-[#ffffff]'
                                            : 'bg-white/10 text-white'
                                        : 'bg-transparent'
                                }`}
                            >
                                <svg className="h-[19px] w-[19px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    {item.icon}
                                </svg>
                            </span>
                            <span className="truncate text-[10px] font-semibold tracking-wide">
                                {item.label}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
