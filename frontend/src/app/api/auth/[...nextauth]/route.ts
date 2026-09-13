import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GithubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import connectDB from '@/lib/mongodb';
import { cookies } from 'next/headers';
import { ensureUserHasDefaultUsername } from '@/lib/username';
import User from '@/models/User';
import { GITHUB_LINK_COOKIE, verifyGithubLinkToken } from '@/lib/github-link';
import { isDemoCredentialsEnabled, resolveAuthSecret } from '@/lib/auth-env';

export const authOptions: NextAuthOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        }),
        GithubProvider({
            clientId: process.env.GITHUB_CLIENT_ID || "",
            clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
            authorization: {
                params: {
                    scope: 'read:user user:email'
                }
            }
        }),
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
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.sub || token.email || '';
            }
            return session;
        },
        async jwt({ token, user, account, profile }) {
            if (user) {
                token.id = user.id;
            }

            try {
                await connectDB();

                if (account && account.provider === 'github') {
                    // When user authenticates with github, update their profile
                    const githubProfile = profile as any;

                    // nextJS 16 safe cookie retrieval. The link token is minted
                    // server-side by /api/user/link-github-init and HMAC-signed,
                    // so a client can never forge a link for another user's email.
                    let linkToken: string | null = null;
                    try {
                        let cStore: any = cookies();
                        if (cStore instanceof Promise || typeof cStore.then === 'function') {
                            cStore = await cStore;
                        }
                        linkToken = cStore.get(GITHUB_LINK_COOKIE)?.value ?? null;
                    } catch (e) {
                        console.error('cookie error', e);
                    }

                    const linkedEmail = verifyGithubLinkToken(linkToken);
                    const isLinking = Boolean(linkedEmail);

                    let emailToFind = user?.email || token.email;

                    if (linkedEmail) {
                        emailToFind = linkedEmail;
                    }

                    if (emailToFind) {
                        const existingUser = await User.findOne({ email: emailToFind });
                        const isSameGithubAccount = existingUser?.githubId === account.providerAccountId;

                        const githubUpdate: Record<string, unknown> = {
                            githubId: account.providerAccountId,
                            githubUsername: githubProfile?.login,
                            githubAccessToken: account.access_token,
                        };

                        if (!isSameGithubAccount) {
                            githubUpdate.githubConnectedAt = new Date();
                            githubUpdate.githubCommitsTotal = 0;
                            githubUpdate.points = 0;
                        } else if (!existingUser?.githubConnectedAt) {
                            githubUpdate.githubConnectedAt = new Date();
                        }

                        const userUpdate: Record<string, unknown> = {
                            $set: githubUpdate,
                        };

                        if (!isSameGithubAccount) {
                            userUpdate.$unset = {
                                lastGithubSyncAt: '',
                                githubPointsLastUpdatedAt: '',
                                githubPointsHistory: '',
                                githubSyncLockUntil: '',
                            };
                        }

                        await User.findOneAndUpdate(
                            { email: emailToFind },
                            userUpdate,
                            { new: true, upsert: true }
                        );

                        if (isLinking) {
                            // If we are linking an account from the Settings page, we MUST prevent NextAuth
                            // from replacing the original session (Google) with the new identity (GitHub).
                            const originalUser = await User.findOne({ email: emailToFind });
                            if (originalUser) {
                                token.email = originalUser.email;
                                token.name = originalUser.username;
                                token.id = originalUser._id.toString();

                                // Return early so NextAuth doesn't overwrite it with GitHub details
                                return token;
                            }
                        }
                    }
                }

                if (token?.email && user) {
                    const profileName = (user as any)?.name || token.name || null;
                    await ensureUserHasDefaultUsername(token.email, profileName);
                }
            } catch (error) {
                console.error('Failed to update DB during auth:', error);
            }

            return token;
        }
    },
    // Refuses to boot in production without NEXTAUTH_SECRET (see auth-env.ts).
    secret: resolveAuthSecret(),
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
