const DEV_ONLY_SECRET = 'dev-only-nextauth-secret-do-not-use-in-production';

/**
 * Resolve the NextAuth session secret.
 *
 * Production refuses to boot without NEXTAUTH_SECRET so sessions can never be
 * signed with a publicly known fallback string. Local dev falls back to a
 * clearly-labeled dev-only secret.
 */
export function resolveAuthSecret(): string {
    const configured = process.env.NEXTAUTH_SECRET;
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('NEXTAUTH_SECRET is not set. Refusing to start without a session secret in production.');
    }
    return DEV_ONLY_SECRET;
}

/**
 * The demo Credentials provider accepts any email+password with no password
 * check, so it must never be registered in production. Enable explicitly for
 * local development only.
 */
export function isDemoCredentialsEnabled(): boolean {
    return process.env.ALLOW_DEMO_CREDENTIALS === 'true';
}
