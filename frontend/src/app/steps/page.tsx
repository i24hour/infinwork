'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { compileStepPlan, type StepPlanKind } from '@/lib/steps/compile';

const STORAGE_KEY = 'infinwork.steps.v1';

interface StoredStep {
    id: string;
    text: string;
    done: boolean;
}

interface StoredPlan {
    id: string;
    source: string;
    target: string;
    kind: StepPlanKind;
    steps: StoredStep[];
    createdAt: number;
    updatedAt: number;
}

function newId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function planFromSource(source: string): StoredPlan {
    const compiled = compileStepPlan(source);
    const now = Date.now();
    return {
        id: newId(),
        source: compiled.source,
        target: compiled.target,
        kind: compiled.kind,
        steps: compiled.steps.map((text) => ({ id: newId(), text, done: false })),
        createdAt: now,
        updatedAt: now,
    };
}

export default function StepsPage() {
    const [source, setSource] = useState('');
    const [plans, setPlans] = useState<StoredPlan[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [hydrated, setHydrated] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as { plans?: StoredPlan[]; activeId?: string | null };
                if (Array.isArray(parsed.plans)) {
                    setPlans(parsed.plans);
                    setActiveId(parsed.activeId || parsed.plans[0]?.id || null);
                }
            }
        } catch {
            // A corrupt saved plan should not block a new one.
        } finally {
            setHydrated(true);
        }
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ plans, activeId }));
    }, [hydrated, plans, activeId]);

    const active = plans.find((plan) => plan.id === activeId) || null;
    const doneCount = active?.steps.filter((step) => step.done).length || 0;
    const total = active?.steps.length || 0;
    const current = active?.steps.find((step) => !step.done) || null;
    const complete = Boolean(active && total > 0 && doneCount === total);
    const progress = total ? Math.round((doneCount / total) * 100) : 0;

    const otherPlans = useMemo(
        () => plans.filter((plan) => plan.id !== activeId),
        [plans, activeId]
    );

    const updateActive = (patch: (plan: StoredPlan) => StoredPlan) => {
        if (!activeId) return;
        setPlans((currentPlans) =>
            currentPlans.map((plan) => (plan.id === activeId ? patch(plan) : plan))
        );
    };

    const makeSteps = () => {
        try {
            const plan = planFromSource(source);
            setPlans((currentPlans) => [plan, ...currentPlans].slice(0, 20));
            setActiveId(plan.id);
            setError(null);
            setSource('');
        } catch (compileError) {
            setError(compileError instanceof Error ? compileError.message : 'Could not make the steps.');
            inputRef.current?.focus();
        }
    };

    const toggleStep = (stepId: string) => {
        updateActive((plan) => ({
            ...plan,
            updatedAt: Date.now(),
            steps: plan.steps.map((step) => (step.id === stepId ? { ...step, done: !step.done } : step)),
        }));
    };

    const editStep = (stepId: string, text: string) => {
        updateActive((plan) => ({
            ...plan,
            updatedAt: Date.now(),
            steps: plan.steps.map((step) => (step.id === stepId ? { ...step, text } : step)),
        }));
    };

    const addStep = () => {
        updateActive((plan) => ({
            ...plan,
            updatedAt: Date.now(),
            steps: [...plan.steps, { id: newId(), text: 'New step', done: false }],
        }));
    };

    return (
        <div className="flex min-h-screen flex-col bg-black md:flex-row">
            <Sidebar />
            <main className="w-full flex-1 px-4 pb-28 pt-20 md:px-8 md:pb-8 md:pt-8">
                <div className="mx-auto max-w-3xl space-y-6">
                    <div>
                        <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">Step-by-step</h1>
                        <p className="text-zinc-400">
                            Tell the whole procedure, or the work you are going to do. The steps stay here until the target is complete.
                        </p>
                    </div>

                    <form
                        className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5"
                        onSubmit={(event) => {
                            event.preventDefault();
                            makeSteps();
                        }}
                    >
                        <label className="block text-sm font-medium text-white" htmlFor="step-source">
                            The work
                        </label>
                        <textarea
                            id="step-source"
                            ref={inputRef}
                            value={source}
                            onChange={(event) => setSource(event.target.value)}
                            rows={6}
                            placeholder="Example: First write the brief. Then design the screen. Finally ship it on the phone."
                            className="w-full resize-y rounded-xl border border-white/10 bg-black px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-zinc-600 focus:border-white/30"
                        />
                        {error ? <p className="text-sm text-red-400">{error}</p> : null}
                        <button
                            type="submit"
                            className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:opacity-90"
                        >
                            Make the steps
                        </button>
                    </form>

                    {active ? (
                        <section className="space-y-4 rounded-2xl border border-white/10 bg-black p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                                        {active.kind === 'procedure' ? 'From your procedure' : 'From the work'}
                                    </p>
                                    <h2 className="mt-1 text-xl font-semibold text-white">{active.target}</h2>
                                </div>
                                <p className="text-sm text-zinc-400">
                                    {doneCount} of {total}
                                </p>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                <div className="h-full bg-[#4CAF50]" style={{ width: `${progress}%` }} />
                            </div>

                            {complete ? (
                                <div className="rounded-xl border border-[#4CAF50]/30 bg-[#4CAF50]/10 px-4 py-4">
                                    <p className="text-lg font-semibold text-[#4CAF50]">Target complete</p>
                                    <p className="mt-1 text-sm text-zinc-300">Every step for this work is done.</p>
                                </div>
                            ) : current ? (
                                <div className="rounded-xl border border-white/15 bg-white/5 px-4 py-4">
                                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                                        Current step {active.steps.findIndex((step) => step.id === current.id) + 1}
                                    </p>
                                    <p className="mt-2 text-lg text-white">{current.text}</p>
                                    <button
                                        type="button"
                                        onClick={() => toggleStep(current.id)}
                                        className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
                                    >
                                        Mark this step done
                                    </button>
                                </div>
                            ) : null}

                            <ol className="space-y-2">
                                {active.steps.map((step, index) => (
                                    <li key={step.id} className="flex items-start gap-3 rounded-xl border border-white/10 px-3 py-3">
                                        <button
                                            type="button"
                                            aria-pressed={step.done}
                                            aria-label={step.done ? `Reopen step ${index + 1}` : `Mark step ${index + 1} done`}
                                            onClick={() => toggleStep(step.id)}
                                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                                                step.done
                                                    ? 'border-[#4CAF50] bg-[#4CAF50] text-black'
                                                    : 'border-white/20 text-zinc-500'
                                            }`}
                                        >
                                            {step.done ? '✓' : index + 1}
                                        </button>
                                        <input
                                            value={step.text}
                                            aria-label={`Step ${index + 1}`}
                                            onChange={(event) => editStep(step.id, event.target.value)}
                                            className={`w-full bg-transparent text-sm outline-none ${
                                                step.done ? 'text-zinc-500 line-through' : 'text-white'
                                            }`}
                                        />
                                    </li>
                                ))}
                            </ol>
                            <button
                                type="button"
                                onClick={addStep}
                                className="text-sm text-zinc-400 hover:text-white"
                            >
                                Add a step
                            </button>
                        </section>
                    ) : (
                        <p className="text-sm text-zinc-500">No steps yet. Describe the work above.</p>
                    )}

                    {otherPlans.length > 0 ? (
                        <section className="space-y-2">
                            <h2 className="text-sm font-medium text-zinc-400">Earlier work</h2>
                            {otherPlans.map((plan) => {
                                const finished = plan.steps.every((step) => step.done);
                                return (
                                    <button
                                        key={plan.id}
                                        type="button"
                                        onClick={() => setActiveId(plan.id)}
                                        className="flex w-full items-center justify-between rounded-xl border border-white/10 px-4 py-3 text-left hover:bg-white/5"
                                    >
                                        <span className="text-sm text-white">{plan.target}</span>
                                        <span className="text-xs text-zinc-500">{finished ? 'Complete' : 'In progress'}</span>
                                    </button>
                                );
                            })}
                        </section>
                    ) : null}
                </div>
            </main>
        </div>
    );
}
