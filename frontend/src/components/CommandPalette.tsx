'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { fetchWithCache } from '@/lib/client-cache';

interface PaletteItem {
    id: string;
    label: string;
    hint?: string;
    group: 'Pages' | 'Workers' | 'Politicians';
    href: string;
}

const PAGE_ITEMS: PaletteItem[] = [
    { id: 'page-workbench', label: 'Workbench', hint: 'Compile work into impact', group: 'Pages', href: '/workbench' },
    { id: 'page-workers', label: 'Workers', hint: 'Live leaderboard', group: 'Pages', href: '/workers' },
    { id: 'page-itime', label: 'iTime', hint: 'Track a task', group: 'Pages', href: '/itime' },
    { id: 'page-chain', label: 'Chain', hint: 'Collaborative chains', group: 'Pages', href: '/ichain' },
    { id: 'page-ideas', label: 'Ideas', hint: 'Idea board', group: 'Pages', href: '/ideas' },
    { id: 'page-sf', label: 'SF Tracker', hint: 'Success / failure', group: 'Pages', href: '/sf-tracker' },
    { id: 'page-rank', label: 'Rank Politician', hint: 'Union + state focus ranking', group: 'Pages', href: '/rank-politician' },
    { id: 'page-profile', label: 'Profile', hint: 'Your portfolio', group: 'Pages', href: '/profile' },
    { id: 'page-settings', label: 'Settings', hint: 'Account and GitHub', group: 'Pages', href: '/settings' },
    { id: 'page-info', label: 'Rules & formulas', hint: 'How scoring works', group: 'Pages', href: '/info' },
    { id: 'page-products', label: 'Products', hint: 'infinwork products', group: 'Pages', href: '/products' },
];

interface WorkerRow {
    publicId?: string;
    userId?: string;
    username?: string;
}

interface PoliticianRow {
    name: string;
    slug: string;
    portfolio?: string;
    party?: string;
}

export function CommandPalette() {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [workers, setWorkers] = useState<WorkerRow[]>([]);
    const [politicians, setPoliticians] = useState<PoliticianRow[]>([]);
    const loadedRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setOpen((value) => !value);
            }
            if (event.key === 'Escape') {
                setOpen(false);
                setQuery('');
                setActiveIndex(0);
            }
        };
        const onCommand = () => {
            setQuery('');
            setActiveIndex(0);
            setOpen(true);
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('infinwork:command', onCommand);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('infinwork:command', onCommand);
        };
    }, []);

    useEffect(() => {
        if (!open) return;
        setTimeout(() => inputRef.current?.focus(), 40);

        if (loadedRef.current) return;
        loadedRef.current = true;

        Promise.all([
            fetchWithCache<{ workers?: WorkerRow[] }>('/api/workers', { dedupingIntervalMs: 30000 }).catch(() => ({ workers: [] })),
            fetchWithCache<{ politicians?: PoliticianRow[] }>('/api/rank-politician?sortBy=onPortfolioPct', { dedupingIntervalMs: 30000 }).catch(() => ({ politicians: [] })),
        ]).then(([workerData, politicianData]) => {
            setWorkers((workerData.workers || []).slice(0, 20));
            setPoliticians((politicianData.politicians || []).slice(0, 30));
        });
    }, [open]);

    const items = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        const matches = (value: string) => !normalized || value.toLowerCase().includes(normalized);

        const pages = PAGE_ITEMS.filter((item) => matches(`${item.label} ${item.hint || ''}`));
        const workerItems: PaletteItem[] = workers
            .map((worker) => {
                const publicId = worker.publicId || worker.userId || '';
                return {
                    id: `worker-${publicId}`,
                    label: worker.username || 'Anonymous',
                    hint: `@${publicId}`,
                    group: 'Workers' as const,
                    href: `/workers/${encodeURIComponent(publicId)}`,
                };
            })
            .filter((item) => item.href !== '/workers/' && matches(`${item.label} ${item.hint}`));
        const politicianItems: PaletteItem[] = politicians
            .map((politician) => ({
                id: `politician-${politician.slug}`,
                label: politician.name,
                hint: [politician.party, politician.portfolio].filter(Boolean).join(' · '),
                group: 'Politicians' as const,
                href: `/rank-politician/${encodeURIComponent(politician.slug)}`,
            }))
            .filter((item) => matches(`${item.label} ${item.hint || ''}`));

        return [...pages, ...workerItems, ...politicianItems];
    }, [politicians, query, workers]);

    const close = () => {
        setOpen(false);
        setQuery('');
        setActiveIndex(0);
    };

    const select = (item: PaletteItem) => {
        close();
        router.push(item.href);
    };

    const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => Math.min(items.length - 1, index + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
        } else if (event.key === 'Enter' && items[activeIndex]) {
            event.preventDefault();
            select(items[activeIndex]);
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[220] flex items-start justify-center px-4 pt-[12vh]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={close} />
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Command palette"
                        initial={{ opacity: 0, y: -16, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -16, scale: 0.98 }}
                        transition={{ duration: 0.16 }}
                        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[var(--background)] shadow-2xl"
                    >
                        <div className="flex items-center gap-3 border-b border-white/10 px-4">
                            <svg className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
                            </svg>
                            <input
                                ref={inputRef}
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                    setActiveIndex(0);
                                }}
                                onKeyDown={onInputKeyDown}
                                placeholder="Jump to a page, worker or politician..."
                                className="h-14 w-full bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
                                aria-label="Search commands"
                            />
                            <kbd className="hidden rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-zinc-500 sm:block">esc</kbd>
                        </div>

                        <div className="max-h-[55vh] overflow-y-auto p-2">
                            {items.length === 0 ? (
                                <p className="px-4 py-10 text-center text-sm text-zinc-500">
                                    Nothing matches “{query}”.
                                </p>
                            ) : (
                                <div className="flex flex-col gap-0.5">
                                    {items.map((item, index) => {
                                        const showGroup = index === 0 || items[index - 1].group !== item.group;
                                        return (
                                            <div key={item.id}>
                                                {showGroup && (
                                                    <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                                                        {item.group}
                                                    </p>
                                                )}
                                                <button
                                                    type="button"
                                                    onMouseEnter={() => setActiveIndex(index)}
                                                    onClick={() => select(item)}
                                                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                                                        activeIndex === index
                                                            ? 'bg-white/10 text-white'
                                                            : 'text-zinc-300 hover:bg-white/5'
                                                    }`}
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-sm font-medium">{item.label}</span>
                                                        {item.hint && (
                                                            <span className="block truncate text-xs text-zinc-500">{item.hint}</span>
                                                        )}
                                                    </span>
                                                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-600">
                                                        open
                                                    </span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[10px] text-zinc-600">
                            <span>↑↓ navigate · ↵ open · esc close</span>
                            <span>⌘K</span>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
