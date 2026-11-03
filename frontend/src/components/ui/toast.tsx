'use client';

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';

type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
    title: string;
    description?: string;
    variant?: ToastVariant;
    durationMs?: number;
}

interface ToastEntry extends ToastOptions {
    id: number;
}

interface ToastContextValue {
    toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, ReactNode> = {
    success: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
    ),
    error: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
    ),
    info: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v4m0 4h.01M12 3a9 9 0 110 18 9 9 0 010-18z" />
        </svg>
    ),
};

const TONE: Record<ToastVariant, string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    error: 'border-red-500/30 bg-red-500/10 text-red-300',
    info: 'border-white/15 bg-white/10 text-zinc-200',
};

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastEntry[]>([]);
    const idRef = useRef(0);

    const dismiss = useCallback((id: number) => {
        setToasts((prev) => prev.filter((entry) => entry.id !== id));
    }, []);

    const toast = useCallback((options: ToastOptions) => {
        const id = ++idRef.current;
        const entry: ToastEntry = {
            variant: 'info',
            durationMs: 4200,
            ...options,
            id,
        };
        setToasts((prev) => [...prev.slice(-3), entry]);
        window.setTimeout(() => dismiss(id), entry.durationMs);
    }, [dismiss]);

    const value = useMemo(() => ({ toast }), [toast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div
                className="pointer-events-none fixed bottom-20 right-4 z-[200] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 md:bottom-6"
                aria-live="polite"
                aria-atomic="false"
            >
                <AnimatePresence initial={false}>
                    {toasts.map((entry) => (
                        <motion.div
                            key={entry.id}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 24, scale: 0.98 }}
                            transition={{ duration: 0.18 }}
                            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${TONE[entry.variant || 'info']}`}
                            role="status"
                        >
                            <span className="mt-0.5 shrink-0">{ICONS[entry.variant || 'info']}</span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-white">{entry.title}</p>
                                {entry.description && (
                                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                                        {entry.description}
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => dismiss(entry.id)}
                                className="shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:text-white"
                                aria-label="Dismiss notification"
                            >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextValue {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used inside <ToastProvider>');
    }
    return context;
}
