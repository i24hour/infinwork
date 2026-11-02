'use client';

import { useState, useEffect, useRef, use } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

interface Idea {
    _id: string;
    title: string;
    details: string;
    isPublic: boolean;
    createdBy?: string;
    isOwner?: boolean;
    username?: string;
    createdAt: string;
}

interface Reply {
    _id: string;
    ideaId: string;
    content: string;
    createdBy?: string;
    isOwner?: boolean;
    username?: string;
    isPublic: boolean;
    imageUrl?: string;
    createdAt: string;
    updatedAt?: string;
    isEdited?: boolean;
}

export default function IdeaDiscussionPage({ params }: { params: Promise<{ ideaId: string }> }) {
    const resolvedParams = use(params);
    const selectedIdeaId = resolvedParams.ideaId;
    
    const { data: session } = useSession();
    const myEmail = session?.user?.email;

    const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
    const [loadingIdea, setLoadingIdea] = useState(true);

    const [replies, setReplies] = useState<Reply[]>([]);
    const [loadingReplies, setLoadingReplies] = useState(false);
    
    const [newReply, setNewReply] = useState('');
    const [replyIsPublic, setReplyIsPublic] = useState(true);
    const [sendingReply, setSendingReply] = useState(false);
    const [togglingReplyId, setTogglingReplyId] = useState<string | null>(null);
    
    // Edit & Delete State
    const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState('');
    
    const [replyImage, setReplyImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Zoomed Image Lightbox State
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);

    useEffect(() => {
        if (selectedIdeaId) {
            fetchIdea(selectedIdeaId);
            fetchReplies(selectedIdeaId);
        }
    }, [selectedIdeaId]);

    const fetchIdea = async (id: string) => {
        try {
            const res = await fetch(`/api/ideas/${id}`);
            const data = await res.json();
            if (data.idea) setSelectedIdea(data.idea);
        } catch (err) {
            console.error('Failed to fetch idea:', err);
        } finally {
            setLoadingIdea(false);
        }
    };

    const fetchReplies = async (id: string) => {
        setLoadingReplies(true);
        try {
            const res = await fetch(`/api/ideas/${id}/replies`);
            const data = await res.json();
            if (data.replies) setReplies(data.replies);
        } catch (err) {
            console.error('Failed to fetch replies:', err);
        } finally {
            setLoadingReplies(false);
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            alert('Image too large (max 2MB)');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            setReplyImage(reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    const handleSendReply = async () => {
        if (!selectedIdeaId || sendingReply || (!newReply.trim() && !replyImage)) return;
        setSendingReply(true);
        try {
            const res = await fetch(`/api/ideas/${selectedIdeaId}/replies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    content: newReply.trim(), 
                    isPublic: replyIsPublic,
                    imageUrl: replyImage
                }),
            });
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            // Optimistically append to avoid triggering the full-screen loading spinner
            setReplies(prev => [...prev, {
                ...data.reply,
                username: session?.user?.name || myEmail?.split('@')[0],
            }]);
            setNewReply('');
            setReplyImage(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (err) {
            console.error('Failed to send reply:', err);
        } finally {
            setSendingReply(false);
        }
    };

    const handleToggleReplyVisibility = async (reply: Reply) => {
        if (togglingReplyId) return;
        setTogglingReplyId(reply._id);
        
        setReplies(prev => prev.map(r => r._id === reply._id ? { ...r, isPublic: !r.isPublic } : r));
        
        try {
            const res = await fetch(`/api/replies/${reply._id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isPublic: !reply.isPublic }),
            });
            if (!res.ok) throw new Error('Failed');
        } catch (err) {
            console.error('Failed to toggle reply visibility:', err);
            setReplies(prev => prev.map(r => r._id === reply._id ? { ...r, isPublic: reply.isPublic } : r));
        } finally {
            setTogglingReplyId(null);
        }
    };

    const handleDeleteReply = async (replyId: string) => {
        if (!confirm('Are you sure you want to delete this reply?')) return;
        setReplies(prev => prev.filter(r => r._id !== replyId));
        try {
            await fetch(`/api/replies/${replyId}`, { method: 'DELETE' });
        } catch (err) {
            console.error('Failed to delete reply:', err);
            fetchReplies(selectedIdeaId!);
        }
    };

    const handleSaveEdit = async (replyId: string) => {
        if (!editingContent.trim()) return;
        try {
            const res = await fetch(`/api/replies/${replyId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: editingContent.trim() }),
            });
            if (!res.ok) throw new Error('Failed to edit');
            setReplies(prev => prev.map(r => r._id === replyId ? { ...r, content: editingContent.trim(), isEdited: true, updatedAt: new Date().toISOString() } : r));
            setEditingReplyId(null);
            setEditingContent('');
        } catch (err) {
            console.error('Failed to save edit:', err);
        }
    };

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full">
                <div className="space-y-8 max-w-4xl">
                    {/* Back Button */}
                    <div className="flex items-center gap-4">
                        <Link href="/ideas" className="text-zinc-500 hover:text-white transition-colors duration-200 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full text-sm font-medium border border-white/10 flex items-center gap-2">
                            <span>←</span> Back to Ideas
                        </Link>
                    </div>

                    <div className="bg-black border border-white/10 rounded-3xl w-full flex flex-col overflow-hidden shadow-2xl">
                        {/* Discussion Body */}
                        <div className="flex-1 p-6 sm:p-8">
                            {/* Idea Header */}
                            {loadingIdea ? (
                                <div className="flex justify-center py-10">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white/40" />
                                </div>
                            ) : selectedIdea ? (
                                <div className="relative mb-10 group">
                                    {replies.length > 0 && (
                                        <div className="absolute left-6 top-14 bottom-[-40px] w-[1px] bg-gradient-to-b from-white/20 to-transparent z-0" />
                                    )}
                                    <div className="relative z-10 flex gap-4">
                                        <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/20 shadow-lg text-white font-bold text-lg">
                                            {(selectedIdea.username || 'A')[0].toUpperCase()}
                                        </div>
                                        <div className="flex-1 space-y-3">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-bold text-white tracking-tight">
                                                    @{selectedIdea.username || 'Anonymous'}
                                                </span>
                                                <span className="text-[11px] text-zinc-500">
                                                    {new Date(selectedIdea.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                </span>
                                                {selectedIdea.isPublic ? (
                                                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#4CAF50]/10 text-[#4CAF50] border border-[#4CAF50]/20">Public</span>
                                                ) : (
                                                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-zinc-900 text-zinc-500 border border-white/5">Private</span>
                                                )}
                                            </div>
                                            <h1 className="text-2xl font-bold text-white leading-tight">
                                                {selectedIdea.title}
                                            </h1>
                                            {selectedIdea.details && (
                                                <div className="text-[15px] text-white font-medium leading-relaxed bg-white/5 p-5 rounded-2xl border border-white/10 shadow-sm">
                                                    {selectedIdea.details}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-10 text-red-400">Idea not found.</div>
                            )}

                            {/* Replies List */}
                            <div className="space-y-8">
                                {loadingReplies ? (
                                    <div className="flex justify-center py-8">
                                        <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white/40" />
                                    </div>
                                ) : replies.length === 0 ? (
                                    <div className="text-center py-12 text-zinc-600 bg-white/5 rounded-3xl border border-white/10">
                                        <div className="text-3xl mb-3">💬</div>
                                        <p className="font-medium text-zinc-400">No replies yet</p>
                                        <p className="text-sm mt-1">Start the discussion below.</p>
                                    </div>
                                ) : (
                                    replies.map((reply, index) => (
                                        <div key={reply._id} className="relative pl-14 group">
                                            <div className="absolute left-6 top-[-30px] bottom-0 w-[1px] bg-white/10 z-0" />
                                            <div className="absolute left-6 top-6 w-6 h-[1px] bg-white/10 z-0" />
                                            {index === replies.length - 1 && (
                                                <div className="absolute left-6 top-6 bottom-0 w-[2px] bg-black z-10" />
                                            )}

                                            <div className="relative z-10 space-y-2.5">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-semibold text-white">
                                                            @{reply.username || 'Anonymous'}
                                                        </span>
                                                        <span className="text-[11px] text-zinc-600">
                                                            {new Date(reply.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                        {reply.isEdited && reply.updatedAt && (
                                                            <span className="text-[11px] text-zinc-500 italic ml-1 relative group/edited">
                                                                (edited)
                                                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-zinc-800 text-white text-[10px] rounded opacity-0 group-hover/edited:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-20">
                                                                    Edited {new Date(reply.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                                </span>
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Toggle Reply Visibility (Slider) */}
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[10px] font-medium tracking-wider uppercase ${reply.isPublic ? 'text-[#4CAF50]' : 'text-zinc-500'}`}>
                                                            {reply.isPublic ? 'Public' : 'Private'}
                                                        </span>
                                                        {Boolean(reply.isOwner) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleReplyVisibility(reply)}
                                                                disabled={togglingReplyId === reply._id}
                                                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                                                    reply.isPublic ? 'bg-[#4CAF50]' : 'bg-zinc-600'
                                                                } ${togglingReplyId === reply._id ? 'opacity-50' : ''}`}
                                                                role="switch"
                                                                aria-checked={reply.isPublic}
                                                            >
                                                                <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                                                    reply.isPublic ? 'translate-x-3' : 'translate-x-0'
                                                                }`} />
                                                            </button>
                                                        )}
                                                        {Boolean(reply.isOwner) && (
                                                            <>
                                                                <button
                                                                    onClick={() => { setEditingReplyId(reply._id); setEditingContent(reply.content); }}
                                                                    className="text-[11px] text-zinc-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100 ml-1"
                                                                >
                                                                    Edit
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteReply(reply._id)}
                                                                    className="text-[11px] text-zinc-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                                >
                                                                    Delete
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-white font-medium text-[15px] leading-relaxed bg-white/5 hover:bg-white/10 p-4 rounded-3xl rounded-tl-sm border border-white/10 transition-colors shadow-sm">
                                                    {editingReplyId === reply._id ? (
                                                        <div className="space-y-3">
                                                            <textarea
                                                                value={editingContent}
                                                                onChange={e => setEditingContent(e.target.value)}
                                                                className="w-full bg-black/50 border border-white/20 rounded-xl px-4 py-3 text-[15px] focus:border-white/40 outline-none resize-none font-normal"
                                                                rows={3}
                                                            />
                                                            <div className="flex justify-end gap-2">
                                                                <button onClick={() => setEditingReplyId(null)} className="text-xs px-3 py-1.5 rounded-full hover:bg-white/10 text-zinc-400 transition-colors">Cancel</button>
                                                                <button onClick={() => handleSaveEdit(reply._id)} disabled={!editingContent.trim()} className="text-xs px-4 py-1.5 rounded-full bg-white text-black font-bold disabled:opacity-50 transition-colors">Save</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {reply.content && <p className="whitespace-pre-wrap">{reply.content}</p>}
                                                            {reply.imageUrl && (
                                                                <div 
                                                                    className={`${reply.content ? 'mt-4' : ''} rounded-xl overflow-hidden border border-white/10 max-w-sm cursor-pointer relative group/img`}
                                                                    onClick={() => setZoomedImage(reply.imageUrl!)}
                                                                >
                                                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                                                        <span className="bg-black/60 text-white backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-medium">🔍 Zoom</span>
                                                                    </div>
                                                                    <img src={reply.imageUrl} alt="attached" className="w-full h-auto object-cover max-h-72" />
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Reply Input Box */}
                        <div className="p-6 sm:p-8 bg-black border-t border-white/[0.05]">
                            {session ? (
                                <div className="space-y-4">
                                    <div className="relative">
                                        <textarea
                                            value={newReply}
                                            onChange={e => setNewReply(e.target.value)}
                                            placeholder="Write a reply..."
                                            rows={3}
                                            className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-[15px] text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:bg-white/5 transition-colors resize-none shadow-inner"
                                        />
                                        <div className="absolute right-3 bottom-3 flex items-center gap-2">
                                            <input 
                                                type="file" 
                                                ref={fileInputRef} 
                                                onChange={handleImageChange} 
                                                accept="image/*" 
                                                className="hidden" 
                                            />
                                            <button 
                                                onClick={() => fileInputRef.current?.click()}
                                                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-400 hover:text-white transition-all duration-200 hover:scale-105 active:scale-95 group"
                                                title="Attach image"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80 group-hover:opacity-100 transition-opacity"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                                            </button>
                                        </div>
                                    </div>

                                    {replyImage && (
                                        <div className="relative w-32 h-32 rounded-2xl overflow-hidden border border-white/20 shadow-lg group shadow-black/50">
                                            <img src={replyImage} alt="Preview" className="w-full h-full object-cover" />
                                            <button 
                                                onClick={() => {
                                                    setReplyImage(null);
                                                    if (fileInputRef.current) fileInputRef.current.value = '';
                                                }}
                                                className="absolute inset-0 bg-red-500/20 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200"
                                            >
                                                <div className="bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg">✕</div>
                                            </button>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between pt-2">
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setReplyIsPublic(p => !p)}
                                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                                    replyIsPublic ? 'bg-[#4CAF50]' : 'bg-zinc-600'
                                                }`}
                                                role="switch"
                                                aria-checked={replyIsPublic}
                                            >
                                                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                                    replyIsPublic ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                            </button>
                                            <span className={`text-xs font-semibold tracking-wide ${replyIsPublic ? 'text-[#4CAF50]' : 'text-zinc-500'}`}>
                                                {replyIsPublic ? 'Public Reply' : 'Private Reply'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={handleSendReply}
                                            disabled={(!newReply.trim() && !replyImage) || sendingReply}
                                            className="px-6 py-2 rounded-full font-bold text-[15px] bg-white text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                                        >
                                            {sendingReply ? 'Posting...' : 'Post Reply'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center bg-white/5 p-6 rounded-2xl border border-white/5 text-zinc-500 text-sm">
                                    Please sign in to join the discussion.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* Global Lightbox for Image Zoom */}
            <AnimatePresence>
                {zoomedImage && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 sm:p-8 cursor-zoom-out"
                        onClick={() => setZoomedImage(null)}
                    >
                        <motion.img 
                            initial={{ scale: 0.95 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0.95 }}
                            src={zoomedImage} 
                            alt="Zoomed attachment" 
                            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl border border-white/10"
                        />
                        <button 
                            className="absolute top-6 right-6 text-white/50 hover:text-white bg-white/10 hover:bg-white/20 p-3 rounded-full transition-colors backdrop-blur-md"
                            onClick={(e) => {
                                e.stopPropagation();
                                setZoomedImage(null);
                            }}
                        >
                            ✕
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
