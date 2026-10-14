'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Sidebar } from '@/components/Sidebar';
import { motion, AnimatePresence } from 'framer-motion';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import Link from 'next/link';
import {
    fetchWithCache,
    getCachedData,
    invalidateCache,
    prefetchJson,
    setCachedData,
} from '@/lib/client-cache';

interface SFTrackerItem {
    _id: string;
    target: string;
    successCondition: string;
    status: 'Pending' | 'Success' | 'Failure';
    failureReason: string;
    createdAt: string;
}

interface SFLeaderboardUser {
    userId: string;
    username: string;
    image: string | null;
    totalTasks: number;
    successTasks: number;
    failureTasks: number;
}

export default function SFTrackerPage() {
    const { data: session, status } = useSession();
    const initialTargets = getCachedData<{ targets?: SFTrackerItem[] }>('/api/sf-tracker');
    const initialLeaderboard = getCachedData<{ leaderboard?: SFLeaderboardUser[] }>('/api/sf-tracker/all');
    const [targets, setTargets] = useState<SFTrackerItem[]>(() => initialTargets?.targets || []);
    const [leaderboard, setLeaderboard] = useState<SFLeaderboardUser[]>(() => initialLeaderboard?.leaderboard || []);
    const [isLoading, setIsLoading] = useState<boolean>(() => !initialTargets);
    const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState<'my' | 'all'>('my');
    
    // Form State
    const [newTarget, setNewTarget] = useState('');
    const [newCondition, setNewCondition] = useState('');

    // Failure Modal State
    const [failureModalOpen, setFailureModalOpen] = useState(false);
    const [failingTargetId, setFailingTargetId] = useState<string | null>(null);
    const [failureReason, setFailureReason] = useState('');

    useEffect(() => {
        if (status === 'unauthenticated') {
            setIsLoading(false);
            return;
        }
        fetchTargets();
    }, [status]);

    useEffect(() => {
        if (activeTab === 'all') {
            fetchLeaderboard();
        }
    }, [activeTab]);

    const fetchLeaderboard = async () => {
        if (leaderboard.length === 0 && !getCachedData('/api/sf-tracker/all')) {
            setIsLeaderboardLoading(true);
        }
        try {
            const data = await fetchWithCache<{ leaderboard?: SFLeaderboardUser[] }>('/api/sf-tracker/all', {
                dedupingIntervalMs: 3000,
            });
            if (data.leaderboard) {
                setLeaderboard(data.leaderboard);
            }
        } catch (error) {
            console.error('Failed to fetch leaderboard:', error);
        } finally {
            setIsLeaderboardLoading(false);
        }
    };

    const fetchTargets = async () => {
        try {
            const data = await fetchWithCache<{ targets?: SFTrackerItem[] }>('/api/sf-tracker', {
                dedupingIntervalMs: 2000,
            });
            if (data.targets) {
                setTargets(data.targets);
            }
        } catch (error) {
            console.error('Failed to fetch targets:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateTarget = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTarget.trim() || !newCondition.trim()) return;

        setIsSubmitting(true);
        try {
            const res = await fetch('/api/sf-tracker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: newTarget, successCondition: newCondition }),
            });
            const data = await res.json();
            if (data.target) {
                const next = [data.target, ...targets];
                setTargets(next);
                setCachedData('/api/sf-tracker', { targets: next });
                invalidateCache('/api/sf-tracker/all');
                setNewTarget('');
                setNewCondition('');
            }
        } catch (error) {
            console.error('Failed to create target:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleMarkSuccess = async (id: string) => {
        try {
            const res = await fetch(`/api/sf-tracker/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Success' }),
            });
            if (res.ok) {
                const next = targets.map(t => t._id === id ? { ...t, status: 'Success' as const } : t);
                setTargets(next);
                setCachedData('/api/sf-tracker', { targets: next });
                invalidateCache('/api/sf-tracker/all');
            }
        } catch (error) {
            console.error('Failed to mark success:', error);
        }
    };

    const handleMarkFailureClick = (id: string) => {
        setFailingTargetId(id);
        setFailureReason('');
        setFailureModalOpen(true);
    };

    const submitFailure = async () => {
        if (!failingTargetId || !failureReason.trim()) return;
        
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/sf-tracker/${failingTargetId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Failure', failureReason: failureReason }),
            });
            if (res.ok) {
                const next = targets.map(t => 
                    t._id === failingTargetId ? { ...t, status: 'Failure' as const, failureReason: failureReason } : t
                );
                setTargets(next);
                setCachedData('/api/sf-tracker', { targets: next });
                invalidateCache('/api/sf-tracker/all');
                setFailureModalOpen(false);
            }
        } catch (error) {
            console.error('Failed to submit failure:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this tracker permanently?')) return;
        try {
            const res = await fetch(`/api/sf-tracker/${id}`, { method: 'DELETE' });
            if (res.ok) {
                const next = targets.filter(t => t._id !== id);
                setTargets(next);
                setCachedData('/api/sf-tracker', { targets: next });
                invalidateCache('/api/sf-tracker/all');
            }
        } catch (error) {
            console.error('Failed to delete target:', error);
        }
    };

    const pendingTargets = targets.filter(t => t.status === 'Pending');
    const historyTargets = targets.filter(t => t.status !== 'Pending');

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 w-full max-w-5xl mx-auto pt-20 md:pt-8 min-h-screen">
                
                <div className="space-y-12 pb-24">
                    {/* Header */}
                    <div className="space-y-3">
                        <div className="inline-flex items-center justify-center p-3 bg-white/5 border border-white/10 rounded-2xl mb-2 backdrop-blur-md">
                            <span className="text-3xl">⚖️</span>
                        </div>
                        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-2">SF Tracker</h1>
                        <p className="text-zinc-400 text-lg max-w-2xl">
                            Binary execution: Success or Failure. Define your target, specify the exact condition for success, and hold yourself strictly accountable.
                        </p>
                    </div>

                    {/* Tab Navigation */}
                    <div className="flex justify-center mb-8">
                        <div className="bg-white/5 border border-white/10 p-1.5 rounded-full inline-flex relative shadow-lg">
                            <button
                                onClick={() => setActiveTab('my')}
                                className={`relative z-10 px-8 py-2.5 rounded-full text-sm font-bold tracking-wide transition-colors ${activeTab === 'my' ? 'text-black' : 'text-zinc-400 hover:text-white'}`}
                            >
                                My SF
                            </button>
                            <button
                                onClick={() => setActiveTab('all')}
                                onMouseEnter={() => prefetchJson('/api/sf-tracker/all', 15000)}
                                className={`relative z-10 px-8 py-2.5 rounded-full text-sm font-bold tracking-wide transition-colors ${activeTab === 'all' ? 'text-black' : 'text-zinc-400 hover:text-white'}`}
                            >
                                All SF
                            </button>
                            <div 
                                className="absolute top-1.5 bottom-1.5 w-[116px] bg-white rounded-full transition-transform duration-300 ease-out shadow-sm"
                                style={{ transform: `translateX(${activeTab === 'all' ? '100%' : '0'})` }}
                            />
                        </div>
                    </div>

                    <AnimatePresence mode="wait">
                        {activeTab === 'my' ? (
                            <motion.div 
                                key="my-sf"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                                className="space-y-12"
                            >
                                {/* Stats Dashboard */}
                                <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-8 md:gap-4 relative overflow-hidden group">
                                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-50 transition-opacity group-hover:opacity-70" />
                                    <div className="relative z-10 flex-1 text-center md:text-left">
                                        <h3 className="text-zinc-500 text-xs font-bold uppercase tracking-[0.2em] mb-1">Execution Momentum</h3>
                                        <p className="text-3xl font-black text-white">Execution Metrics</p>
                                    </div>
                                    <div className="relative z-10 flex items-center gap-2 sm:gap-6 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
                                        <div className="flex-1 md:flex-none flex flex-col items-center md:items-start min-w-[80px]">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Targets</span>
                                            </div>
                                            <p className="text-3xl font-black text-white">{targets.length}</p>
                                        </div>
                                        <div className="w-px h-10 bg-white/10 hidden sm:block" />
                                        <div className="flex-1 md:flex-none flex flex-col items-center md:items-start min-w-[80px]">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Success</span>
                                            </div>
                                            <p className="text-3xl font-black text-emerald-400">{targets.filter(t => t.status === 'Success').length}</p>
                                        </div>
                                        <div className="w-px h-10 bg-white/10 hidden sm:block" />
                                        <div className="flex-1 md:flex-none flex flex-col items-center md:items-start min-w-[80px]">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Failure</span>
                                            </div>
                                            <p className="text-3xl font-black text-rose-400">{targets.filter(t => t.status === 'Failure').length}</p>
                                        </div>
                                    </div>
                                </div>

                    {/* Creation Form */}
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8">
                        <h2 className="text-xl font-semibold text-white mb-6">Add New Target</h2>
                        <form onSubmit={handleCreateTarget} className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Target / Goal</label>
                                <input 
                                    type="text"
                                    value={newTarget}
                                    onChange={(e) => setNewTarget(e.target.value)}
                                    placeholder="e.g. Master React Hooks"
                                    className="w-full bg-black border border-white/10 text-white placeholder-zinc-500 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all font-medium"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Success Condition <span className="text-zinc-500 text-xs">(Strict milestone)</span></label>
                                <input 
                                    type="text"
                                    value={newCondition}
                                    onChange={(e) => setNewCondition(e.target.value)}
                                    placeholder="e.g. Build 3 custom hooks without looking at docs and integrate them into a proj"
                                    className="w-full bg-black border border-white/10 text-white placeholder-zinc-500 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all font-medium"
                                    required
                                />
                            </div>
                            <div className="pt-2">
                                <LiquidButton type="submit" disabled={isSubmitting || !newTarget.trim() || !newCondition.trim()} className="w-full sm:w-auto px-8 font-bold">
                                    {isSubmitting ? 'Initializing...' : 'Lock Target'}
                                </LiquidButton>
                            </div>
                        </form>
                    </div>

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
                                <p className="text-zinc-500 text-sm">Lock in a target above to begin tracking your execution.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <AnimatePresence>
                                    {pendingTargets.map(target => (
                                        <motion.div 
                                            key={target._id}
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.9 }}
                                            className="bg-black border border-white/10 rounded-2xl p-6 hover:border-white/20 transition-all group relative overflow-hidden flex flex-col justify-between"
                                        >
                                            <button onClick={() => handleDelete(target._id)} className="absolute top-4 right-4 text-zinc-600 hover:text-red-500 transition-colors z-20" title="Delete">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                            
                                            <div className="pr-6 relative z-10 mb-6 flex-1">
                                                <h3 className="text-xl font-black text-white mb-4 leading-tight group-hover:text-blue-400 transition-colors">{target.target}</h3>
                                                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 group-hover:bg-white/10 transition-colors">
                                                    <span className="text-[9px] uppercase font-black tracking-[0.15em] text-zinc-500 block mb-2">Success Condition</span>
                                                    <p className="text-sm text-zinc-300 leading-relaxed">{target.successCondition}</p>
                                                </div>
                                            </div>

                                            <div className="flex gap-3 relative z-10 mt-auto pt-4 border-t border-white/5">
                                                <button 
                                                    onClick={() => handleMarkSuccess(target._id)}
                                                    className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-black uppercase tracking-widest py-3 rounded-xl transition-all active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.2)] flex items-center justify-center gap-2"
                                                >
                                                    <span className="text-lg">S</span>
                                                    <span>Success</span>
                                                </button>
                                                <button 
                                                    onClick={() => handleMarkFailureClick(target._id)}
                                                    className="flex-1 bg-rose-500 hover:bg-rose-400 text-black text-[10px] font-black uppercase tracking-widest py-3 rounded-xl transition-all active:scale-95 shadow-[0_0_20px_rgba(244,63,94,0.2)] flex items-center justify-center gap-2"
                                                >
                                                    <span className="text-lg">F</span>
                                                    <span>Failure</span>
                                                </button>
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
                                    <div key={target._id} className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 hover:bg-white/[0.06] transition-all relative group overflow-hidden">
                                        <div className={`absolute top-0 left-0 w-1 h-full ${target.status === 'Success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                        <button onClick={() => handleDelete(target._id)} className="absolute top-4 right-4 text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="font-bold text-lg text-white pr-6">{target.target}</h3>
                                            <span className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${target.status === 'Success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                                {target.status}
                                            </span>
                                        </div>
                                        
                                        {target.status === 'Failure' && target.failureReason && (
                                            <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-4">
                                                <span className="text-[9px] uppercase font-black tracking-widest text-rose-500/60 block mb-1">Reason for Failure</span>
                                                <p className="text-sm text-zinc-400 italic">"{target.failureReason}"</p>
                                            </div>
                                        )}
                                        {target.status === 'Success' && (
                                            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4">
                                                <span className="text-[9px] uppercase font-black tracking-widest text-emerald-500/60 block mb-1">Execution Milestone Met</span>
                                                <p className="text-sm text-zinc-400">{target.successCondition}</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </motion.div>
                ) : (
                <motion.div
                    key="all-sf"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                >
                    <div className="flex items-center gap-3 mb-6">
                        <h2 className="text-2xl font-bold text-white">Global Ranking</h2>
                        <div className="px-2.5 py-0.5 rounded-full bg-white/10 text-xs font-bold text-zinc-300 border border-white/10">
                            Sorted by Target Success Rate
                        </div>
                    </div>

                    {isLeaderboardLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse"></div>)}
                        </div>
                    ) : (
                        leaderboard.map((user, index) => (
                            <Link key={user.userId} href={`/sf-tracker/${encodeURIComponent(user.userId)}`}>
                                <div className="group bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10 rounded-2xl p-5 md:p-6 transition-all flex flex-col md:flex-row items-start md:items-center gap-6 relative shadow-lg overflow-hidden cursor-pointer transition-transform hover:-translate-y-1 mb-4">
                                    {/* Rank Indicator */}
                                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-black border border-white/10 text-zinc-400 font-bold shrink-0">
                                        #{index + 1}
                                    </div>

                                    {/* User Profile */}
                                    <div className="flex items-center gap-4 min-w-[200px]">
                                        {user.image ? (
                                            <img src={user.image} alt={user.username} className="w-12 h-12 rounded-full border border-white/10 object-cover shrink-0" />
                                        ) : (
                                            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-lg font-bold text-white shrink-0">
                                                {user.username?.[0]?.toUpperCase() || '?'}
                                            </div>
                                        )}
                                        <div>
                                            <div className="text-lg font-bold text-white group-hover:text-zinc-200 transition-colors">{user.username}</div>
                                        </div>
                                    </div>

                                    {/* Metrics Row */}
                                    <div className="flex flex-wrap md:flex-nowrap md:flex-1 md:justify-end items-center gap-3 sm:gap-4 mt-4 md:mt-0 w-full md:w-auto">
                                        <div className="flex-1 md:flex-none flex flex-col items-center md:items-start bg-white/[0.03] border border-white/5 rounded-2xl px-4 py-3 min-w-[90px] transition-colors group-hover:bg-white/[0.06]">
                                            <span className="text-[9px] uppercase font-black tracking-[0.15em] text-zinc-500 mb-1">Targets</span>
                                            <span className="text-xl font-black text-white">{user.totalTasks}</span>
                                        </div>
                                        <div className="flex-1 md:flex-none flex flex-col items-center md:items-start bg-emerald-500/5 border border-emerald-500/10 rounded-2xl px-4 py-3 min-w-[90px] transition-colors group-hover:bg-emerald-500/10">
                                            <span className="text-[9px] uppercase font-black tracking-[0.15em] text-emerald-500/60 mb-1">Success</span>
                                            <span className="text-xl font-black text-emerald-400">{user.successTasks}</span>
                                        </div>
                                        <div className="flex-1 md:flex-none flex flex-col items-center md:items-start bg-rose-500/5 border border-rose-500/10 rounded-2xl px-4 py-3 min-w-[90px] transition-colors group-hover:bg-rose-500/10">
                                            <span className="text-[9px] uppercase font-black tracking-[0.15em] text-rose-500/60 mb-1">Failure</span>
                                            <span className="text-xl font-black text-rose-400">{user.failureTasks}</span>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))
                    )}
                </motion.div>
                )}
                    </AnimatePresence>
                </div>

                {/* Failure Modal */}
                <AnimatePresence>
                    {failureModalOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                            <motion.div 
                                initial={{ opacity: 0 }} 
                                animate={{ opacity: 1 }} 
                                exit={{ opacity: 0 }} 
                                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                                onClick={() => setFailureModalOpen(false)}
                            />
                            <motion.div 
                                initial={{ opacity: 0, scale: 0.95, y: 20 }} 
                                animate={{ opacity: 1, scale: 1, y: 0 }} 
                                exit={{ opacity: 0, scale: 0.95, y: -20 }} 
                                className="relative w-full max-w-md bg-black border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl overflow-hidden"
                            >
                                <h3 className="text-2xl font-bold text-white mb-2">Acknowledge Failure</h3>
                                <p className="text-zinc-400 text-sm mb-6">Why did you fail to meet the success condition? Be brutal. No excuses.</p>
                                
                                <textarea
                                    value={failureReason}
                                    onChange={(e) => setFailureReason(e.target.value)}
                                    placeholder="e.g. Got distracted by YouTube, procrastinated instead of reading documentation."
                                    className="w-full bg-white/5 border border-white/10 text-white placeholder-zinc-500 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all h-32 resize-none mb-6"
                                    autoFocus
                                />

                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => setFailureModalOpen(false)}
                                        className="flex-1 py-3 px-4 rounded-xl font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors border border-transparent"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={submitFailure}
                                        disabled={isSubmitting || !failureReason.trim()}
                                        className="flex-1 py-3 px-4 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isSubmitting ? 'Logging...' : 'Submit Failure'}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

            </main>
        </div>
    );
}
