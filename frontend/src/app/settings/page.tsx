'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { useSession, signIn } from 'next-auth/react';
import { motion } from 'framer-motion';

export default function SettingsPage() {
    const { data: session } = useSession();
    const [username, setUsername] = useState('');
    const [totalScore, setTotalScore] = useState(0);
    const [githubPoints, setGithubPoints] = useState(0);
    const [chainPoints, setChainPoints] = useState(0);
    const [githubUsername, setGithubUsername] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [lastGithubSyncAt, setLastGithubSyncAt] = useState<string | null>(null);
    const [isRulesOpen, setIsRulesOpen] = useState(false);

    const fetchSettings = useCallback(async () => {
        try {
            const res = await fetch('/api/user/settings');
            const data = await res.json();
            if (data.username) {
                setUsername(data.username);
            }
            if (data.totalScore !== undefined) {
                setTotalScore(data.totalScore);
            }
            if (data.points !== undefined) {
                setGithubPoints(data.points);
            }
            if (data.chainPoints !== undefined) {
                setChainPoints(data.chainPoints);
            }
            if (data.githubUsername) {
                setGithubUsername(data.githubUsername);
            } else {
                setGithubUsername(null);
            }
            setLastGithubSyncAt(data.lastGithubSyncAt || null);
        } catch (err) {
            console.error('Error fetching settings:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (session) {
            fetchSettings();
        }
    }, [fetchSettings, session]);

    useEffect(() => {
        if (!session) return;

        const interval = setInterval(() => {
            fetchSettings();
        }, 15000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchSettings();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchSettings, session]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage({ type: '', text: '' });

        try {
            const res = await fetch('/api/user/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username }),
            });

            const data = await res.json();

            if (res.ok) {
                setMessage({ type: 'success', text: 'Username updated successfully!' });
            } else {
                setMessage({ type: 'error', text: data.error || 'Failed to update username' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'An error occurred. Please try again.' });
        } finally {
            setSaving(false);
        }
    };

    const handleDisconnectGithub = async () => {
        setSyncing(true); // Reuse syncing state for loading indicator
        setMessage({ type: '', text: '' });
        try {
            const res = await fetch('/api/user/disconnect-github', { method: 'POST' });
            if (res.ok) {
                setGithubUsername(null);
                setLastGithubSyncAt(null);
                await fetchSettings();
                setMessage({ type: 'success', text: 'GitHub disconnected successfully.' });
            } else {
                setMessage({ type: 'error', text: 'Failed to disconnect GitHub.' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Error disconnecting GitHub.' });
        } finally {
            setSyncing(false);
        }
    };

    const handleSyncGithub = async () => {
        setSyncing(true);
        setMessage({ type: '', text: '' });
        try {
            const res = await fetch('/api/user/sync-github', { method: 'POST' });
            const data = await res.json();
            
            if (res.ok) {
                setLastGithubSyncAt(data.lastGithubSyncAt || new Date().toISOString());
                await fetchSettings();
                setMessage({ type: 'success', text: `Sync complete! Earned ${data.pointsEarned} GitHub points.` });
            } else {
                setMessage({ type: 'error', text: data.error || 'Failed to sync GitHub' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Error syncing GitHub data.' });
        } finally {
            setSyncing(false);
        }
    };

    const handleConnectGithub = async () => {
        // Ask the server to set a short-lived signed link cookie so NextAuth
        // merges GitHub onto this account instead of replacing the session.
        // Falls back to a plain GitHub sign-in when the init call fails.
        try {
            await fetch('/api/user/link-github-init', { method: 'POST' });
        } catch {
            // fall through to signIn below
        }
        signIn('github');
    };

    const totalScoreAccentClass = totalScore < 0
        ? 'from-red-400 to-orange-400'
        : 'from-blue-400 to-emerald-400';

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full max-w-4xl">
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                >
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Settings</h1>
                        <p className="text-zinc-400">Manage your profile and account settings.</p>
                    </div>

                    <div className="bg-black border border-white/10 rounded-2xl p-6 md:p-8 space-y-6">
                        <section className="space-y-4">
                            <h2 className="text-xl font-semibold text-white">Profile Information</h2>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-400">Email Address</label>
                                <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-zinc-500 cursor-not-allowed">
                                    {session?.user?.email}
                                </div>
                                <p className="text-xs text-zinc-600">Email cannot be changed.</p>
                            </div>

                            <form onSubmit={handleSave} className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <label htmlFor="username" className="text-sm font-medium text-zinc-400">Username</label>
                                    <input
                                        id="username"
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder="Choose a unique username"
                                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                                        minLength={3}
                                        required
                                    />
                                    <p className="text-xs text-zinc-500">Only letters, numbers, and underscores are allowed.</p>
                                </div>

                                {message.text && (
                                    <div className={`p-4 rounded-xl text-sm ${
                                        message.type === 'success' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                                    }`}>
                                        {message.text}
                                    </div>
                                )}

                                <div className="pt-2">
                                    <LiquidButton 
                                        type="submit" 
                                        disabled={saving || loading}
                                        className="w-full md:w-auto px-8 py-3 text-white"
                                    >
                                        {saving ? 'Saving...' : 'Save Changes'}
                                    </LiquidButton>
                                </div>
                            </form>
                        </section>

                        <div className="h-px bg-white/10 w-full" />

                        <section className="space-y-4">
                            <h2 className="text-xl font-semibold text-white">Gamification & Connections</h2>
                            <p className="text-sm text-zinc-400">Connect your tools to earn points automatically based on your real-world work.</p>

                            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <h3 className="font-medium text-white mb-1">Total Score</h3>
                                        <div className={`text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r ${totalScoreAccentClass}`}>
                                            {totalScore.toFixed(2)} <span className="text-sm text-zinc-500 font-normal">pts</span>
                                        </div>
                                        <p className="text-xs text-zinc-500 mt-2">
                                            GitHub bonus: {githubPoints} pts | Chain bonus: {chainPoints} pts
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div>
                                        <h3 className="font-medium text-white mb-1 flex items-center gap-2">
                                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                                            </svg>
                                            GitHub Integration
                                        </h3>
                                        <p className="text-sm text-zinc-400">
                                            {githubUsername 
                                                ? `Connected as @${githubUsername}` 
                                                : 'Connect GitHub to earn +10 points for every commit.'}
                                        </p>
                                        {githubUsername && (
                                            <p className="text-xs text-zinc-500 mt-2">
                                                Auto-sync checks every 15 seconds while this page is open{lastGithubSyncAt ? ` - last sync ${new Date(lastGithubSyncAt).toLocaleString()}` : ''}.
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        {githubUsername ? (
                                            <div className="flex gap-2">
                                                <LiquidButton 
                                                    onClick={handleSyncGithub}
                                                    disabled={syncing}
                                                    className="px-6 py-2 text-white"
                                                >
                                                    {syncing ? 'Loading...' : 'Sync Now'}
                                                </LiquidButton>
                                                <button
                                                    onClick={handleDisconnectGithub}
                                                    disabled={syncing}
                                                    className="px-4 py-2 text-red-500 hover:text-red-400 text-sm font-medium transition-colors border border-red-500/20 rounded-xl hover:bg-red-500/10"
                                                >
                                                    Disconnect
                                                </button>
                                            </div>
                                        ) : (
                                            <LiquidButton 
                                                onClick={handleConnectGithub}
                                                className="px-6 py-2 text-white"
                                                variant="outline"
                                            >
                                                Connect GitHub
                                            </LiquidButton>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <div className="h-px bg-white/10 w-full" />

                        <section className="space-y-4">
                            <button
                                type="button"
                                onClick={() => setIsRulesOpen((prev) => !prev)}
                                className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10 transition-colors"
                            >
                                <div>
                                    <h2 className="text-xl font-semibold text-white">Rules & Formulas</h2>
                                    <p className="text-sm text-zinc-400">Click to view how scoring works.</p>
                                </div>
                                <svg
                                    className={`w-5 h-5 text-zinc-400 transition-transform ${isRulesOpen ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {isRulesOpen && (
                                <div className="space-y-4">
                                    <details className="rounded-xl border border-white/10 bg-white/5 p-4" open>
                                        <summary className="cursor-pointer text-sm font-semibold text-white">Performance Score</summary>
                                        <div className="mt-3 space-y-2 text-sm text-zinc-400">
                                            <p className="font-mono text-zinc-300 bg-black/40 border border-white/10 rounded-md px-3 py-2 overflow-x-auto">
                                                Score = CompletionRate x SpeedScore x VolumeBonus x 1000
                                            </p>
                                            <p>CompletionRate = CompletedTasks / TotalTasks</p>
                                            <p>SpeedScore = 1 / max(AvgTimePerCompletedTaskHours, 0.5)</p>
                                            <p>VolumeBonus = log10(CompletedTasks + 1) x 2</p>
                                            <p className="text-xs text-zinc-500">If total tasks = 0 or completed tasks = 0, base score remains 0.</p>
                                        </div>
                                    </details>

                                    <details className="rounded-xl border border-white/10 bg-white/5 p-4" open>
                                        <summary className="cursor-pointer text-sm font-semibold text-white">Idle Penalty</summary>
                                        <div className="mt-3 space-y-2 text-sm text-zinc-400">
                                            <p>Penalty runs only when no task is active.</p>
                                            <p>Rate: 0.001 points per second (about 3.6 points per hour).</p>
                                            <p>Penalty timeline starts from the later of:</p>
                                            <p>- 1 Apr 2026, 00:00 IST</p>
                                            <p>- your first tracked task start time</p>
                                        </div>
                                    </details>

                                    <details className="rounded-xl border border-white/10 bg-white/5 p-4" open>
                                        <summary className="cursor-pointer text-sm font-semibold text-white">Bonus Points</summary>
                                        <div className="mt-3 space-y-2 text-sm text-zinc-400">
                                            <p>GitHub: +10 points per commit (from GitHub contribution data).</p>
                                            <p>Chain rewards are individual and block-based:</p>
                                            <p>- First 3h block: +10</p>
                                            <p>- Next 3h block: +20</p>
                                            <p>- Next 3h block: +30</p>
                                            <p>...and so on for each completed 3h block.</p>
                                        </div>
                                    </details>
                                </div>
                            )}
                        </section>
                    </div>
                </motion.div>
            </main>
        </div>
    );
}
