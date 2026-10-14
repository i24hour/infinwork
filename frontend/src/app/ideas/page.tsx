'use client';

import { useState, useEffect, useRef } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { fetchWithCache, getCachedData, setCachedData } from '@/lib/client-cache';

interface Idea {
    _id: string;
    title: string;
    details: string;
    isPublic: boolean;
    createdBy: string;
    createdAt: string;
}

export default function IdeasPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const initialCached = getCachedData<{ ideas?: Idea[] }>('/api/ideas');
    const [ideas, setIdeas] = useState<Idea[]>(() => initialCached?.ideas || []);
    const [loading, setLoading] = useState<boolean>(() => !initialCached);
    const [formOpen, setFormOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [details, setDetails] = useState('');
    const [isPublic, setIsPublic] = useState(true);
    const [saving, setSaving] = useState(false);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'mine' | 'public'>('all');
    const titleRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetchIdeas();
    }, []);

    useEffect(() => {
        if (formOpen) setTimeout(() => titleRef.current?.focus(), 60);
    }, [formOpen]);

    const fetchIdeas = async () => {
        try {
            const data = await fetchWithCache<{ ideas?: Idea[] }>('/api/ideas', {
                dedupingIntervalMs: 2000,
            });
            if (data.ideas) setIdeas(data.ideas);
        } catch (err) {
            console.error('Failed to fetch ideas:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!title.trim() || saving) return;
        setSaving(true);
        try {
            const res = await fetch('/api/ideas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim(), details: details.trim(), isPublic }),
            });
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            setIdeas(prev => {
                const next = [data.idea, ...prev];
                setCachedData('/api/ideas', { ideas: next });
                return next;
            });
            setTitle('');
            setDetails('');
            setIsPublic(true);
            setFormOpen(false);
        } catch (err) {
            console.error('Failed to save idea:', err);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleVisibility = async (idea: Idea) => {
        if (togglingId) return;
        setTogglingId(idea._id);
        setIdeas(prev => {
            const next = prev.map(i => i._id === idea._id ? { ...i, isPublic: !i.isPublic } : i);
            setCachedData('/api/ideas', { ideas: next });
            return next;
        });
        try {
            const res = await fetch(`/api/ideas/${idea._id}`, { method: 'PATCH' });
            if (!res.ok) {
                setIdeas(prev => {
                    const next = prev.map(i => i._id === idea._id ? { ...i, isPublic: idea.isPublic } : i);
                    setCachedData('/api/ideas', { ideas: next });
                    return next;
                });
            }
        } catch {
            setIdeas(prev => {
                const next = prev.map(i => i._id === idea._id ? { ...i, isPublic: idea.isPublic } : i);
                setCachedData('/api/ideas', { ideas: next });
                return next;
            });
        } finally {
            setTogglingId(null);
        }
    };

    const handleDelete = async (ideaId: string) => {
        setIdeas(prev => {
            const next = prev.filter(i => i._id !== ideaId);
            setCachedData('/api/ideas', { ideas: next });
            return next;
        });
        try {
            await fetch(`/api/ideas/${ideaId}`, { method: 'DELETE' });
        } catch {
            fetchIdeas();
        }
    };

    const myEmail = session?.user?.email;

    const filteredIdeas = ideas.filter(idea => {
        if (filter === 'mine') return idea.createdBy === myEmail;
        if (filter === 'public') return idea.isPublic;
        return true;
    });

    const myIdeasCount = ideas.filter(i => i.createdBy === myEmail).length;
    const publicCount = ideas.filter(i => i.isPublic).length;
    const privateCount = ideas.filter(i => !i.isPublic && i.createdBy === myEmail).length;

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full">
                <div className="space-y-8 max-w-4xl">

                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Ideas</h1>
                            <p className="text-zinc-400">Capture, share, and track your ideas.</p>
                        </div>
                        {session && (
                            <button
                                onClick={() => setFormOpen(prev => !prev)}
                                className="self-start sm:self-auto px-6 py-2 rounded-full font-bold text-[15px] bg-white text-black hover:opacity-90 transition-opacity shadow-md"
                            >
                                {formOpen ? '✕ Cancel' : '+ New Idea'}
                            </button>
                        )}
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-black border border-white/10 rounded-2xl p-5">
                            <p className="text-sm text-zinc-400 mb-1">Total Ideas</p>
                            <p className="text-3xl font-bold text-white">{ideas.length}</p>
                        </div>
                        <div className="bg-black border border-white/10 rounded-2xl p-5">
                            <p className="text-sm text-zinc-400 mb-1">Public</p>
                            <p className="text-3xl font-bold text-[#4CAF50]">{publicCount}</p>
                        </div>
                        <div className="bg-black border border-white/10 rounded-2xl p-5">
                            <p className="text-sm text-zinc-400 mb-1">My Private</p>
                            <p className="text-3xl font-bold text-zinc-400">{privateCount}</p>
                        </div>
                    </div>

                    {/* New Idea Form */}
                    <AnimatePresence>
                        {formOpen && session && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                            >
                                <div className="bg-black border border-white/10 rounded-2xl p-6 flex flex-col gap-4">
                                    <h2 className="text-lg font-semibold text-white">New Idea</h2>
                                    <input
                                        ref={titleRef}
                                        type="text"
                                        value={title}
                                        onChange={e => setTitle(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSave()}
                                        placeholder="Idea title..."
                                        maxLength={100}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/25 transition-colors"
                                    />
                                    <textarea
                                        value={details}
                                        onChange={e => setDetails(e.target.value)}
                                        placeholder="Details, context, links... (optional)"
                                        rows={4}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/25 transition-colors resize-none"
                                    />
                                    <div className="flex items-center justify-between">
                                        {/* Visibility toggle */}
                                        <button
                                            onClick={() => setIsPublic(p => !p)}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200 ${
                                                isPublic
                                                    ? 'bg-[#4CAF50]/10 border-[#4CAF50]/30 text-[#4CAF50]'
                                                    : 'bg-white/5 border-white/10 text-zinc-400'
                                            }`}
                                        >
                                            <span className={`w-2 h-2 rounded-full ${isPublic ? 'bg-[#4CAF50]' : 'bg-zinc-600'}`} />
                                            {isPublic ? 'Public' : 'Private'}
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            disabled={!title.trim() || saving}
                                            className="px-6 py-2 rounded-full font-bold text-[15px] bg-white text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                                        >
                                            {saving ? 'Saving...' : 'Save Idea'}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Filter Tabs */}
                    <div className="flex gap-2">
                        {(['all', 'mine', 'public'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                                    filter === f
                                        ? 'bg-white text-black border-white'
                                        : 'bg-transparent text-zinc-400 border-white/10 hover:border-white/25 hover:text-white'
                                }`}
                            >
                                {f === 'all' ? 'All' : f === 'mine' ? 'My Ideas' : 'Public'}
                            </button>
                        ))}
                    </div>

                    {/* Ideas List */}
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white/40" />
                        </div>
                    ) : filteredIdeas.length === 0 ? (
                        <div className="text-center py-20 bg-black border border-white/10 rounded-2xl">
                            <div className="text-5xl mb-4">💡</div>
                            <p className="text-zinc-400 text-lg mb-1">No ideas yet</p>
                            <p className="text-zinc-600 text-sm">
                                {session ? 'Hit "+ New Idea" to add your first one.' : 'Sign in to add ideas.'}
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <AnimatePresence initial={false}>
                                {filteredIdeas.map(idea => {
                                    const isOwner = myEmail === idea.createdBy;
                                    return (
                                        <motion.div
                                            key={idea._id}
                                            initial={{ opacity: 0, y: -8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, x: -12 }}
                                            transition={{ duration: 0.15 }}
                                            className="group bg-black border border-white/10 hover:border-white/20 rounded-2xl p-5 transition-all cursor-pointer"
                                            onClick={() => router.push(`/ideas/${idea._id}`)}
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-base font-semibold text-white leading-snug mb-1 break-words">
                                                        {idea.title}
                                                    </p>
                                                    {idea.details && (
                                                        <p className="text-[15px] font-medium text-white leading-relaxed break-words">
                                                            {idea.details}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Right side: badge + actions */}
                                                <div className="flex flex-col items-end gap-2 shrink-0">
                                                    {/* Visibility badge — clickable for owner */}
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            isOwner && handleToggleVisibility(idea);
                                                        }}
                                                        disabled={!isOwner || togglingId === idea._id}
                                                        title={isOwner ? `Click to make ${idea.isPublic ? 'private' : 'public'}` : undefined}
                                                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all duration-200 ${
                                                            idea.isPublic
                                                                ? 'bg-[#4CAF50]/10 border-[#4CAF50]/30 text-[#4CAF50]'
                                                                : 'bg-white/5 border-white/10 text-zinc-400'
                                                        } ${isOwner ? 'cursor-pointer hover:opacity-75' : 'cursor-default'} ${togglingId === idea._id ? 'opacity-40' : ''}`}
                                                    >
                                                        <span className={`w-1.5 h-1.5 rounded-full ${idea.isPublic ? 'bg-[#4CAF50]' : 'bg-zinc-500'}`} />
                                                        {idea.isPublic ? 'Public' : 'Private'}
                                                    </button>

                                                    {isOwner && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDelete(idea._id);
                                                            }}
                                                            className="text-xs text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                        >
                                                            Delete
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Footer */}
                                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs text-zinc-700">
                                                        {idea.createdBy.split('@')[0]}
                                                    </span>
                                                    <span className="text-zinc-800">·</span>
                                                    <span className="text-xs text-zinc-700">
                                                        {new Date(idea.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-zinc-600 group-hover:text-zinc-400 transition-colors">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
                                                    <span className="text-[11px] font-medium">Discuss</span>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
