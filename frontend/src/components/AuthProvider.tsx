'use client';

import { SessionProvider, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { clearAllCache } from '@/lib/client-cache';

const LAST_EMAIL_KEY = 'infinwork:last-session-email';

/**
 * Drops every cached API response when the signed-in account changes (or the
 * user signs out). Prevents one account's private tasks/settings/ideas from
 * hydrating the next account's first paint on a shared browser.
 */
function CacheSessionGuard() {
    const { data: session, status } = useSession();

    useEffect(() => {
        if (status === 'loading') return;

        const email = session?.user?.email || '';
        try {
            const previousEmail = window.sessionStorage.getItem(LAST_EMAIL_KEY) || '';
            if (previousEmail !== email) {
                clearAllCache();
                if (email) {
                    window.sessionStorage.setItem(LAST_EMAIL_KEY, email);
                } else {
                    window.sessionStorage.removeItem(LAST_EMAIL_KEY);
                }
            }
        } catch {
            // sessionStorage may be unavailable; nothing to scope.
        }
    }, [session?.user?.email, status]);

    return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider refetchOnWindowFocus={false}>
            <CacheSessionGuard />
            {children}
        </SessionProvider>
    );
}
