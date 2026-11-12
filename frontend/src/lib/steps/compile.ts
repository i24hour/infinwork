export type StepPlanKind = 'procedure' | 'work';

export interface StepPlan {
    target: string;
    source: string;
    kind: StepPlanKind;
    steps: string[];
}

const LEAD_IN =
    /^(?:i am going to|i'm going to|i’m going to|i will|we will|we are going to|we're going to|the goal is(?: to)?|the work is(?: to)?|i need to|i want to|i plan to|today i will)\s+/i;

const LIST_MARKER = /^(?:step\s*\d+\s*[:.)-]?|\d+\s*[.)]\s*|[-*•]\s+)/i;
const SEQUENCE_WORD =
    /^(?:first|second|third|fourth|fifth|next|then|after that|finally|lastly|last)\b[:,]?\s+/i;
const FINISH_WORD = /\b(done|complete|completed|ship|shipped|finish|finished|check|verify|publish|published|send|sent)\b/i;

function cleanStep(raw: string): string {
    let text = raw.replace(/\s+/g, ' ').trim();
    for (let pass = 0; pass < 3; pass += 1) {
        const next = text
            .replace(LEAD_IN, '')
            .replace(LIST_MARKER, '')
            .replace(SEQUENCE_WORD, '')
            .replace(/^[,:;\-–—]+\s*/, '')
            .trim();
        if (next === text) break;
        text = next;
    }
    text = text.replace(/[.,;]+$/, '').trim();
    if (text.length < 2) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function uniqueSteps(steps: string[]): string[] {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const step of steps) {
        const key = step.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(step);
    }
    return kept.slice(0, 12);
}

function isListLine(line: string): boolean {
    return LIST_MARKER.test(line.trim());
}

function procedureParts(source: string): string[] {
    const lines = source
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const parts: string[] = [];

    for (const line of lines) {
        const numbered = line
            .split(/(?=(?:^|\s)\d+\s*[.)]\s+)/)
            .map((part) => part.trim())
            .filter(Boolean);
        const chunks = numbered.length > 1 ? numbered : [line];
        for (const chunk of chunks) {
            const sequenced = chunk.split(
                /\s*(?:;|\.\s+(?=(?:first|second|third|fourth|fifth|next|then|after that|finally|lastly|last)\b)|\b(?:and then|then)\b)\s*/i
            );
            for (const piece of sequenced) {
                const sentences = piece
                    .split(/(?<=[.!?])\s+/)
                    .map((sentence) => sentence.trim())
                    .filter(Boolean);
                const bits = sentences.length > 1 ? sentences : [piece];
                for (const bit of bits) {
                    const step = cleanStep(bit);
                    if (step) parts.push(step);
                }
            }
        }
    }

    return uniqueSteps(parts);
}

function shortGoal(goal: string): string {
    const clean = goal.replace(/\s+/g, ' ').trim();
    if (clean.length <= 80) return clean;
    return `${clean.slice(0, 77).trimEnd()}…`;
}

function middleSteps(goal: string, label: string): string[] {
    const text = goal.toLowerCase();
    if (/\b(write|draft|essay|post|article|newsletter|thread|story)\b/.test(text)) {
        return [
            `Write the one sentence "${label}" has to land.`,
            'Draft the whole thing in one pass.',
            'Revise until that sentence is obvious to a reader.',
        ];
    }
    if (/\b(build|make|create|ship|design|implement|develop|launch|app|feature|page|widget)\b/.test(text)) {
        return [
            `Sketch the smallest version of "${label}" a person can use.`,
            'Build that version until it works once from start to finish.',
            'Use it yourself and fix the break that blocks the target.',
        ];
    }
    if (/\b(learn|study|research|understand|decide|evaluate)\b/.test(text)) {
        return [
            `Write the question "${label}" has to answer.`,
            'Read the few sources that can change the answer.',
            'Write the decision in a few sentences.',
        ];
    }
    if (/\b(fix|debug|repair|solve|harden)\b/.test(text)) {
        return [
            `Reproduce the failure behind "${label}".`,
            'Change the one thing that causes it.',
            'Run the same check and confirm the failure is gone.',
        ];
    }
    return [
        `List what you need before you start "${label}".`,
        `Do the first concrete piece of "${label}".`,
        'Keep going until the finish line is met.',
    ];
}

function stepsForWork(goal: string): string[] {
    const label = shortGoal(goal);
    return [
        `Say the target out loud: ${label}.`,
        `Write the finish line: what is true when "${label}" is done.`,
        ...middleSteps(goal, label),
        `Compare what you made with the finish line for "${label}".`,
        'Mark the target complete.',
    ];
}

function procedureTarget(steps: string[]): string {
    if (steps.length === 0) return 'The work';
    if (steps.length === 1) return steps[0];
    return `${steps[0]} → ${steps[steps.length - 1]}`;
}

function withFinish(target: string, steps: string[]): string[] {
    const last = steps[steps.length - 1] || '';
    if (FINISH_WORD.test(last)) return steps;
    return uniqueSteps([
        ...steps,
        `Check the result against "${shortGoal(target)}" and mark the target complete.`,
    ]);
}

export function compileStepPlan(source: string): StepPlan {
    const original = source.replace(/\r\n/g, '\n').trim();
    if (original.length < 3) {
        throw new Error('Tell the procedure or the work first.');
    }

    const lines = original
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    let heading = '';
    let body = original;
    if (lines.length >= 2 && !isListLine(lines[0]) && lines.slice(1).some(isListLine)) {
        heading = cleanStep(lines[0].replace(LEAD_IN, ''));
        body = lines.slice(1).join('\n');
    }

    const extracted = procedureParts(body);
    if (extracted.length >= 2) {
        const meaningful = extracted.filter((step) => !step.startsWith('Check the result against'));
        const target = heading || procedureTarget(meaningful);
        return {
            target,
            source: original,
            kind: 'procedure',
            steps: withFinish(target, extracted),
        };
    }

    const goal = cleanStep((heading || original).replace(LEAD_IN, ''));
    return {
        target: goal,
        source: original,
        kind: 'work',
        steps: stepsForWork(goal),
    };
}
