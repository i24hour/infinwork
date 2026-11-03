import Link from 'next/link';
import { Sidebar } from '@/components/Sidebar';

export default function NotFound() {
    return (
        <div className="flex min-h-screen flex-col bg-black md:flex-row">
            <Sidebar />
            <main className="flex flex-1 items-center justify-center px-6 pt-20 md:pt-8">
                <div className="max-w-md text-center">
                    <p className="mb-3 font-mono text-sm font-semibold uppercase tracking-[0.3em] text-[#4CAF50]">
                        404
                    </p>
                    <h1 className="text-3xl font-bold text-white">This page moved out of the chain.</h1>
                    <p className="mt-3 text-zinc-400">
                        The link may be broken, or the page may have been removed. Your work is safe.
                    </p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link
                            href="/workers"
                            className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90"
                        >
                            Back to Workers
                        </Link>
                        <Link
                            href="/itime"
                            className="rounded-full border border-white/15 px-6 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
                        >
                            Open iTime
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
