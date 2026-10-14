'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

interface SignInModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SignInModal({ isOpen, onClose }: SignInModalProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    // The demo credentials provider only exists when explicitly enabled for
    // local development, so the email form stays hidden everywhere else.
    const showDemoEmailForm = process.env.NEXT_PUBLIC_ALLOW_DEMO_CREDENTIALS === 'true';

    if (!isOpen) return null;

    const handleGoogleSignIn = async () => {
        await signIn('google', { callbackUrl: '/itime' });
    };

    const handleEmailSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        await signIn('credentials', {
            email,
            password,
            callbackUrl: '/itime',
        });
    };

    return (
        <div 
            className="fixed inset-0 bg-black/80  z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div 
                className="bg-black border border-white/10 rounded-2xl max-w-md w-full p-8"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-white mb-2">
                            Sign in to iTime
                        </h2>
                        <p className="text-zinc-400 text-sm">
                            Track your time across all your devices
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-500 hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Google Sign In */}
                <button
                    onClick={handleGoogleSignIn}
                    className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white hover:bg-gray-100 text-gray-900 font-medium rounded-lg transition-all mb-4"
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                </button>

                {/* Divider */}
                {showDemoEmailForm && (
                    <>
                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-white/10"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-black text-zinc-500">Or continue with email</span>
                            </div>
                        </div>

                        {/* Email Sign In Form */}
                        <form onSubmit={handleEmailSignIn} className="space-y-4">
                            <div>
                                <label className="block text-sm text-zinc-400 mb-2">Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-zinc-400 mb-2">Password</label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                                    required
                                />
                            </div>
                            <button
                                type="submit"
                                className="w-full px-6 py-3 bg-black hover:bg-white/5 text-white font-medium rounded-lg transition-all"
                            >
                                {isSignUp ? 'Sign Up' : 'Sign In'}
                            </button>
                        </form>

                        {/* Toggle Sign Up */}
                        <div className="mt-4 text-center text-sm text-zinc-500">
                            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                            <button
                                onClick={() => setIsSignUp(!isSignUp)}
                                className="text-white hover:text-zinc-300 transition-colors"
                            >
                                {isSignUp ? 'Sign In' : 'Sign Up'}
                            </button>
                        </div>
                    </>
                )}

                {/* Guest Mode */}
                <div className="mt-6 pt-6 border-t border-white/10">
                    <button
                        onClick={onClose}
                        className="w-full text-center text-sm text-zinc-500 hover:text-zinc-400 transition-colors"
                    >
                        Continue as guest (local storage only)
                    </button>
                </div>
            </div>
        </div>
    );
}
