import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GithubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import connectDB from '@/lib/mongodb';
import { cookies } from 'next/headers';
import { ensureUserHasDefaultUsername } from '@/lib/username';
import User from '@/models/User';
import {
    GITHUB_LINK_ATTEMPT_COOKIE,
    GITHUB_LINK_COOKIE,
    verifyGithubLinkToken,
} from '@/lib/github-link';
import {
    isDemoCredentialsEnabled,
    isGithubOAuthConfigured,
    resolveAuthSecret,
} from '@/lib/auth-env';

const githubOAuthConfigured = isGithubOAuthConfigured();

export const authOptions: NextAuthOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        }),
        // Only register GitHub when both halves of the OAuth app exist. An
        // empty clientId makes NextAuth redirect to GitHub with client_id= and
        // show an opaque provider error.
        ...(githubOAuthConfigured
            ? [
                GithubProvider({
                    clientId: process.env.GITHUB_CLIENT_ID!,
                    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
                    authorization: {
                        params: {
                            scope: 'read:user user:email'
                        }
                    }
                }),
            ]
            : []),
        // Demo-only provider: accepts any email+password with no verification.
        // Never registered unless ALLOW_DEMO_CREDENTIALS=true (local dev only).
        ...(isDemoCredentialsEnabled()
            ? [
                CredentialsProvider({
                    name: "Email (demo)",
                    credentials: {
                        email: { label: "Email", type: "email", placeholder: "you@example.com" },
                        password: { label: "Password", type: "password" }
                    },
                    async authorize(credentials) {
                        if (credentials?.email && credentials?.password) {
                            return {
                                id: credentials.email,
                                email: credentials.email,
                                name: credentials.email.split('@')[0],
                            };
                        }
                        return null;
                    }
                }),
            ]
            : []),
    ],
    pages: {
        signIn: '/itime', // Keep user on iTime page
    },
    callbacks: {
        async signIn({ account }) {
            if (account?.provider !== 'github') return true;

            // If the user clicked "Connect GitHub", the link token must still be
            // valid. Without this guard, an expired/missing cookie silently
            // falls through to a normal GitHub sign-in and replaces the
            // original Google session with a different account.
            try {
                let cookieStore: any = cookies();
                if (cookieStore instanceof Promise || typeof cookieStore?.then === 'function') {
                    cookieStore = await cookieStore;
                }
                const linkAttempt = cookieStore.get(GITHUB_LINK_ATTEMPT_COOKIE)?.value;
                if (linkAttempt === '1') {
                    const linkToken = cookieStore.get(GITHUB_LINK_COOKIE)?.value;
                    if (!verifyGithubLinkToken(linkToken)) {
                        return '/settings?githubError=link-expired';
                    }
                }
            } catch (error) {
                console.error('Could not read GitHub link cookies:', error);
            }

            return true;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = String((token as any).id || token.sub || token.email || '');
            }
            return session;
        },
        async jwt({ token, user, account, profile }) {
            if (user) {
                token.id = user.id;
            }

            const isSignInOrLink = Boolean(user || (account && account.provider === 'github'));
            if (!isSignInOrLink) return token;

            let isLinking = false;
            let cookieStore: any = null;

            try {
                await connectDB();

                if (account && account.provider === 'github') {
                    const githubProfile = profile as any;

                    // Next 16 safe cookie retrieval. The link token is minted
                    // server-side by /api/user/link-github-init and HMAC-signed,
                    // so a client can never forge a link for another user's email.
                    try {
                        cookieStore = cookies();
                        if (cookieStore instanceof Promise || typeof cookieStore?.then === 'function') {
                            cookieStore = await cookieStore;
                        }
                    } catch (error) {
                        console.error('cookie error', error);
                    }

                    const linkToken = cookieStore?.get?.(GITHUB_LINK_COOKIE)?.value ?? null;
                    const linkedEmail = verifyGithubLinkToken(linkToken);
                    isLinking = Boolean(linkedEmail);

                    let emailToFind = linkedEmail || user?.email || token.email;
                    if (!emailToFind) {
                        throw new Error('GitHub did not return an email address.');
                    }

                    // githubId is unique. If this GitHub identity already belongs
                    // to another user doc, reuse that account for a normal
                    // sign-in instead of hitting a duplicate-key error.
                    const linkedOwner = await User.findOne({
                        githubId: account.providerAccountId,
                    }).lean();
                    if (
                        linkedOwner &&
                        String(linkedOwner.email).toLowerCase() !== String(emailToFind).toLowerCase()
                    ) {
                        if (isLinking) {
                            throw new Error('This GitHub account is already linked to another infinWORK account.');
                        }
                        emailToFind = linkedOwner.email;
                    }

                    const existingUser = await User.findOne({ email: emailToFind });
                    if (isLinking && !existingUser) {
                        throw new Error('Could not find your infinWORK account to link GitHub to.');
                    }

                    const isSameGithubAccount = existingUser?.githubId === account.providerAccountId;

                    const githubUpdate: Record<string, unknown> = {
                        githubId: account.providerAccountId,
                        githubUsername: githubProfile?.login,
                        githubAccessToken: account.access_token,
                        githubSyncError: null,
                        githubSyncRetryAt: null,
                    };

                    if (!isSameGithubAccount) {
                        githubUpdate.githubConnectedAt = new Date();
                        githubUpdate.githubCommitsTotal = 0;
                        githubUpdate.points = 0;
                    } else if (!existingUser?.githubConnectedAt) {
                        githubUpdate.githubConnectedAt = new Date();
                    }

                    const userUpdate: Record<string, any> = {
                        $set: githubUpdate,
                    };

                    if (!isSameGithubAccount) {
                        userUpdate.$unset = {
                            lastGithubSyncAt: '',
                            githubPointsLastUpdatedAt: '',
                            githubPointsHistory: '',
                            githubSyncLockUntil: '',
                            githubSyncLockId: '',
                        };
                    }

                    const updatedUser = await User.findOneAndUpdate(
                        { email: emailToFind },
                        userUpdate,
                        { new: true, upsert: !isLinking }
                    );

                    if (!updatedUser) {
                        throw new Error('Could not save your GitHub connection.');
                    }

                    if (isLinking) {
                        // Keep the original (e.g. Google) identity. Returning
                        // early is what prevents NextAuth from swapping the
                        // session to the GitHub account.
                        token.email = updatedUser.email;
                        token.name = updatedUser.username || updatedUser.email;
                        token.sub = updatedUser._id.toString();
                        token.id = updatedUser._id.toString();

                        try {
                            cookieStore?.delete?.(GITHUB_LINK_COOKIE);
                            cookieStore?.delete?.(GITHUB_LINK_ATTEMPT_COOKIE);
                        } catch {
                            // Cookie cleanup is best-effort; the token expires shortly.
                        }

                        return token;
                    }

                    token.email = updatedUser.email;
                }

                if (token?.email && user) {
                    const profileName = (user as any)?.name || token.name || null;
                    await ensureUserHasDefaultUsername(token.email, profileName);
                }
            } catch (error) {
                console.error('Failed to update DB during auth:', error);
                // Never swallow a failed link: falling through would let
                // NextAuth sign the user in as the GitHub account instead.
                if (isLinking) throw error;
            }

            return token;
        }
    },
    // Refuses to boot in production without NEXTAUTH_SECRET (see auth-env.ts).
    secret: resolveAuthSecret(),
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
