'use client';

/**
 * Lightweight, zero-dependency SWR-style client cache for instant SPA navigation.
 *
 * - Keeps an in-memory Map for 0ms synchronous reads on client-side route transitions.
 * - Mirrors JSON-serializable payloads into sessionStorage so reloads are also hydrated immediately.
 * - Deduplicates concurrent in-flight GET requests to the same key.
 * - Supports pre-warming (`prefetchJson`) on link hover/focus and optimistic updates (`setCachedData`).
 */

interface CacheEntry<T = unknown> {
    data: T;
    updatedAt: number;
}

const STORAGE_PREFIX = 'infinwork:swr:v1:';
const memoryCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const subscribers = new Map<string, Set<(data: unknown) => void>>();

function readPersistentStorage<T>(key: string): CacheEntry<T> | null {
    if (typeof window === 'undefined') return null;
    const storageKey = STORAGE_PREFIX + key;
    for (const storage of [window.sessionStorage, window.localStorage]) {
        try {
            const raw = storage.getItem(storageKey);
            if (!raw) continue;
            const parsed = JSON.parse(raw) as CacheEntry<T>;
            if (parsed && typeof parsed === 'object' && typeof parsed.updatedAt === 'number') {
                return parsed;
            }
        } catch {
            // Ignore storage read/parse errors
        }
    }
    return null;
}

function writePersistentStorage<T>(key: string, entry: CacheEntry<T>): void {
    if (typeof window === 'undefined') return;
    const storageKey = STORAGE_PREFIX + key;
    let serialized: string | null = null;
    try {
        serialized = JSON.stringify(entry);
    } catch {
        return;
    }
    try {
        window.sessionStorage.setItem(storageKey, serialized);
    } catch {
        // Ignore quota errors
    }
    try {
        window.localStorage.setItem(storageKey, serialized);
    } catch {
        // Ignore quota errors
    }
}

function notifySubscribers<T>(key: string, data: T): void {
    const subs = subscribers.get(key);
    if (!subs) return;
    for (const listener of subs) {
        try {
            listener(data);
        } catch {
            // Ignore listener errors
        }
    }
}

/**
 * Synchronously reads cached data if available (memory first, then sessionStorage).
 */
export function getCachedData<T>(key: string, maxAgeMs?: number): T | undefined {
    let entry = memoryCache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
        const stored = readPersistentStorage<T>(key);
        if (stored) {
            memoryCache.set(key, stored);
            entry = stored;
        }
    }
    if (!entry) return undefined;
    if (typeof maxAgeMs === 'number' && Date.now() - entry.updatedAt > maxAgeMs) {
        return undefined;
    }
    return entry.data;
}

/**
 * Synchronously updates the cache and notifies any mounted subscribers for `key`.
 */
export function setCachedData<T>(
    key: string,
    updater: T | ((prev: T | undefined) => T)
): T {
    const prev = getCachedData<T>(key);
    const next = typeof updater === 'function'
        ? (updater as (prev: T | undefined) => T)(prev)
        : updater;
    const entry: CacheEntry<T> = {
        data: next,
        updatedAt: Date.now(),
    };
    memoryCache.set(key, entry);
    writePersistentStorage(key, entry);
    notifySubscribers(key, next);
    return next;
}

/**
 * Invalidates a specific cache key (or all keys matching a prefix).
 */
export function invalidateCache(keyOrPrefix: string, exact: boolean = false): void {
    for (const key of Array.from(memoryCache.keys())) {
        if (exact ? key === keyOrPrefix : key.startsWith(keyOrPrefix)) {
            memoryCache.delete(key);
        }
    }
    if (typeof window !== 'undefined') {
        const fullPrefix = STORAGE_PREFIX + keyOrPrefix;
        for (const storage of [window.sessionStorage, window.localStorage]) {
            try {
                for (let i = storage.length - 1; i >= 0; i--) {
                    const storageKey = storage.key(i);
                    if (!storageKey) continue;
                    if (exact ? storageKey === fullPrefix : storageKey.startsWith(fullPrefix)) {
                        storage.removeItem(storageKey);
                    }
                }
            } catch {
                // Ignore storage errors
            }
        }
    }
}

/**
 * Subscribe to updates on a cache key. Returns an unsubscribe function.
 */
export function subscribeCache<T>(key: string, listener: (data: T) => void): () => void {
    let set = subscribers.get(key);
    if (!set) {
        set = new Set();
        subscribers.set(key, set);
    }
    const wrapped = listener as (data: unknown) => void;
    set.add(wrapped);
    return () => {
        set?.delete(wrapped);
        if (set && set.size === 0) {
            subscribers.delete(key);
        }
    };
}

export interface FetchJsonOptions {
    /**
     * If cached data is fresher than `dedupingIntervalMs`, return the cached value
     * without firing a new network request unless `force` is true.
     * Defaults to 2000ms.
     */
    dedupingIntervalMs?: number;
    force?: boolean;
}

/**
 * Fetches JSON from `url`, deduplicating concurrent in-flight requests and caching the result.
 */
export async function fetchWithCache<T = unknown>(
    url: string,
    options: FetchJsonOptions = {}
): Promise<T> {
    const { dedupingIntervalMs = 2000, force = false } = options;

    if (!force && dedupingIntervalMs > 0) {
        const fresh = getCachedData<T>(url, dedupingIntervalMs);
        if (fresh !== undefined) {
            return fresh;
        }
    }

    const existingPromise = inFlightRequests.get(url) as Promise<T> | undefined;
    if (existingPromise) {
        return existingPromise;
    }

    const requestPromise = (async () => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errPayload = await response.json().catch(() => ({}));
                const message = (errPayload && typeof errPayload === 'object' && 'error' in errPayload && typeof errPayload.error === 'string')
                    ? errPayload.error
                    : `Request failed with status ${response.status}`;
                throw new Error(message);
            }
            const data = (await response.json()) as T;
            setCachedData(url, data);
            return data;
        } finally {
            inFlightRequests.delete(url);
        }
    })();

    inFlightRequests.set(url, requestPromise);
    return requestPromise;
}

/**
 * Pre-warms the cache for `url` in the background if not already fresh.
 * Never throws.
 */
export function prefetchJson(url: string, freshTtlMs: number = 15000): void {
    if (typeof window === 'undefined') return;
    if (getCachedData(url, freshTtlMs) !== undefined) return;
    if (inFlightRequests.has(url)) return;

    fetchWithCache(url, { dedupingIntervalMs: freshTtlMs }).catch(() => {
        // Ignore background prefetch errors
    });
}

/**
 * Synchronously reads whether the document is currently in light theme mode.
 * Avoids the dark-to-light flash when mounting pages or the Sidebar on navigation.
 */
export function getInitialIsLightTheme(): boolean {
    if (typeof document !== 'undefined') {
        if (document.documentElement.getAttribute('data-theme') === 'light') {
            return true;
        }
    }
    if (typeof window !== 'undefined') {
        try {
            return window.localStorage.getItem('app-theme') === 'light';
        } catch {
            return false;
        }
    }
    return false;
}
