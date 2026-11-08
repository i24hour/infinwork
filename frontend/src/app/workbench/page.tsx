'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
    compileWork,
    formatHours,
    impactMultiple,
    impactPerHour,
    stateLabel,
    type TimePreset,
    type Work,
    type WorkState,
} from '@/lib/workbench/compiler';

const STORAGE_KEY = 'infinwork.workbench.v1';

const TIME_PRESETS: Array<{ value: TimePreset; label: string }> = [
    { value: 'auto', label: 'Auto time box' },
    { value: '2h', label: '2 hours' },
    { value: '4h', label: '4 hours' },
    { value: '8h', label: '8 hours' },
    { value: '1d', label: '1 day' },
    { value: '3d', label: '3 days' },
];

const STATE_ORDER: Record<WorkState, number> = {
    active: 0,
    paused: 1,
    blocked: 2,
    shipped: 3,
    killed: 4,
    abandoned: 5,
};

function stateClass(state: WorkState): string {
    switch (state) {
        case 'active':
            return 'border-[#d8ff3e]/40 bg-[#d8ff3e]/10 text-[#d8ff3e]';
        case 'paused':
            return 'border-amber-400/30 bg-amber-400/10 text-amber-300';
        case 'blocked':
            return 'border-orange-400/30 bg-orange-400/10 text-orange-300';
        case 'shipped':
            return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300';
        case 'killed':
            return 'border-red-500/30 bg-red-500/10 text-red-300';
        case 'abandoned':
            return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
    }
}

function StateBadge({ state }: { state: WorkState }) {
    return (
        <span
            className={`inline-flex items-center border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] ${stateClass(state)}`}
        >
            {stateLabel(state)}
        </span>
    );
}

function Stat({
    label,
    value,
    accent = false,
}: {
    label: string;
    value: string | number;
    accent?: boolean;
}) {
    return (
        <div className="border border-[#2b2b25] bg-[#080807] p-3 md:p-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#77776c]">{label}</p>
            <p
                className={`mt-2 font-mono text-xl md:text-2xl font-semibold tracking-tight ${
                    accent ? 'text-[#d8ff3e]' : 'text-[#f4f1e8]'
                }`}
            >
                {value}
            </p>
        </div>
    );
}

function Label({ children }: { children: React.ReactNode }) {
    return (
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#77776c]">{children}</p>
    );
}

function EditableField({
    label,
    value,
    onChange,
    multiline = false,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    multiline?: boolean;
}) {
    return (
        <label className="block border-t border-[#24241f] pt-3">
            <Label>{label}</Label>
            {multiline ? (
                <textarea
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    rows={3}
                    className="mt-2 w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 text-[#d9d6ca] outline-none placeholder:text-[#55554d] focus:text-[#f4f1e8]"
                />
            ) : (
                <input
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="mt-2 w-full border-0 bg-transparent p-0 text-sm leading-6 text-[#d9d6ca] outline-none placeholder:text-[#55554d] focus:text-[#f4f1e8]"
                />
            )}
        </label>
    );
}

