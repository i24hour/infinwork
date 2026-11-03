'use client';

import { useEffect } from 'react';

export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-black px-6">
            <div className="max-w-md text-center">
                <p className="mb-3 font-mono text-sm font-semibold uppercase tracking-[0.3em] text-red-400">
                    Workspace error
                </p>
                <h1 className="text-3xl font-bold text-white">Something broke mid-run.</h1>
                <p className="mt-3 text-zinc-400">
                    Your tasks and score are stored server-side. Try loading this view again.
                </p>
                {error.digest && (
                    <p className="mt-3 font-mono text-[11px] text-zinc-600">ref: {error.digest}</p>
                )}
                <button
                    type="button"
                    onClick={reset}
                    className="mt-8 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90"
                >
                    Try again
                </button>
            </div>
        </div>
    );
}
