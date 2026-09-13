'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { sameUserId } from '@/lib/user-identity';

interface ChainCardProps {
    chain: {
        _id: string;
        name: string;
        status: 'Active' | 'Idle' | 'Burst';
        totalTime: number;
        maxTime?: number;
        members: any[];
        burstAt?: number;
        createdBy?: string;
        createdAt?: string | Date;
    };
    rank?: number;
    onDelete?: (chainId: string) => void;
}

export function ChainCard({ chain, rank, onDelete }: ChainCardProps) {
    const { data: session } = useSession();
    const [isDeleting, setIsDeleting] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const activeMembers = (chain.members || []).filter(m => m.isWorking).length;
    
    const canDelete = !chain.createdBy || sameUserId(chain.createdBy, session?.user?.email);

    const handleDelete = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!confirm('Are you sure you want to delete this chain?')) return;

        setIsDeleting(true);
        try {
            const response = await fetch(`/api/ichain/${chain._id}`, {
                method: 'DELETE',
            });
            if (response.ok) {
                onDelete?.(chain._id);
            }
        } catch (error) {
            console.error('Failed to delete chain:', error);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleShare = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const url = `${window.location.origin}/ichain/${chain._id}`;
        navigator.clipboard.writeText(url);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };
    
    const statusColors = {
        Active: 'text-green-500 border-green-500/30 bg-green-500/10',
        Idle: 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10',
        Burst: 'text-red-500 border-red-500/30 bg-red-500/10',
    };

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const formatCreatedAt = (value?: string | Date) => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;

        return {
            date: date.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
            }),
            time: date.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            }),
        };
    };

    const createdAt = formatCreatedAt(chain.createdAt);

    return (
        <Link href={`/ichain/${chain._id}`}>
            <motion.div
                whileHover={{ y: -4, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className={`bg-black border border-white/10 rounded-2xl p-6 hover:border-white/20 transition-all cursor-pointer group relative overflow-hidden ${chain.status === 'Burst' ? 'shake-subtle' : ''}`}
            >
                {/* Rank Badge */}
                {rank && (
                    <div className="absolute top-0 right-0 z-20">
                        <div className={`
                            px-3 py-1 rounded-bl-xl font-bold text-[10px] uppercase tracking-widest
                            ${rank === 1 ? 'bg-yellow-500 text-black' : 
                              rank === 2 ? 'bg-zinc-300 text-black' : 
                              rank === 3 ? 'bg-amber-700 text-white' : 'bg-white/10 text-zinc-400'}
                        `}>
                            Rank #{rank}
                        </div>
                    </div>
                )}
                {/* Glow effect based on status */}
                <div className={`absolute -inset-0.5 rounded-2xl blur opacity-0 group-hover:opacity-20 transition-opacity duration-500 ${
                    chain.status === 'Active' ? 'bg-green-500' : 
                    chain.status === 'Idle' ? 'bg-yellow-500' : 'bg-red-500'
                }`}></div>

                <div className="relative z-10 space-y-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-xl font-bold text-white group-hover:text-white/90 transition-colors">
                                    {chain.name}
                                </h3>
                                {chain.createdAt && Date.now() - new Date(chain.createdAt).getTime() < 72 * 60 * 60 * 1000 && (
                                    <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">
                                        New
                                    </span>
                                )}
                                <button
                                    onClick={handleShare}
                                    className="p-1 text-zinc-500 hover:text-white transition-colors"
                                    title="Share Chain"
                                >
                                    {isCopied ? (
                                        <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : (
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                        </svg>
                                    )}
                                </button>
                                {canDelete && (
                                    <button
                                        onClick={handleDelete}
                                        disabled={isDeleting}
                                        className="p-1 text-zinc-500 hover:text-red-500 transition-colors"
                                        title="Delete Chain"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border mt-2 ${statusColors[chain.status]}`}>
                                {chain.status}
                            </div>
                            {createdAt && (
                                <div className="mt-2 text-[11px] text-zinc-500">
                                    Created {createdAt.date}, {createdAt.time}
                                </div>
                            )}
                        </div>
                        <div className="text-right">
                            <span className="block text-[10px] uppercase tracking-wider font-semibold text-zinc-500">Total Chain Time</span>
                            <span className="text-2xl font-mono font-bold text-white">
                                {formatTime(chain.totalTime)}
                            </span>
                        </div>
                    </div>

                    <div className="pt-4 border-t border-white/10 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="flex -space-x-2">
                                {(chain.members || []).slice(0, 3).map((member, i) => (
                                    <div key={i} className="w-8 h-8 rounded-full border-2 border-black bg-white/10 flex items-center justify-center text-[10px] text-white overflow-hidden">
                                        {member.image ? <img src={member.image} alt="" /> : (member.name || '?')[0]}
                                    </div>
                                ))}
                                {(chain.members || []).length > 3 && (
                                    <div className="w-8 h-8 rounded-full border-2 border-black bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400">
                                        +{(chain.members || []).length - 3}
                                    </div>
                                )}
                            </div>
                            <span className="text-xs text-zinc-400">
                                {activeMembers} / {(chain.members || []).length} Active
                            </span>
                        </div>
                        
                        {chain.status === 'Burst' && (
                            <div className="text-[10px] text-red-500 font-bold uppercase tracking-tighter animate-pulse">
                                Burst
                            </div>
                        )}
                    </div>
                </div>

                <style jsx global>{`
                    @keyframes shake {
                        0%, 100% { transform: translateX(0); }
                        25% { transform: translateX(-1px); }
                        75% { transform: translateX(1px); }
                    }
                    .shake-subtle {
                        animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) infinite;
                        animation-play-state: paused;
                    }
                    .group:hover .shake-subtle {
                        animation-play-state: running;
                    }
                `}</style>
            </motion.div>
        </Link>
    );
}
