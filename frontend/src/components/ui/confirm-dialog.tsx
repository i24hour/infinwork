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

export interface ConfirmOptions {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
}

interface ConfirmState {
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<ConfirmState | null>(null);
    const stateRef = useRef<ConfirmState | null>(null);

    const confirm = useCallback((options: ConfirmOptions) => {
        return new Promise<boolean>((resolve) => {
            const next = { options, resolve };
            stateRef.current = next;
            setState(next);
        });
    }, []);

    const close = useCallback((value: boolean) => {
        const current = stateRef.current;
        if (current) {
            current.resolve(value);
        }
        stateRef.current = null;
        setState(null);
    }, []);

    const value = useMemo(() => ({ confirm }), [confirm]);

    return (
        <ConfirmContext.Provider value={value}>
            {children}
            <AnimatePresence>
                {state && (
                    <motion.div
                        className="fixed inset-0 z-[210] flex items-center justify-center p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <div
                            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
                            onClick={() => close(false)}
                        />
                        <motion.div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="confirm-title"
                            initial={{ opacity: 0, y: 16, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 16, scale: 0.97 }}
                            transition={{ duration: 0.18 }}
                            className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[var(--background)] p-6 shadow-2xl"
                        >
                            <h3 id="confirm-title" className="text-xl font-bold text-white">
                                {state.options.title}
                            </h3>
                            {state.options.description && (
                                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                                    {state.options.description}
                                </p>
                            )}
                            <div className="mt-6 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => close(false)}
                                    className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
                                >
                                    {state.options.cancelLabel || 'Cancel'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => close(true)}
                                    autoFocus
                                    className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 ${
                                        state.options.destructive
                                            ? 'bg-red-500 text-white'
                                            : 'bg-white text-black'
                                    }`}
                                >
                                    {state.options.confirmLabel || 'Confirm'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmContextValue {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('useConfirm must be used inside <ConfirmProvider>');
    }
    return context;
}
