const DEV_ONLY_SECRET = 'dev-only-nextauth-secret-do-not-use-in-production';

/**
 * Resolve the NextAuth session secret.
 *
 * Production refuses to boot without NEXTAUTH_SECRET so sessions can never be
 * signed with a publicly known fallback string. Local dev falls back to a
 * clearly-labeled dev-only secret.
 */
export function resolveAuthSecret(): string {
    const configured = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production') {
        // `next build` evaluates route modules before runtime env is available
        // on some hosts. Allow the build to finish, but still refuse to serve
        // with an insecure secret at runtime.
        if (process.env.NEXT_PHASE === 'phase-production-build') {
            return DEV_ONLY_SECRET;
        }
        throw new Error('NEXTAUTH_SECRET is not set. Refusing to start without a session secret in production.');
    }
    return DEV_ONLY_SECRET;
}

/** GitHub OAuth is optional; both halves must be present before we offer it. */
export function isGithubOAuthConfigured(): boolean {
    return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

/**
 * The demo Credentials provider accepts any email+password with no password
 * check, so it must never be registered in production. Enable explicitly for
 * local development only.
 */
export function isDemoCredentialsEnabled(): boolean {
    // Never register a passwordless provider in production, even if the flag
    // was copied from a local .env file by mistake.
    if (process.env.NODE_ENV === 'production') return false;
    return process.env.ALLOW_DEMO_CREDENTIALS === 'true';
}
