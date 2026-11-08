export type WorkState = 'active' | 'paused' | 'blocked' | 'shipped' | 'killed' | 'abandoned';

export type WorkImpactClass =
    | 'Product'
    | 'Distribution'
    | 'Learning'
    | 'Leverage'
    | 'Quality'
    | 'Relationship'
    | 'Outcome'
    | 'Category';

export interface Work {
    id: string;
    title: string;
    impact: string;
    metric: string;
    proof: string;
    timeBudgetHours: number;
    killCriteria: string[];
    nextMove: string;
    impactClass: WorkImpactClass;
    expectedImpact: number;
    actualImpact: number;
    hoursInvested: number;
    proofs: number;
    optionality: number;
    state: WorkState;
    createdAt: number;
    updatedAt: number;
}

export type TimePreset = 'auto' | '2h' | '4h' | '8h' | '1d' | '3d';

interface WorkTemplate {
    impactClass: WorkImpactClass;
    impact: (title: string) => string;
    metric: string;
    proof: string;
    defaultHours: number;
    killCriteria: string[];
    nextMove: string;
    optionality: number;
}

const PRESET_HOURS: Record<Exclude<TimePreset, 'auto'>, number> = {
    '2h': 2,
    '4h': 4,
    '8h': 8,
    '1d': 24,
    '3d': 72,
};

function looksLike(title: string, pattern: RegExp): boolean {
    return pattern.test(title.toLowerCase());
}

function templateFor(title: string): WorkTemplate {
    if (looksLike(title, /workbench|work compiler|compiler for work/)) {
        return {
            impactClass: 'Category',
            impact: () =>
                'A person can describe any work and get a measurable protocol in under 10 seconds.',
            metric: 'Time from raw intent to an approved protocol.',
            proof: 'A working Workbench that compiles one real work.',
            defaultHours: 8,
            killCriteria: [
                'It feels like another task manager.',
                'It produces vague advice instead of measurable parameters.',
                'It takes more than 3 edits to make the protocol useful.',
            ],
            nextMove: 'Build the compiler input and protocol sheet.',
            optionality: 3,
        };
    }

    if (looksLike(title, /\b(write|essay|post|article|thread|content|publish|newsletter|story)\b/)) {
        return {
            impactClass: 'Distribution',
            impact: (work) => `"${work}" reaches the right people and changes how they think or act.`,
            metric: 'One published piece + one meaningful response or reach signal.',
            proof: 'A published URL + one response, quote, or reach metric.',
            defaultHours: 3,
            killCriteria: [
                'No draft in the first half of the time box.',
                'No clear audience.',
                'The piece is only interesting to you.',
            ],
            nextMove: 'Write the one-sentence thesis and the opening before anything else.',
            optionality: 2,
        };
    }

    if (looksLike(title, /\b(learn|study|research|understand|decide|evaluate|explore|investigate)\b/)) {
        return {
            impactClass: 'Learning',
            impact: (work) => `"${work}" produces decision-quality understanding of the problem.`,
            metric: 'One decision memo + one changed decision.',
            proof: 'A one-page decision memo with sources and a recommendation.',
            defaultHours: 4,
            killCriteria: [
                'No decision changes.',
                'Sources are collected but never read.',
                'The memo becomes a summary instead of a recommendation.',
            ],
            nextMove: 'Write the decision question and the three sources that could change it.',
            optionality: 3,
        };
    }

    if (looksLike(title, /\b(automate|script|pipeline|scrape|cron|bot|workflow|integrate|system)\b/)) {
        return {
            impactClass: 'Leverage',
            impact: (work) => `"${work}" returns more time than it costs to build and maintain.`,
            metric: 'Hours returned per week and payback period.',
            proof: 'A running automation with a measured time dividend.',
            defaultHours: 6,
            killCriteria: [
                'Payback is longer than 30 days.',
                'Maintenance cost is higher than the dividend.',
                'It requires daily manual intervention.',
            ],
            nextMove: 'Measure the manual baseline and the automated time for one run.',
            optionality: 2,
        };
    }

    if (looksLike(title, /\b(fix|refactor|improve|optimize|clean|reduce|remove|harden|stabilize)\b/)) {
        return {
            impactClass: 'Quality',
            impact: (work) => `"${work}" removes a recurring failure or friction point.`,
            metric: 'Error or friction reduced, proven with a before/after.',
            proof: 'Before/after evidence and a regression check.',
            defaultHours: 4,
            killCriteria: [
                'No before/after measurement.',
                'The fix creates more complexity than it removes.',
                'No regression proof.',
            ],
            nextMove: 'Capture the before state and the exact failure being removed.',
            optionality: 1,
        };
    }

    if (looksLike(title, /\b(hire|talk|meet|intro|reach|outreach|sell|client|partner|relationship|email)\b/)) {
        return {
            impactClass: 'Relationship',
            impact: (work) => `"${work}" creates a relationship or commitment that compounds.`,
            metric: 'One committed next step with the other person.',
            proof: 'A written recap and a concrete next commitment.',
            defaultHours: 2,
            killCriteria: [
                'No response after one follow-up.',
                'No concrete next step.',
                'The relationship is one-sided.',
            ],
            nextMove: 'Send the one message that creates a concrete next step.',
            optionality: 2,
        };
    }

    if (looksLike(title, /\b(build|ship|create|implement|launch|make|design|develop|feature|product|app)\b/)) {
        return {
            impactClass: 'Product',
            impact: (work) => `"${work}" becomes a working artifact that creates a measurable change.`,
            metric: 'One working artifact + one user-visible outcome.',
            proof: 'A link, screenshot, or recording of the working artifact.',
            defaultHours: 8,
            killCriteria: [
                'No working proof inside the time box.',
                'The proof requires more than one new dependency.',
                'No user-visible change.',
            ],
            nextMove: 'Define the smallest user-visible proof and build that first.',
            optionality: 2,
        };
    }

    return {
        impactClass: 'Outcome',
        impact: (work) => `"${work}" produces one measurable change in the world.`,
        metric: 'One measurable result against the intended change.',
        proof: 'A verifiable artifact or number.',
        defaultHours: 4,
        killCriteria: [
            'No measurable change.',
            'The proof is a feeling.',
            'The time box ends without an artifact.',
        ],
        nextMove: 'Write the measurable success condition, then take the first step.',
        optionality: 1,
    };
}

