const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

export function isValidObjectIdString(value: unknown): value is string {
    return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** Reject MongoDB operator injection via keys like `$set` or `a.b`. */
export function hasDangerousKeys(value: unknown): boolean {
    if (!isPlainObject(value)) return false;
    return Object.keys(value).some((key) => key.startsWith('$') || key.includes('.'));
}

export async function readJsonBody<T>(request: Request): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
    try {
        const body = (await request.json()) as T;
        return { ok: true, body };
    } catch {
        return { ok: false, error: 'Invalid JSON body' };
    }
}

// ---------------------------------------------------------------------------
// iTime task input validation
// ---------------------------------------------------------------------------

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CANCEL_REASON_LENGTH = 500;
const MAX_MILESTONE_TEXT_LENGTH = 500;
const MAX_MILESTONES = 200;
const MAX_EVENTS = 5000;
const MAX_ELAPSED_SECONDS = 10 * 366 * 24 * 3600; // ~10 years
const MAX_TIMESTAMP_SKEW_MS = 60 * 1000; // tolerate 60s of client clock skew

const EVENT_TYPES = new Set(['start', 'pause', 'complete']);

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidTimestamp(value: unknown, now: number): value is number {
    return (
        isFiniteNonNegativeNumber(value) &&
        value <= now + MAX_TIMESTAMP_SKEW_MS
    );
}

export interface SanitizedItimeEvent {
    type: 'start' | 'pause' | 'complete';
    timestamp: number;
}

export interface SanitizedMilestone {
    text: string;
    timestamp: number;
}

export interface SanitizedItimeTaskInput {
    title?: string;
    description?: string;
    startTime?: number;
    pausedElapsed?: number;
    enabled?: boolean;
    completed?: boolean;
    completedAt?: number;
    cancelledAt?: number;
    cancelReason?: string;
    milestones?: SanitizedMilestone[];
    events?: SanitizedItimeEvent[];
    targetTime?: number;
    autoResumeAt?: number;
    isPublic?: boolean;
}

interface SanitizeResult {
    ok: true;
    value: SanitizedItimeTaskInput;
}

interface SanitizeFailure {
    ok: false;
    error: string;
}

/**
 * Whitelist + validate client-supplied iTime task fields. Only the returned
 * fields may be written to MongoDB. Unknown keys are dropped; forbidden keys
 * (`userId`, operator keys) are rejected so ownership can never transfer and
 * Mongo operators can never be injected through spread updates.
 */