export default function WorkbenchPage() {
    const [works, setWorks] = useState<Work[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [compiled, setCompiled] = useState<Work | null>(null);
    const [title, setTitle] = useState('');
    const [preset, setPreset] = useState<TimePreset>('auto');
    const [isCompiling, setIsCompiling] = useState(false);
    const [hydrated, setHydrated] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const protocolRef = useRef<HTMLDivElement | null>(null);

    const selectedWork = works.find((work) => work.id === selectedId) || null;

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Work[];
                if (Array.isArray(parsed)) {
                    setWorks(parsed);
                    const first =
                        parsed.find((work) => work.state === 'active') || parsed[0] || null;
                    setSelectedId(first?.id || null);
                }
            }
        } catch {
            // A corrupt local prototype should not break the page.
        } finally {
            setHydrated(true);
        }
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(works));
    }, [hydrated, works]);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), 3000);
        return () => window.clearTimeout(timer);
    }, [notice]);

    const sortedWorks = useMemo(() => {
        return [...works].sort((a, b) => {
            const stateDiff = STATE_ORDER[a.state] - STATE_ORDER[b.state];
            if (stateDiff !== 0) return stateDiff;
            const impactDiff = impactPerHour(b) - impactPerHour(a);
            if (impactDiff !== 0) return impactDiff;
            return b.updatedAt - a.updatedAt;
        });
    }, [works]);

    const totals = useMemo(() => {
        return {
            works: works.length,
            proofs: works.reduce((sum, work) => sum + work.proofs, 0),
            hours: works.reduce((sum, work) => sum + work.hoursInvested, 0),
            shipped: works.filter((work) => work.state === 'shipped').length,
            active: works.filter((work) => work.state === 'active').length,
        };
    }, [works]);

    const handleCompile = useCallback(
        (overrideTitle?: string) => {
            const source = (overrideTitle ?? title).trim();
            if (!source) {
                setError('Write the work first.');
                inputRef.current?.focus();
                return;
            }

            setError(null);
            setNotice(null);
            setIsCompiling(true);
            window.setTimeout(() => {
                try {
                    setCompiled(compileWork(source, preset));
                    setSelectedId(null);
                    window.setTimeout(() => {
                        protocolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 60);
                } catch (compileError) {
                    setError(
                        compileError instanceof Error
                            ? compileError.message
                            : 'Could not compile this work.'
                    );
                } finally {
                    setIsCompiling(false);
                }
            }, 420);
        },
        [preset, title]
    );

    const updateCompiled = (patch: Partial<Work>) => {
        setCompiled((current) =>
            current ? { ...current, ...patch, updatedAt: Date.now() } : current
        );
    };

    const updateSelected = (patch: Partial<Work>) => {
        if (!selectedId) return;
        setWorks((current) =>
            current.map((work) =>
                work.id === selectedId ? { ...work, ...patch, updatedAt: Date.now() } : work
            )
        );
    };

    const approveCompiled = () => {
        if (!compiled) return;
        setWorks((current) => [compiled, ...current]);
        setSelectedId(compiled.id);
        setCompiled(null);
        setTitle('');
        setError(null);
        setNotice('Work started. The next move is the contract.');
    };

    const startFirstWork = () => {
        setTitle('Build the Workbench');
        setPreset('8h');
        handleCompile('Build the Workbench');
    };

    const newWork = () => {
        setCompiled(null);
        setSelectedId(null);
        setTitle('');
        setError(null);
        setNotice(null);
        inputRef.current?.focus();
    };

    const addTime = (hours: number) => {
        if (!selectedWork) return;
        const nextHours = Math.round((selectedWork.hoursInvested + hours) * 100) / 100;
        updateSelected({ hoursInvested: nextHours });
        setNotice(`+${formatHours(hours)} logged.`);
    };

    const logProof = () => {
        if (!selectedWork) return;
        updateSelected({ proofs: selectedWork.proofs + 1 });
        setNotice('Proof logged. The portfolio just became more honest.');
    };

    const shipWork = () => {
        if (!selectedWork) return;
        updateSelected({
            state: 'shipped',
            actualImpact: selectedWork.actualImpact || 1,
        });
        setNotice('Shipped. Now the impact is part of the record.');
    };

    const togglePause = () => {
        if (!selectedWork) return;
        updateSelected({ state: selectedWork.state === 'paused' ? 'active' : 'paused' });
        setNotice(selectedWork.state === 'paused' ? 'Work resumed.' : 'Work paused. Pause is a state, not a failure.');
    };

    const abandonWork = () => {
        if (!selectedWork) return;
        updateSelected({ state: 'abandoned' });
        setNotice('Abandoned. That is data, not a verdict on you.');
    };

    return (
        <div className="min-h-screen bg-[#050504] text-[#f4f1e8] selection:bg-[#d8ff3e] selection:text-black">
            <header className="border-b border-[#24241f]">
                <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 md:px-8">
                    <Link href="/workers" className="group flex items-center gap-3">
                        <span className="flex h-5 w-5 items-center justify-center border border-[#d8ff3e] text-[#d8ff3e] transition-colors group-hover:bg-[#d8ff3e] group-hover:text-black">
                            <span className="h-1.5 w-1.5 bg-current" />
                        </span>
                        <span className="text-sm font-semibold tracking-[-0.02em] text-[#f4f1e8]">
                            infinwork
                        </span>
                        <span className="hidden font-mono text-[9px] uppercase tracking-[0.22em] text-[#77776c] sm:inline">
                            / workbench
                        </span>
                    </Link>
                    <div className="flex items-center gap-4">
                        <span className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-[#66665c] md:inline">
                            local prototype / v0.1
                        </span>
                        <Link
                            href="/workers"
                            className="border border-[#2b2b25] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#aaa99d] transition-colors hover:border-[#d8ff3e]/60 hover:text-[#d8ff3e]"
                        >
                            Back to app ↗
                        </Link>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
                <div className="mb-8 flex items-end justify-between gap-6">
                    <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-[#77776c]">
                            Compile work, not tasks
                        </p>
                        <h1 className="mt-3 max-w-4xl text-3xl font-semibold leading-[1.02] tracking-[-0.045em] text-[#f4f1e8] md:text-5xl">
                            What work are you trying to do?
                        </h1>
                        <p className="mt-4 max-w-2xl text-sm leading-6 text-[#99988c] md:text-base">
                            No goal required. Start with the work. The system compiles the impact,
                            proof, time box, and kill criteria. Every work gets its own instrument.
                        </p>
                    </div>
                    <div className="hidden shrink-0 text-right font-mono text-[10px] uppercase leading-6 tracking-[0.16em] text-[#66665c] lg:block">
                        <p>{totals.works} works</p>
                        <p>{totals.proofs} proofs</p>
                        <p>{formatHours(totals.hours)} invested</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-w-0 space-y-6">
                        <section className="relative overflow-hidden border border-[#2b2b25] bg-[#0a0a08]">
                            <div
                                className="pointer-events-none absolute inset-0 opacity-40"
                                style={{
                                    backgroundImage:
                                        'linear-gradient(rgba(216,255,62,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(216,255,62,0.035) 1px, transparent 1px)',
                                    backgroundSize: '48px 48px',
                                }}
                            />
                            <div className="relative p-5 md:p-7">
                                <div className="flex items-center justify-between">
                                    <Label>Compiler / 01</Label>
                                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#66665c]">
                                        ⌘ + enter to compile
                                    </span>
                                </div>
                                <textarea
                                    ref={inputRef}
                                    value={title}
                                    onChange={(event) => setTitle(event.target.value)}
                                    onKeyDown={(event) => {
                                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                            event.preventDefault();
                                            handleCompile();
                                        }
                                    }}
                                    placeholder="Build the Workbench. Write the essay. Automate the scraping pipeline. Learn enough to decide."
                                    rows={3}
                                    className="mt-5 w-full resize-none border-0 bg-transparent p-0 text-2xl font-medium leading-[1.35] tracking-[-0.03em] text-[#f4f1e8] outline-none placeholder:text-[#4d4d45] md:text-4xl"
                                />
                                <div className="mt-5 flex flex-col gap-3 border-t border-[#24241f] pt-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <select
                                            value={preset}
                                            onChange={(event) =>
                                                setPreset(event.target.value as TimePreset)
                                            }
                                            className="border border-[#2b2b25] bg-[#080807] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.15em] text-[#aaa99d] outline-none focus:border-[#d8ff3e]/60"
                                        >
                                            {TIME_PRESETS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-[#5e5e54]">
                                            {isCompiling ? 'compiling…' : 'one work at a time'}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleCompile()}
                                        disabled={isCompiling || !title.trim()}
                                        className="inline-flex items-center justify-center gap-3 bg-[#d8ff3e] px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:bg-[#e6ff86] disabled:cursor-not-allowed disabled:opacity-30"
                                    >
                                        {isCompiling ? 'Compiling' : 'Compile work'}
                                        <span aria-hidden="true">→</span>
                                    </button>
                                </div>
                                {error && (
                                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-red-400">
                                        {error}
                                    </p>
                                )}
                                {notice && (
                                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[#d8ff3e]">
                                        {notice}
                                    </p>
                                )}
                                <div className="mt-5 flex flex-wrap gap-2">
                                    {[
                                        'Build the Workbench',
                                        'Write the launch essay',
                                        'Automate the scraping pipeline',
                                        'Learn enough to decide the next product bet',
                                        'Fix the onboarding drop-off',
                                    ].map((example) => (
                                        <button
                                            key={example}
                                            type="button"
                                            onClick={() => {
                                                setTitle(example);
                                                handleCompile(example);
                                            }}
                                            className="border border-[#24241f] px-2.5 py-1.5 text-left font-mono text-[9px] uppercase tracking-[0.08em] text-[#7d7d70] transition-colors hover:border-[#d8ff3e]/50 hover:text-[#d8ff3e]"
                                        >
                                            {example}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {isCompiling && (
                                <motion.div
                                    className="absolute bottom-0 left-0 h-[2px] bg-[#d8ff3e]"
                                    initial={{ width: '0%' }}
                                    animate={{ width: '100%' }}
                                    transition={{ duration: 0.42, ease: 'easeOut' }}
                                />
                            )}
                        </section>

                        {compiled ? (
                            <motion.section
                                ref={protocolRef}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.24, ease: 'easeOut' }}
                                className="border border-[#d8ff3e]/35 bg-[#0a0a08]"
                            >
                                <div className="flex flex-col gap-3 border-b border-[#2b2b25] p-5 md:flex-row md:items-center md:justify-between md:p-6">
                                    <div>
                                        <Label>Work protocol / draft</Label>
                                        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#f4f1e8] md:text-3xl">
                                            {compiled.title}
                                        </h2>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="border border-[#d8ff3e]/40 bg-[#d8ff3e]/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#d8ff3e]">
                                            Verdict: Invest
                                        </span>
                                        <span className="border border-[#2b2b25] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8e8e80]">
                                            {compiled.impactClass}
                                        </span>
                                    </div>
                                </div>

                                <div className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
                                    <div className="space-y-4">
                                        <EditableField
                                            label="Impact"
                                            value={compiled.impact}
                                            onChange={(value) => updateCompiled({ impact: value })}
                                            multiline
                                        />
                                        <EditableField
                                            label="Primary metric"
                                            value={compiled.metric}
                                            onChange={(value) => updateCompiled({ metric: value })}
                                            multiline
                                        />
                                        <EditableField
                                            label="Proof"
                                            value={compiled.proof}
                                            onChange={(value) => updateCompiled({ proof: value })}
                                            multiline
                                        />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="block border-t border-[#24241f] pt-3">
                                            <Label>Time budget / hours</Label>
                                            <input
                                                type="number"
                                                min={0.5}
                                                step={0.5}
                                                value={compiled.timeBudgetHours}
                                                onChange={(event) =>
                                                    updateCompiled({
                                                        timeBudgetHours: Math.max(
                                                            0.5,
                                                            Number(event.target.value) || 0.5
                                                        ),
                                                    })
                                                }
                                                className="mt-2 w-full border-0 bg-transparent p-0 font-mono text-2xl font-semibold text-[#f4f1e8] outline-none"
                                            />
                                        </label>
                                        <EditableField
                                            label="Next irreversible move"
                                            value={compiled.nextMove}
                                            onChange={(value) => updateCompiled({ nextMove: value })}
                                            multiline
                                        />
                                        <div className="border-t border-[#24241f] pt-3">
                                            <Label>Kill criteria</Label>
                                            <ul className="mt-2 space-y-2">
                                                {compiled.killCriteria.map((criterion) => (
                                                    <li
                                                        key={criterion}
                                                        className="flex gap-2 text-sm leading-5 text-[#b5b3a7]"
                                                    >
                                                        <span className="mt-1 h-1 w-1 shrink-0 bg-[#ff6b3d]" />
                                                        {criterion}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                        <div className="flex items-center justify-between border-t border-[#24241f] pt-3">
                                            <Label>Optionality</Label>
                                            <span className="font-mono text-sm text-[#d8ff3e]">
                                                +{compiled.optionality} options
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 border-t border-[#2b2b25] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
                                    <p className="max-w-md font-mono text-[9px] uppercase leading-4 tracking-[0.1em] text-[#66665c]">
                                        These fields belong to the work, not the app. Edit them
                                        before you commit.
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCompiled(null);
                                                setNotice('Draft discarded.');
                                            }}
                                            className="border border-[#2b2b25] px-4 py-3 font-mono text-[9px] uppercase tracking-[0.16em] text-[#8e8e80] transition-colors hover:border-red-500/40 hover:text-red-300"
                                        >
                                            Discard
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCompile(compiled.title)}
                                            className="border border-[#2b2b25] px-4 py-3 font-mono text-[9px] uppercase tracking-[0.16em] text-[#aaa99d] transition-colors hover:border-[#d8ff3e]/50 hover:text-[#d8ff3e]"
                                        >
                                            Recompile
                                        </button>
                                        <button
                                            type="button"
                                            onClick={approveCompiled}
                                            className="bg-[#d8ff3e] px-5 py-3 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[#e6ff86]"
                                        >
                                            Approve & start →
                                        </button>
                                    </div>
                                </div>
                            </motion.section>
                        ) : selectedWork ? (
                            <motion.section
                                key={selectedWork.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.22, ease: 'easeOut' }}
                                className="border border-[#2b2b25] bg-[#0a0a08]"
                            >
                                <div className="flex flex-col gap-3 border-b border-[#2b2b25] p-5 md:flex-row md:items-start md:justify-between md:p-6">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StateBadge state={selectedWork.state} />
                                            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#77776c]">
                                                Workbench / {selectedWork.impactClass}
                                            </span>
                                        </div>
                                        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-[#f4f1e8] md:text-3xl">
                                            {selectedWork.title}
                                        </h2>
                                        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b5b3a7]">
                                            {selectedWork.impact}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={newWork}
                                        className="w-fit border border-[#2b2b25] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[#8e8e80] transition-colors hover:border-[#d8ff3e]/50 hover:text-[#d8ff3e]"
                                    >
                                        New work +
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4 md:p-6">
                                    <Stat
                                        label="Time invested"
                                        value={`${formatHours(selectedWork.hoursInvested)} / ${formatHours(
                                            selectedWork.timeBudgetHours
                                        )}`}
                                    />
                                    <Stat
                                        label="Impact multiple"
                                        value={`${impactMultiple(selectedWork).toFixed(2)}x`}
                                        accent
                                    />
                                    <Stat
                                        label="Impact / hour"
                                        value={impactPerHour(selectedWork).toFixed(2)}
                                        accent
                                    />
                                    <Stat label="Proofs" value={selectedWork.proofs} />
                                </div>

                                <div className="px-5 md:px-6">
                                    <div className="h-1.5 w-full overflow-hidden bg-[#1d1d18]">
                                        <div
                                            className="h-full bg-[#d8ff3e] transition-[width] duration-300"
                                            style={{
                                                width: `${Math.min(
                                                    100,
                                                    (selectedWork.hoursInvested /
                                                        selectedWork.timeBudgetHours) *
                                                        100
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                    <div className="mt-2 flex justify-between font-mono text-[8px] uppercase tracking-[0.16em] text-[#66665c]">
                                        <span>
                                            {Math.round(
                                                (selectedWork.hoursInvested /
                                                    selectedWork.timeBudgetHours) *
                                                    100
                                            )}
                                            % of time box
                                        </span>
                                        <span>{selectedWork.proof}</span>
                                    </div>
                                </div>

                                <div className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
                                    <div className="space-y-5">
                                        <div className="border border-[#d8ff3e]/30 bg-[#d8ff3e]/[0.045] p-4">
                                            <Label>Next irreversible move</Label>
                                            <p className="mt-2 text-sm leading-6 text-[#f4f1e8]">
                                                {selectedWork.nextMove}
                                            </p>
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => addTime(0.5)}
                                                    className="border border-[#d8ff3e]/40 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#d8ff3e] transition-colors hover:bg-[#d8ff3e] hover:text-black"
                                                >
                                                    +30m
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => addTime(1)}
                                                    className="border border-[#d8ff3e]/40 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#d8ff3e] transition-colors hover:bg-[#d8ff3e] hover:text-black"
                                                >
                                                    +1h
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={logProof}
                                                    className="border border-[#2b2b25] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#aaa99d] transition-colors hover:border-[#d8ff3e]/50 hover:text-[#d8ff3e]"
                                                >
                                                    Log proof
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <Label>Kill criteria</Label>
                                            <ul className="mt-2 space-y-2">
                                                {selectedWork.killCriteria.map((criterion) => (
                                                    <li
                                                        key={criterion}
                                                        className="flex gap-2 text-sm leading-5 text-[#b5b3a7]"
                                                    >
                                                        <span className="mt-1 h-1 w-1 shrink-0 bg-[#ff6b3d]" />
                                                        {criterion}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="border-t border-[#24241f] pt-3">
                                            <Label>Primary metric</Label>
                                            <p className="mt-2 text-sm leading-6 text-[#d9d6ca]">
                                                {selectedWork.metric}
                                            </p>
                                        </div>
                                        <div className="border-t border-[#24241f] pt-3">
                                            <Label>Proof</Label>
                                            <p className="mt-2 text-sm leading-6 text-[#d9d6ca]">
                                                {selectedWork.proof}
                                            </p>
                                        </div>
                                        <label className="block border-t border-[#24241f] pt-3">
                                            <Label>Actual impact / target is 1.0x</Label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={5}
                                                step={0.1}
                                                value={selectedWork.actualImpact}
                                                onChange={(event) =>
                                                    updateSelected({
                                                        actualImpact: Math.max(
                                                            0,
                                                            Number(event.target.value) || 0
                                                        ),
                                                    })
                                                }
                                                className="mt-2 w-full border-0 bg-transparent p-0 font-mono text-2xl font-semibold text-[#f4f1e8] outline-none"
                                            />
                                        </label>
                                        <div className="flex items-center justify-between border-t border-[#24241f] pt-3">
                                            <Label>Optionality</Label>
                                            <span className="font-mono text-sm text-[#d8ff3e]">
                                                +{selectedWork.optionality} options
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 border-t border-[#2b2b25] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
                                    <div className="flex flex-wrap gap-2">
                                        {selectedWork.state === 'active' && (
                                            <button
                                                type="button"
                                                onClick={togglePause}
                                                className="border border-[#2b2b25] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#aaa99d] transition-colors hover:border-amber-400/50 hover:text-amber-300"
                                            >
                                                Pause
                                            </button>
                                        )}
                                        {(selectedWork.state === 'paused' ||
                                            selectedWork.state === 'blocked') && (
                                            <button
                                                type="button"
                                                onClick={togglePause}
                                                className="border border-[#2b2b25] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#aaa99d] transition-colors hover:border-[#d8ff3e]/50 hover:text-[#d8ff3e]"
                                            >
                                                Resume
                                            </button>
                                        )}
                                        {['active', 'paused', 'blocked'].includes(
                                            selectedWork.state
                                        ) && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={shipWork}
                                                    className="border border-emerald-400/40 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-300 transition-colors hover:bg-emerald-400 hover:text-black"
                                                >
                                                    Ship
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        updateSelected({ state: 'killed' })
                                                    }
                                                    className="border border-red-500/30 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-red-300 transition-colors hover:bg-red-500 hover:text-black"
                                                >
                                                    Kill
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={abandonWork}
                                                    className="border border-[#2b2b25] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#77776c] transition-colors hover:border-zinc-500/50 hover:text-zinc-300"
                                                >
                                                    Abandon
                                                </button>
                                            </>
                                        )}
                                        {['shipped', 'killed', 'abandoned'].includes(
                                            selectedWork.state
                                        ) && (
                                            <button
                                                type="button"
                                                onClick={() => updateSelected({ state: 'active' })}
                                                className="border border-[#2b2b25] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#aaa99d] transition-colors hover:border-[#d8ff3e]/50 hover:text-[#d8ff3e]"
                                            >
                                                Reopen
                                            </button>
                                        )}
                                    </div>
                                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#66665c]">
                                        {selectedWork.state === 'paused'
                                            ? 'Paused. The system will re-underwrite on return.'
                                            : 'Life happens. State changes are data, not failure.'}
                                    </p>
                                </div>
                            </motion.section>
                        ) : (
                            <section className="border border-dashed border-[#2b2b25] bg-[#080807] p-8 md:p-12">
                                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#77776c]">
                                    No protocol loaded
                                </p>
                                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-[#f4f1e8]">
                                    Start with one piece of work.
                                </h2>
                                <p className="mt-3 max-w-xl text-sm leading-6 text-[#99988c]">
                                    Compile the work above, or load the first work we actually
                                    need to build: Infinwork itself.
                                </p>
                                <button
                                    type="button"
                                    onClick={startFirstWork}
                                    className="mt-6 border border-[#d8ff3e]/50 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.16em] text-[#d8ff3e] transition-colors hover:bg-[#d8ff3e] hover:text-black"
                                >
                                    Load first work: Build the Workbench →
                                </button>
                            </section>
                        )}
                    </div>

                    <aside className="space-y-6">
                        <section className="border border-[#2b2b25] bg-[#0a0a08]">
                            <div className="flex items-center justify-between border-b border-[#2b2b25] p-4">
                                <div>
                                    <Label>Portfolio</Label>
                                    <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#66665c]">
                                        {totals.active} active · {totals.shipped} shipped
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={newWork}
                                    className="border border-[#2b2b25] px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8e8e80] transition-colors hover:border-[#d8ff3e]/50 hover:text-[#d8ff3e]"
                                >
                                    + New
                                </button>
                            </div>
                            <div className="max-h-[520px] space-y-2 overflow-y-auto p-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                {sortedWorks.length === 0 ? (
                                    <div className="p-4">
                                        <p className="text-sm leading-6 text-[#77776c]">
                                            No works compiled yet. The first one is the work in
                                            front of you.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={startFirstWork}
                                            className="mt-4 w-full border border-[#d8ff3e]/40 px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#d8ff3e] transition-colors hover:bg-[#d8ff3e] hover:text-black"
                                        >
                                            Load first work →
                                        </button>
                                    </div>
                                ) : (
                                    sortedWorks.map((work) => {
                                        const selected = work.id === selectedId;
                                        return (
                                            <button
                                                key={work.id}
                                                type="button"
                                                onClick={() => {
                                                    setCompiled(null);
                                                    setSelectedId(work.id);
                                                }}
                                                className={`w-full border p-3 text-left transition-colors ${
                                                    selected
                                                        ? 'border-[#d8ff3e]/60 bg-[#d8ff3e]/[0.06]'
                                                        : 'border-[#24241f] bg-[#080807] hover:border-[#3a3a31]'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="line-clamp-2 text-sm font-medium leading-5 text-[#e2dfd3]">
                                                        {work.title}
                                                    </span>
                                                    <StateBadge state={work.state} />
                                                </div>
                                                <div className="mt-3 grid grid-cols-3 gap-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[#77776c]">
                                                    <span>{formatHours(work.hoursInvested)}</span>
                                                    <span>{impactPerHour(work).toFixed(2)}/h</span>
                                                    <span>{work.proofs} proofs</span>
                                                </div>
                                                <div className="mt-2 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.1em] text-[#55554d]">
                                                    <span>{work.impactClass}</span>
                                                    <span>{impactMultiple(work).toFixed(2)}x impact</span>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                            {works.length > 0 && (
                                <div className="grid grid-cols-3 border-t border-[#2b2b25] p-3 text-center">
                                    <div>
                                        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#66665c]">
                                            works
                                        </p>
                                        <p className="mt-1 font-mono text-sm text-[#f4f1e8]">
                                            {totals.works}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#66665c]">
                                            proofs
                                        </p>
                                        <p className="mt-1 font-mono text-sm text-[#f4f1e8]">
                                            {totals.proofs}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#66665c]">
                                            hours
                                        </p>
                                        <p className="mt-1 font-mono text-sm text-[#f4f1e8]">
                                            {formatHours(totals.hours)}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className="border border-[#2b2b25] bg-[#0a0a08] p-4">
                            <Label>Operating rule</Label>
                            <p className="mt-3 text-sm leading-6 text-[#b5b3a7]">
                                The work defines the parameters. The system does not impose a
                                universal score. It compiles the instrument for the work in front
                                of you.
                            </p>
                            <div className="mt-4 space-y-2 border-t border-[#24241f] pt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[#66665c]">
                                <p>
                                    <span className="text-[#d8ff3e]">01</span> compile the work
                                </p>
                                <p>
                                    <span className="text-[#d8ff3e]">02</span> invest the time box
                                </p>
                                <p>
                                    <span className="text-[#d8ff3e]">03</span> log proof, not vibes
                                </p>
                                <p>
                                    <span className="text-[#d8ff3e]">04</span> compound what works
                                </p>
                            </div>
                        </section>

                        <p className="px-1 font-mono text-[9px] uppercase leading-4 tracking-[0.12em] text-[#55554d]">
                            Local prototype. Data stays in this browser. No account, no server,
                            no fake AI. Just the compiler.
                        </p>
                    </aside>
                </div>
            </main>
        </div>
    );
}
