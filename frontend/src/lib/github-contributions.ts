import type { GithubContributionCalendar, ContributionDay, GithubContributionWeek } from '@/types/github-contributions';

const CALENDAR_QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

const CALENDAR_CACHE_TTL_MS = 60 * 60 * 1000;
const calendarCache = new Map<string, { data: GithubContributionCalendar; expiresAt: number }>();

export function hasGithubCalendarToken(accessToken?: string | null): boolean {
    return Boolean(process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || accessToken);
}

export async function fetchGithubContributionCalendar(
    username: string,
    accessToken?: string | null
): Promise<GithubContributionCalendar | null> {
    const cacheKey = username.toLowerCase();
    const cached = calendarCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    // GitHub GraphQL requires authentication even for public calendars. Prefer
    // the deployment token, then fall back to the profile owner's OAuth token.
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || accessToken;
    if (!token) {
        return null;
    }
    headers.Authorization = `Bearer ${token}`;

    try {
        const res = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query: CALENDAR_QUERY,
                variables: { login: username },
            }),
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            console.error('GitHub calendar fetch failed:', res.status);
            return null;
        }

        const json = await res.json();
        if (json.errors?.length) {
            console.error('GitHub calendar GraphQL errors:', json.errors);
            return null;
        }

        const calendar = json.data?.user?.contributionsCollection?.contributionCalendar;
        if (!calendar) return null;

        const weeks: GithubContributionWeek[] = (Array.isArray(calendar.weeks) ? calendar.weeks : [])
            .map((week: { contributionDays?: Array<{ date?: string; contributionCount?: number }> }) => ({
                days: (Array.isArray(week?.contributionDays) ? week.contributionDays : [])
                    .filter((day) => day?.date)
                    .map((day) => ({
                        date: day.date as string,
                        count: Math.max(0, Number(day.contributionCount || 0)),
                    })),
            }));

        const data = {
            totalContributions: Math.max(0, Number(calendar.totalContributions || 0)),
            weeks,
        };

        calendarCache.set(cacheKey, {
            data,
            expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS,
        });
        return data;
    } catch (error) {
        console.error('Error fetching GitHub contribution calendar:', error);
        return null;
    }
}

export function getContributionLevel(count: number): 0 | 1 | 2 | 3 | 4 {
    if (count <= 0) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 9) return 3;
    return 4;
}

export function flattenCalendarDays(weeks: GithubContributionWeek[]): ContributionDay[] {
    return weeks.flatMap((week) => week.days);
}