function newId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function compileWork(title: string, preset: TimePreset = 'auto'): Work {
    const cleanTitle = title.trim().replace(/\s+/g, ' ');
    if (!cleanTitle) {
        throw new Error('Write the work first.');
    }

    const template = templateFor(cleanTitle);
    const now = Date.now();
    return {
        id: newId(),
        title: cleanTitle,
        impact: template.impact(cleanTitle),
        metric: template.metric,
        proof: template.proof,
        timeBudgetHours: preset === 'auto' ? template.defaultHours : PRESET_HOURS[preset],
        killCriteria: template.killCriteria,
        nextMove: template.nextMove,
        impactClass: template.impactClass,
        expectedImpact: 1,
        actualImpact: 0,
        hoursInvested: 0,
        proofs: 0,
        optionality: template.optionality,
        state: 'active',
        createdAt: now,
        updatedAt: now,
    };
}

export function impactMultiple(work: Work): number {
    if (!work.expectedImpact) return 0;
    return Math.round((work.actualImpact / work.expectedImpact) * 100) / 100;
}

export function impactPerHour(work: Work): number {
    if (!work.hoursInvested) return 0;
    return Math.round((work.actualImpact / work.hoursInvested) * 100) / 100;
}

export function formatHours(hours: number): string {
    const whole = Math.floor(hours);
    const minutes = Math.round((hours - whole) * 60);
    if (minutes === 0) return `${whole}h`;
    return `${whole}h ${minutes}m`;
}

export function stateLabel(state: WorkState): string {
    switch (state) {
        case 'active':
            return 'Active';
        case 'paused':
            return 'Paused';
        case 'blocked':
            return 'Blocked';
        case 'shipped':
            return 'Shipped';
        case 'killed':
            return 'Killed';
        case 'abandoned':
            return 'Abandoned';
    }
}
