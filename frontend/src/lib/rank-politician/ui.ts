export type ScrapeStatus = 'never' | 'success' | 'error' | 'partial';

export function scrapeStatusLabel(status?: string | null): string {
    switch (status) {
        case 'success':
            return 'Scraped';
        case 'error':
            return 'Scrape failed';
        case 'partial':
            return 'Partial';
        case 'never':
        default:
            return 'Not scraped';
    }
}

export function scrapeStatusClass(status?: string | null): string {
    switch (status) {
        case 'success':
            return 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10';
        case 'error':
            return 'border-red-500/30 text-red-400 bg-red-500/10';
        case 'partial':
            return 'border-amber-500/30 text-amber-400 bg-amber-500/10';
        case 'never':
        default:
            return 'border-white/10 text-zinc-400 bg-white/5';
    }
}

export function categoryLabel(category: string): string {
    const labels: Record<string, string> = {
        on_portfolio: 'On portfolio',
        related: 'Not portfolio',
        off_topic: 'Off topic',
        attack: 'Attack',
        personal: 'Personal',
        unknown: 'Unknown',
    };
    return labels[category] || category;
}

export function categoryClass(category: string): string {
    switch (category) {
        case 'on_portfolio':
            return 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10';
        case 'related':
            return 'border-sky-500/30 text-sky-300 bg-sky-500/10';
        case 'off_topic':
            return 'border-zinc-500/30 text-zinc-300 bg-zinc-500/10';
        case 'attack':
            return 'border-red-500/30 text-red-300 bg-red-500/10';
        case 'personal':
            return 'border-amber-500/30 text-amber-300 bg-amber-500/10';
        default:
            return 'border-white/10 text-zinc-400 bg-white/5';
    }
}

export function formatRelativeTime(value?: string | Date | null): string {
    if (!value) return 'Never';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';

    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 14) return `${days}d ago`;
    return date.toLocaleDateString();
}

/**
 * Public UI copy should stay vendor-neutral.
 * Implementation details (models, providers) live in the open-source code.
 */
export function publicScoreReason(reason?: string | null): string | null {
    if (!reason) return null;
    let text = reason.trim();
    text = text.replace(/^LLM\s*:\s*/i, '');
    text = text.replace(/^LLM failed,\s*/i, '');
    text = text.replace(/\b(bedrock|kimi(?:\s*k\.?\s*2\.5)?|litellm|openai|firecrawl)\b/gi, '');
    text = text.replace(/\s{2,}/g, ' ').trim();
    return text || null;
}

export function publicScrapeError(error?: string | null): string | null {
    if (!error) return null;
    const lower = error.toLowerCase();
    if (lower.includes('insufficient credits') || lower.includes('not enough credits')) {
        return 'Scraping temporarily paused. Please try again later.';
    }
    if (lower.includes('firecrawl') || lower.includes('credit guard')) {
        return 'Scraping failed. Please try again later.';
    }
    // Strip vendor names from any remaining message shown on-site.
    let text = error
        .replace(/\b(bedrock|kimi(?:\s*k\.?\s*2\.5)?|litellm|openai|firecrawl)\b/gi, 'service')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return text.slice(0, 220) || 'Scraping failed. Please try again later.';
}