export function sanitizeItimeTaskInput(
    body: unknown,
    options: { requireTitle: boolean }
): SanitizeResult | SanitizeFailure {
    if (!isPlainObject(body)) {
        return { ok: false, error: 'Invalid task payload' };
    }
    if (hasDangerousKeys(body)) {
        return { ok: false, error: 'Invalid task payload' };
    }
    if ('userId' in body) {
        return { ok: false, error: 'userId cannot be set by the client' };
    }

    const now = Date.now();
    const value: SanitizedItimeTaskInput = {};

    if ('title' in body || options.requireTitle) {
        if (typeof body.title !== 'string' || body.title.trim().length === 0) {
            return { ok: false, error: 'Title is required' };
        }
        if (body.title.trim().length > MAX_TITLE_LENGTH) {
            return { ok: false, error: `Title must be at most ${MAX_TITLE_LENGTH} characters` };
        }
        value.title = body.title.trim();
    }

    if ('description' in body && body.description !== undefined) {
        if (typeof body.description !== 'string') {
            return { ok: false, error: 'Description must be a string' };
        }
        if (body.description.length > MAX_DESCRIPTION_LENGTH) {
            return { ok: false, error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters` };
        }
        value.description = body.description;
    }

    const timestampFields: Array<'startTime' | 'completedAt' | 'cancelledAt' | 'autoResumeAt'> = [
        'startTime',
        'completedAt',
        'cancelledAt',
        'autoResumeAt',
    ];
    for (const field of timestampFields) {
        if (field in body && body[field] !== undefined) {
            const raw = body[field];
            if (!isValidTimestamp(raw, now)) {
                return { ok: false, error: `${field} must be a valid timestamp` };
            }
            value[field] = raw;
        }
    }

    // Durations in seconds (not epoch timestamps).
    const durationFields: Array<'pausedElapsed' | 'targetTime'> = ['pausedElapsed', 'targetTime'];
    for (const field of durationFields) {
        if (field in body && body[field] !== undefined) {
            const raw = body[field];
            if (!isFiniteNonNegativeNumber(raw) || raw > MAX_ELAPSED_SECONDS) {
                return { ok: false, error: `${field} is out of range` };
            }
            value[field] = raw;
        }
    }

    const booleanFields: Array<'enabled' | 'completed' | 'isPublic'> = ['enabled', 'completed', 'isPublic'];
    for (const field of booleanFields) {
        if (field in body && body[field] !== undefined) {
            if (typeof body[field] !== 'boolean') {
                return { ok: false, error: `${field} must be a boolean` };
            }
            value[field] = body[field];
        }
    }

    if ('cancelReason' in body && body.cancelReason !== undefined) {
        if (typeof body.cancelReason !== 'string') {
            return { ok: false, error: 'cancelReason must be a string' };
        }
        if (body.cancelReason.length > MAX_CANCEL_REASON_LENGTH) {
            return { ok: false, error: `cancelReason must be at most ${MAX_CANCEL_REASON_LENGTH} characters` };
        }
        value.cancelReason = body.cancelReason;
    }

    if ('events' in body && body.events !== undefined) {
        if (!Array.isArray(body.events)) {
            return { ok: false, error: 'events must be an array' };
        }
        if (body.events.length > MAX_EVENTS) {
            return { ok: false, error: `events must contain at most ${MAX_EVENTS} entries` };
        }
        const events: SanitizedItimeEvent[] = [];
        for (const event of body.events) {
            if (!isPlainObject(event) || hasDangerousKeys(event)) {
                return { ok: false, error: 'Invalid event entry' };
            }
            if (!EVENT_TYPES.has(event.type as string)) {
                return { ok: false, error: 'Invalid event type' };
            }
            if (!isValidTimestamp(event.timestamp, now)) {
                return { ok: false, error: 'Invalid event timestamp' };
            }
            events.push({
                type: event.type as SanitizedItimeEvent['type'],
                timestamp: event.timestamp as number,
            });
        }
        value.events = events;
    }

    if ('milestones' in body && body.milestones !== undefined) {
        if (!Array.isArray(body.milestones)) {
            return { ok: false, error: 'milestones must be an array' };
        }
        if (body.milestones.length > MAX_MILESTONES) {
            return { ok: false, error: `milestones must contain at most ${MAX_MILESTONES} entries` };
        }
        const milestones: SanitizedMilestone[] = [];
        for (const milestone of body.milestones) {
            if (!isPlainObject(milestone) || hasDangerousKeys(milestone)) {
                return { ok: false, error: 'Invalid milestone entry' };
            }
            if (typeof milestone.text !== 'string' || milestone.text.trim().length === 0) {
                return { ok: false, error: 'Milestone text is required' };
            }
            if (milestone.text.length > MAX_MILESTONE_TEXT_LENGTH) {
                return { ok: false, error: `Milestone text must be at most ${MAX_MILESTONE_TEXT_LENGTH} characters` };
            }
            const timestamp = milestone.timestamp ?? milestone.createdAt ?? now;
            if (!isValidTimestamp(timestamp, now)) {
                return { ok: false, error: 'Invalid milestone timestamp' };
            }
            milestones.push({ text: milestone.text.trim(), timestamp });
        }
        value.milestones = milestones;
    }

    return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Image + URL guards
// ---------------------------------------------------------------------------

export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

export function normalizeImageDataUrl(
    image: unknown,
    maxBytes: number = MAX_PROFILE_IMAGE_BYTES
): { image?: string; error?: string } {
    if (image == null || image === '') {
        return {};
    }
    if (typeof image !== 'string') {
        return { error: 'Invalid image payload' };
    }
    const normalized = image.trim();
    if (!ALLOWED_IMAGE_DATA_URL.test(normalized)) {
        return { error: 'Only PNG, JPG, WEBP, and GIF images are supported' };
    }
    const base64Payload = normalized.split(',')[1] ?? '';
    if (Buffer.byteLength(base64Payload, 'base64') > maxBytes) {
        return { error: 'Image too large (max 2MB)' };
    }
    return { image: normalized };
}

/** Allow only https:// links so `javascript:` / `data:` URLs can never be stored and rendered. */
export function isAllowedExternalLink(link: unknown): boolean {
    if (link == null || link === '') return true;
    if (typeof link !== 'string') return false;
    try {
        const parsed = new URL(link.trim());
        return parsed.protocol === 'https:';
    } catch {
        return false;
    }
}
