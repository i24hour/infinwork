'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'infinwork:install-dismissed';

export function InstallPrompt() {
    const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        try {
            if (window.localStorage.getItem(DISMISS_KEY) === '1') return;
        } catch {
            // ignore storage errors
        }

        const handler = (event: Event) => {
            event.preventDefault();
            setPromptEvent(event as BeforeInstallPromptEvent);
        };

        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const dismiss = () => {
        setPromptEvent(null);
        try {
            window.localStorage.setItem(DISMISS_KEY, '1');
        } catch {
            // ignore storage errors
        }
    };

    const install = async () => {
        if (!promptEvent) return;
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === 'accepted') {
            setPromptEvent(null);
        }
    };

    return (
        <AnimatePresence>
            {promptEvent && (
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    className="fixed bottom-24 right-4 z-[190] w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-white/15 bg-[var(--background)] p-4 shadow-2xl md:bottom-6"
                >
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[#4CAF50] text-sm font-bold text-white">
                            iW
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white">Install infinWORK</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                                Add it to your dock or home screen for faster access.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={dismiss}
                            className="text-zinc-500 transition-colors hover:text-white"
                            aria-label="Dismiss install prompt"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            onClick={install}
                            className="flex-1 rounded-xl bg-white px-4 py-2 text-xs font-bold text-black transition-opacity hover:opacity-90"
                        >
                            Install
                        </button>
                        <button
                            type="button"
                            onClick={dismiss}
                            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
                        >
                            Later
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
