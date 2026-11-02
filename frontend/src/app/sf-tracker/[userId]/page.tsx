"use client";

import { useState, useEffect, use } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

interface SFTrackerItem {
    _id: string;
    target: string;
    successCondition: string;
    status: 'Pending' | 'Success' | 'Failure';
    failureReason: string;
    createdAt: string;
    updatedAt: string;
}

interface UserProfile {
    username: string;
    image: string | null;
}

interface UserStats {
    totalTasks: number;
    successTasks: number;
    failureTasks: number;
}

export default function UserSFTrackerPage({ params }: { params: Promise<{ userId: string }> }) {
    const { userId } = use(params);
    const [targets, setTargets] = useState<SFTrackerItem[]>([]);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [userStats, setUserStats] = useState<UserStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const fetchUserData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/sf-tracker/user/${encodeURIComponent(userId)}`);
                const data = await res.json().catch(() => ({}));
                if (cancelled) return;

                if (!res.ok) {
                    setError(data.error || 'Could not load this tracker.');
                    setUserProfile(null);
                    setUserStats(null);
                    setTargets([]);
                    return;
                }

                setUserProfile(data.user);
                setUserStats(data.stats);
                setTargets(data.targets || []);
            } catch (err) {
                if (!cancelled) {
                    console.error('Failed to fetch user SF data:', err);
                    setError('Could not load this tracker.');
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        fetchUserData();
        return () => {
            cancelled = true;
        };
    }, [userId]);

    const pendingTargets = targets.filter(t => t.status === 'Pending');
    const historyTargets = targets.filter(t => t.status !== 'Pending');

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 w-full max-w-5xl mx-auto pt-20 md:pt-8 min-h-screen">
                
                <div className="space-y-12 pb-24">
                    {/* Header */}
                    <div className="space-y-6">
                        <Link href="/sf-tracker" className="inline-flex items-center text-sm font-medium text-zinc-500 hover:text-white transition-colors">
                            <span className="mr-2">←</span> Back to SF Tracker
                        </Link>
                        
                        {isLoading ? (
                            <div className="h-20 bg-white/5 rounded-2xl animate-pulse"></div>
                        ) : userProfile && (
                            <div className="flex items-center gap-6">
                                {userProfile.image ? (
                                    <img src={userProfile.image} alt={userProfile.username} className="w-20 h-20 rounded-full border-2 border-white/10 object-cover shrink-0" />
                                ) : (
                                    <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center text-3xl font-bold text-white shrink-0">
                                        {userProfile.username?.[0]?.toUpperCase() || '?'}
                                    </div>
                                )}
                                <div>
                                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-2">{userProfile.username}&apos;s Tracker <span className="text-sm font-normal text-zinc-500 tracking-normal ml-3">Read-only View</span></h1>
                                    <p className="text-zinc-500 text-sm">Targets remain strictly confidential. Only execution status is globally exposed.</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {error && !isLoading && (
                        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                            {error}
                        </div>
                    )}

                    {/* Stats Dashboard */}
                    {isLoading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {[1, 2, 3].map(i => <div key={i} className="h-28 bg-white/5 rounded-2xl animate-pulse"></div>)}
                        </div>
                    ) : userStats && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                                <h3 className="text-zinc-500 text-sm font-medium mb-2">Total Tasks</h3>
                                <p className="text-4xl font-bold text-white">{userStats.totalTasks}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative overflow-hidden">
                                <div className="absolute inset-0 bg-emerald-500/5 transition-opacity opacity-0 group-hover:opacity-100"></div>
                                <h3 className="text-emerald-500 text-sm font-bold tracking-wide uppercase mb-2 relative z-10">Total Success</h3>
                                <p className="text-4xl font-bold text-emerald-400 relative z-10">{userStats.successTasks}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative overflow-hidden">
                                <div className="absolute inset-0 bg-red-500/5 transition-opacity opacity-0 group-hover:opacity-100"></div>
                                <h3 className="text-red-500 text-sm font-bold tracking-wide uppercase mb-2 relative z-10">Total Failure</h3>
                                <p className="text-4xl font-bold text-red-400 relative z-10">{userStats.failureTasks}</p>
                            </div>
                        </div>
                    )}

                    {/* Pending Targets */}
                    <div className="space-y-6">
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-bold text-white">Active Pursuit</h2>
                            <div className="px-2.5 py-0.5 rounded-full bg-white/10 text-xs font-bold text-zinc-300 border border-white/10">
                                {pendingTargets.length}
                            </div>
                        </div>

                        {isLoading ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {[1, 2].map(i => <div key={i} className="h-40 bg-white/5 rounded-2xl animate-pulse"></div>)}
                            </div>
                        ) : pendingTargets.length === 0 ? (
                            <div className="text-center p-12 bg-white/5 border border-white/5 rounded-3xl border-dashed">
                                <span className="text-4xl mb-4 block">🎯</span>
                                <h3 className="text-lg font-medium text-zinc-300 mb-1">No Active Targets</h3>
                                <p className="text-zinc-500 text-sm">{userProfile?.username || 'User'} currently has no active declared pursuits.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <AnimatePresence>
                                    {pendingTargets.map(target => (
                                        <motion.div 
                                            key={target._id}
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            className="bg-black border border-white/10 rounded-2xl p-6 overflow-hidden flex flex-col justify-between opacity-70"
                                        >
                                            <div className="relative z-10 mb-6">
                                                <h3 className="text-xl font-bold text-white mb-3 italic">🔒 Hidden for Privacy</h3>
                                                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 block mb-1">Success Condition</span>
                                                    <p className="text-sm text-zinc-400 leading-snug italic">🔒 Classified Objective</p>
                                                </div>
                                            </div>

                                            <div className="mt-auto">
                                                <div className="flex items-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl text-zinc-400 text-sm font-medium">
                                                    <div className="w-2 h-2 rounded-full bg-zinc-400 animate-pulse"></div>
                                                    Target Active & Pending Execution
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>

                    {/* History */}
                    {historyTargets.length > 0 && (
                        <div className="space-y-6 pt-10 border-t border-white/5">
                            <h2 className="text-xl font-bold text-white">Execution History</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {historyTargets.map(target => (
                                    <div key={target._id} className="bg-white/5 border border-white/5 rounded-xl p-5 relative">
                                        <div className="flex justify-between items-start mb-2 pr-6">
                                            <h3 className="font-semibold text-white italic">🔒 Hidden for Privacy</h3>
                                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${target.status === 'Success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                                {target.status}
                                            </span>
                                        </div>
                                        
                                        {target.status === 'Failure' && target.failureReason && (
                                            <div className="mt-3 bg-white/5 border border-white/10 rounded-lg p-3">
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 block mb-1">Reason for Failure</span>
                                                <p className="text-sm text-zinc-400 italic">&quot;🔒 Private Reflection Logged&quot;</p>
                                            </div>
                                        )}
                                        {target.status === 'Success' && (
                                            <div className="mt-3">
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 block mb-1">Condition Met</span>
                                                <p className="text-xs text-zinc-400 italic">🔒 Classified Objective</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            </main>
        </div>
    );
}
