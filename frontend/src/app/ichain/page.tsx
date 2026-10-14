'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { CreateChainModal } from '@/components/ichain/CreateChainModal';
import { ChainCard } from '@/components/ichain/ChainCard';
import { fetchWithCache, getCachedData, setCachedData } from '@/lib/client-cache';

export default function IChainPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const initialCached = getCachedData<{ chains?: any[] }>('/api/ichain');
    const [chains, setChains] = useState<any[]>(() => initialCached?.chains || []);
    const [isLoading, setIsLoading] = useState<boolean>(() => !initialCached);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'my' | 'all'>('my');

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const formatCreatedAt = (value?: string | Date) => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;

        return `${date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        })}, ${date.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        })}`;
    };

    const fetchChains = async () => {
        try {
            const data = await fetchWithCache<{ chains?: any[] }>('/api/ichain', {
                dedupingIntervalMs: 2000,
            });
            if (data.chains) {
                setChains(data.chains);
            }
        } catch (error) {
            console.error('Failed to fetch chains:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchChains();
        // Poll every 5 seconds for list view
        const interval = setInterval(fetchChains, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleChainCreated = (newChain: any) => {
        const updatedChains = [newChain, ...chains];
        // Sort by maxTime (or totalTime for new chain)
        updatedChains.sort((a, b) => (b.maxTime || b.totalTime || 0) - (a.maxTime || a.totalTime || 0));
        setChains(updatedChains);
        setCachedData('/api/ichain', { chains: updatedChains });
    };

    const handleChainDeleted = (chainId: string) => {
        const next = chains.filter(c => c._id !== chainId);
        setChains(next);
        setCachedData('/api/ichain', { chains: next });
    };

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full max-w-7xl mx-auto">
                <div className="space-y-12">
                    {/* Header Section */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                        <div className="space-y-2">
                            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">Chain</h1>
                            <p className="text-zinc-400 text-lg">Collaborative productivity chains where progress continues as long as someone is working.</p>
                        </div>
                        <LiquidButton 
                            onClick={() => setIsModalOpen(true)}
                            className="text-white font-bold h-12 px-8"
                        >
                            + Create Chain
                        </LiquidButton>
                    </div>

                    {/* Active Chains List */}
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <h2 className="text-xl font-semibold text-white">Active Chains</h2>
                            </div>
                            
                            {/* Tab Toggle */}
                            <div className="flex bg-white/5 border border-white/10 rounded-full p-1 w-fit mt-2 sm:mt-0">
                                <button
                                    onClick={() => setActiveTab('my')}
                                    className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${activeTab === 'my' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'}`}
                                >
                                    My Chains
                                </button>
                                <button
                                    onClick={() => setActiveTab('all')}
                                    className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${activeTab === 'all' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'}`}
                                >
                                    All Chains
                                </button>
                            </div>
                        </div>
                        
                        <div className="h-px w-full bg-white/10 hidden sm:block"></div>

                        {isLoading ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="bg-white/5 border border-white/10 rounded-2xl h-48 animate-pulse"></div>
                                ))}
                            </div>
                        ) : (() => {
                            const myChains = chains
                                .filter(chain => (chain.members || []).some((m: any) => m.userId === session?.user?.email))
                                .sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0));
                                
                            const displayChains = activeTab === 'my' ? myChains : chains;

                            if (displayChains.length === 0) {
                                return (
                                    <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center space-y-4">
                                        <p className="text-zinc-500 text-lg">
                                            {activeTab === 'my' ? "You aren't in any chains. Join one or start your own!" : "No chains found. Start a productivity chain with your team!"}
                                        </p>
                                        <LiquidButton onClick={() => setIsModalOpen(true)} variant="ghost" className="text-white border border-white/20">
                                            Create Your First Chain
                                        </LiquidButton>
                                    </div>
                                );
                            }

                            return activeTab === 'my' ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {displayChains.map((chain) => (
                                        <ChainCard 
                                            key={chain._id} 
                                            chain={chain} 
                                            onDelete={handleChainDeleted}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {displayChains.map((chain, index) => (
                                        <div 
                                            key={chain._id} 
                                            className="flex flex-col sm:flex-row sm:items-center justify-between bg-black border border-white/10 rounded-2xl p-5 hover:bg-white/5 transition-colors cursor-pointer gap-4" 
                                            onClick={() => router.push(`/ichain/${chain._id}`)}
                                        >
                                            <div className="flex items-center gap-4">
                                                <span className="text-2xl font-bold text-zinc-500 w-8">#{index + 1}</span>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="text-xl font-bold text-white">{chain.name}</h3>
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                navigator.clipboard.writeText(`${window.location.origin}/ichain/${chain._id}`);
                                                                alert('Invite link copied to clipboard!');
                                                            }}
                                                            className="p-1 text-zinc-500 hover:text-white transition-colors"
                                                            title="Copy Invite Link"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                    <p className="text-sm text-zinc-400">
                                                        {(chain.members || []).length} Members • Status: {chain.status === 'Burst' ? <span className="text-red-500 font-medium tracking-wide">Burst</span> : chain.status === 'Active' ? <span className="text-emerald-500 font-medium tracking-wide">Active</span> : <span className="text-amber-500 font-medium tracking-wide">Idle</span>}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-left sm:text-right">
                                                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Max Time</p>
                                                <p className="text-2xl font-mono text-white tracking-widest bg-white/5 px-4 py-2 rounded-lg border border-white/10 inline-block">
                                                    {formatTime(chain.maxTime || chain.totalTime || 0)}
                                                </p>
                                                {formatCreatedAt(chain.createdAt) && (
                                                    <p className="text-xs text-zinc-500 mt-2">
                                                        Created {formatCreatedAt(chain.createdAt)}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                </div>

                <CreateChainModal 
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)} 
                    onChainCreated={handleChainCreated}
                />
            </main>
        </div>
    );
}
