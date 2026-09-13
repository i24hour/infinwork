'use client';

import { useState, useEffect, use } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { ChainNode } from '@/components/ichain/ChainNode';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function ChainDetailPage({ params }: { params: Promise<{ chainId: string }> }) {
    const { chainId } = use(params);
    const { data: session, update: updateSession } = useSession();
    const router = useRouter();
    const [chain, setChain] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
    const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
    const [newMemberIdentifier, setNewMemberIdentifier] = useState('');
    const [isAddingMember, setIsAddingMember] = useState(false);
    const [isLightTheme, setIsLightTheme] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const root = document.documentElement;
        const syncTheme = () => setIsLightTheme(root.getAttribute('data-theme') === 'light');

        syncTheme();
        const observer = new MutationObserver(syncTheme);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    const handleAddMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMemberIdentifier || !chain) return;

        setIsAddingMember(true);
        try {
            const response = await fetch(`/api/ichain/${chainId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    newMemberIdentifier,
                    parentId: selectedParentId 
                }),
            });

            if (response.ok) {
                const data = await response.json();
                setChain(data.chain);
                setIsAddMemberModalOpen(false);
                setNewMemberIdentifier('');
                alert('Member added successfully!');
            } else {
                const data = await response.json();
                alert(data.error || 'Failed to add member');
            }
        } catch (error) {
            console.error('Failed to add member:', error);
            alert('An error occurred while adding member');
        } finally {
            setIsAddingMember(false);
        }
    };

    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Simple size check (2MB limit for Base64 storage)
        if (file.size > 2 * 1024 * 1024) {
            alert('Image size should be less than 2MB');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64String = reader.result as string;
            try {
                const response = await fetch('/api/user/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64String }),
                });

                if (response.ok) {
                    // Update local state to reflect new image immediately
                    setChain((prevChain: any) => {
                        if (!prevChain) return prevChain;
                        const newMembers = prevChain.members.map((m: any) => {
                            if (m.userId === session?.user?.email) {
                                return { ...m, image: base64String };
                            }
                            return m;
                        });
                        return { ...prevChain, members: newMembers };
                    });
                    
                    // Update session if possible to reflect in Sidebar
                    if (updateSession) {
                        await updateSession({
                            ...session,
                            user: {
                                ...session?.user,
                                image: base64String
                            }
                        });
                    }
                    
                    alert('Profile image updated successfully!');
                } else {
                    const data = await response.json();
                    alert(data.error || 'Failed to update image');
                }
            } catch (error) {
                console.error('Failed to upload image:', error);
                alert('An error occurred during upload.');
            }
        };
        reader.readAsDataURL(file);
    };

    const fetchChain = async () => {
        try {
            const response = await fetch(`/api/ichain/${chainId}`);
            if (response.ok) {
                const data = await response.json();
                setChain(data.chain);
            }
        } catch (error) {
            console.error('Failed to fetch chain details:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleWorkStatus = async (isStarting: boolean) => {
        if (!chain) return;
        try {
            const response = await fetch(`/api/ichain/${chainId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isWorking: isStarting }),
            });
            if (response.ok) {
                const data = await response.json();
                setChain(data.chain);
            }
        } catch (error) {
            console.error('Failed to toggle work status:', error);
        }
    };

    useEffect(() => {
        fetchChain();
        const interval = setInterval(fetchChain, 5000); // Poll server every 5s for sync
        
        // Client-side ticker for smooth real-time update
        const ticker = setInterval(() => {
            setChain((prevChain: any) => {
                if (!prevChain || prevChain.status !== 'Active') return prevChain;
                
                const now = Date.now();
                const newChain = { ...prevChain };
                
                // Update totalTime
                if (newChain.lastStartedAt) {
                    const elapsed = Math.floor((now - newChain.lastStartedAt) / 1000);
                    if (elapsed > 0) {
                        newChain.totalTime += elapsed;
                        newChain.lastStartedAt = now;
                    }
                }
                
                // Update members' contributionTime
                newChain.members = newChain.members.map((member: any) => {
                    if (member.isWorking && member.lastStartedAt) {
                        const mElapsed = Math.floor((now - member.lastStartedAt) / 1000);
                        if (mElapsed > 0) {
                            return {
                                ...member,
                                contributionTime: member.contributionTime + mElapsed,
                                lastStartedAt: now
                            };
                        }
                    }
                    return member;
                });
                
                return newChain;
            });
        }, 1000);

        return () => {
            clearInterval(interval);
            clearInterval(ticker);
        };
    }, [chainId]);

    if (isLoading) {
        return (
            <div className="flex flex-col md:flex-row min-h-screen bg-black">
                <Sidebar />
                <div className="flex-1 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white/50"></div>
                </div>
            </div>
        );
    }

    if (!chain) {
        return (
            <div className="flex flex-col md:flex-row min-h-screen bg-black">
                <Sidebar />
                <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                    <p className="text-zinc-500">Chain not found.</p>
                    <Link href="/ichain">
                        <LiquidButton className="text-white">Go Back</LiquidButton>
                    </Link>
                </div>
            </div>
        );
    }

    const myMemberInfo = chain.members.find((m: any) => m.userId === session?.user?.email);
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

    // Recursive component to render the tree
    const renderNodeTree = (parentId: string | null = null) => {
        const children = chain.members.filter((m: any) => m.parentId === parentId || (!m.parentId && parentId === null && m.userId === chain.createdBy));
        
        // If it's the root call and we didn't find the creator by parentId, 
        // handle cases where parentId might be missing or different for legacy data
        const roots = parentId === null ? 
            chain.members.filter((m: any) => !m.parentId || !chain.members.find((p: any) => p.userId === m.parentId)) :
            chain.members.filter((m: any) => m.parentId === parentId);

        return roots.map((node: any) => (
            <ChainNode
                key={node.userId}
                member={node}
                isCurrentUser={node.userId === session?.user?.email}
                onImageClick={() => fileInputRef.current?.click()}
                onNodeClick={() => {
                    if (node.userId !== session?.user?.email) {
                        router.push(`/workers/${encodeURIComponent(node.userId)}`);
                    }
                }}
                onAddMember={chain.status === 'Burst' ? undefined : (pid) => {
                    setSelectedParentId(pid);
                    setIsAddMemberModalOpen(true);
                }}
            >
                {/* Find actual children of this node */}
                {chain.members.some((m: any) => m.parentId === node.userId) && (
                    <div className="flex gap-16 mt-8">
                        {chain.members
                            .filter((m: any) => m.parentId === node.userId)
                            .map((child: any) => renderNodeTree(node.userId))}
                    </div>
                )}
            </ChainNode>
        ));
    };

    const getStarterMembers = () => {
        const explicitStarters = chain.members.filter((m: any) => m.isStarter);
        if (explicitStarters.length > 0) {
            return explicitStarters;
        }

        const creator = chain.members.find((m: any) => m.userId === chain.createdBy) || chain.members[0];
        if (!creator) {
            return [];
        }

        const initialPartner = chain.members.find((m: any) => m.userId !== creator.userId && m.parentId === creator.userId)
            || chain.members.find((m: any) => m.userId !== creator.userId);

        return initialPartner ? [creator, initialPartner] : [creator];
    };

    const renderChainTree = (parentId: string | null = null, depth: number = 0) => {
        const starterMembers = getStarterMembers();
        const starterIds = new Set(starterMembers.map((m: any) => m.userId));
        let membersAtThisLevel: any[] = [];

        if (parentId === null) {
            membersAtThisLevel = starterMembers;
        } else {
            membersAtThisLevel = chain.members.filter((m: any) => m.parentId === parentId && !starterIds.has(m.userId));
        }

        if (membersAtThisLevel.length === 0) return null;

        return (
            <div className="relative flex flex-col items-center">
                {/* Horizontal line connecting siblings/starters */}
                {membersAtThisLevel.length > 1 && (
                    <div className={`absolute top-0 left-0 right-0 h-0 border-t-2 border-dashed ${isLightTheme ? 'border-zinc-400/80' : 'border-white/45'}`}
                         style={{ 
                             left: `${100 / (membersAtThisLevel.length * 2)}%`, 
                             right: `${100 / (membersAtThisLevel.length * 2)}%` 
                         }} 
                    />
                )}
                
                <div className="flex gap-12 md:gap-24">
                    {membersAtThisLevel.map((member: any) => (
                        <div key={member.userId} className="relative flex flex-col items-center">
                            {/* Vertical line from sibling horizontal line to node (only if not at absolute top) */}
                            {parentId !== null && (
                                <div className={`w-0 h-8 mb-4 border-l-2 border-dashed ${isLightTheme ? 'border-zinc-400/80' : 'border-white/45'}`} />
                            )}
                            {/* Special case: if we have multiple starters at level 0, we still want a small line connecting them to the horizontal line above */}
                            {parentId === null && membersAtThisLevel.length > 1 && (
                                <div className={`w-0 h-8 mb-4 border-l-2 border-dashed ${isLightTheme ? 'border-zinc-400/80' : 'border-white/45'}`} />
                            )}
                            
                            <ChainNode
                                member={member}
                                isCurrentUser={member.userId === session?.user?.email}
                                onImageClick={() => fileInputRef.current?.click()}
                                onNodeClick={() => {
                                    if (member.userId !== session?.user?.email) {
                                        router.push(`/workers/${encodeURIComponent(member.userId)}`);
                                    }
                                }}
                                onAddMember={chain.status === 'Burst' ? undefined : (pid) => {
                                    setSelectedParentId(pid);
                                    setIsAddMemberModalOpen(true);
                                }}
                            >
                                {renderChainTree(member.userId, depth + 1)}
                            </ChainNode>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-black">
            <Sidebar />
            <main className="flex-1 p-4 md:p-8 pt-20 md:pt-8 w-full max-w-7xl mx-auto flex flex-col overflow-hidden">
                {/* Header Detail */}
                <div className="flex flex-col sm:flex-row items-start justify-between gap-6 mb-12">
                    <div className="space-y-4">
                        <Link href="/ichain" className="text-zinc-500 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                            Back to Chains
                        </Link>
                        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">{chain.name}</h1>
                        <div className="flex items-center gap-4">
                            <div className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest border ${
                                chain.status === 'Active' ? 'text-green-500 border-green-500/30 bg-green-500/10' :
                                chain.status === 'Idle' ? 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10' :
                                'text-red-500 border-red-500/30 bg-red-500/10'
                            }`}>
                                {chain.status}
                            </div>
                            {chain.whatsappLink && (
                                <a 
                                    href={chain.whatsappLink} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-green-500 hover:text-green-400 text-sm flex items-center gap-2 font-semibold"
                                >
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.484 8.412 0 6.556-5.338 11.892-11.893 11.892-1.997-.001-3.951-.499-5.688-1.447l-6.309 1.656zm6.223-4.76c1.543.917 3.011 1.403 4.626 1.405 5.235 0 9.493-4.258 9.495-9.493 0-2.535-1.011-5.045-2.847-6.88-1.84-1.84-4.146-2.853-6.647-2.853-5.236 0-9.493 4.256-9.496 9.493 0 1.613.404 3.206 1.326 4.706l-1.035 3.774 3.578-.952zm12.734-6.783c-.027-.447-.13-.767-.327-.927-.197-.16-.508-.24-.93-.24-.423 0-.69.091-.84.21-.15.12-.224.316-.224.587 0 .27.06.467.18.59.12.123.367.22.74.29.373.07.644.113.81.13.167.017.37.067.611.15.241.083.424.167.55.25z"/></svg>
                                    WhatsApp
                                </a>
                            )}
                        </div>
                        {formatCreatedAt(chain.createdAt) && (
                            <p className="text-xs text-zinc-500">
                                Created {formatCreatedAt(chain.createdAt)}
                            </p>
                        )}
                        <p className="text-xs text-zinc-500 max-w-xl">
                            Timer rule: every 3-hour block requires at least one visit to this chain page. Missing a visit stops the running member. If everyone stops, the chain auto-bursts.
                        </p>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-end min-w-[240px]">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 mb-2">Total Chain Life</span>
                        <div className="text-5xl font-mono font-bold text-white tracking-tighter">
                            {formatTime(chain.totalTime)}
                        </div>
                        {chain.status === 'Burst' && chain.burstAt && (
                            <span className="text-[10px] text-red-500 font-bold mt-2 uppercase">Burst at {new Date(chain.burstAt).toLocaleTimeString()}</span>
                        )}
                    </div>
                </div>

                {/* Chain Visual Tree View */}
                <div className="flex-1 overflow-auto py-12 px-4 scrollbar-hide min-h-[500px]">
                    <div className="flex justify-center min-w-max">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleImageUpload}
                            accept="image/*"
                            className="hidden"
                        />
                        {renderChainTree(null)}
                    </div>
                </div>

                {/* Add Member Modal */}
                {isAddMemberModalOpen && (
                    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm ${isLightTheme ? 'bg-black/45' : 'bg-black/80'}`}>
                        <div className={`border rounded-3xl p-8 w-full max-w-md shadow-2xl ${isLightTheme ? 'bg-white border-black/10' : 'bg-zinc-900 border-white/10'}`}>
                            <h3 className={`text-2xl font-bold mb-6 ${isLightTheme ? 'text-zinc-900' : 'text-white'}`}>Add Member</h3>
                            <form onSubmit={handleAddMember} className="space-y-6">
                                <div>
                                    <label className={`block text-[10px] uppercase tracking-widest font-bold mb-2 ${isLightTheme ? 'text-zinc-600' : 'text-zinc-500'}`}>Member Email or Username</label>
                                    <input
                                        type="text"
                                        value={newMemberIdentifier}
                                        onChange={(e) => setNewMemberIdentifier(e.target.value)}
                                        placeholder="e.g. priyanshu or member@example.com"
                                        className={`w-full border rounded-2xl px-5 py-4 focus:outline-none transition-all ${isLightTheme
                                            ? 'bg-zinc-50 border-zinc-300 text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-400'
                                            : 'bg-black/50 border-white/10 text-white placeholder:text-zinc-700 focus:border-white/20'
                                            }`}
                                        required
                                        autoFocus
                                    />
                                </div>
                                <div className="flex gap-4">
                                    <button
                                        type="button"
                                        onClick={() => setIsAddMemberModalOpen(false)}
                                        className={`flex-1 px-6 py-4 rounded-2xl border font-bold transition-all ${isLightTheme
                                            ? 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                                            : 'border-white/10 text-white hover:bg-white/5'
                                            }`}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isAddingMember}
                                        className={`flex-1 px-6 py-4 rounded-2xl font-bold disabled:opacity-50 transition-all ${isLightTheme
                                            ? 'bg-zinc-900 hover:bg-zinc-700'
                                            : 'bg-white text-black hover:bg-zinc-200'
                                            }`}
                                        style={isLightTheme ? { color: '#f8fafc' } : undefined}
                                    >
                                        {isAddingMember ? 'Adding...' : 'Add Member'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Personal Control Section */}
                <div className="mt-auto border-t border-white/10 pt-12 pb-8 flex flex-col items-center gap-6">
                    {myMemberInfo ? (
                        <>
                            <div className="text-center">
                                <h3 className="text-xl font-bold text-white mb-2">My Contribution</h3>
                                <p className="text-3xl font-mono text-zinc-300">{formatTime(myMemberInfo.contributionTime)}</p>
                            </div>
                            
                            {chain.status !== 'Burst' ? (
                                <div className="flex gap-4">
                                    {myMemberInfo.isWorking ? (
                                        <LiquidButton 
                                            onClick={() => toggleWorkStatus(false)}
                                            className="px-12 py-5 text-white font-bold text-xl rounded-2xl bg-red-600/20 hover:bg-red-600/40 border-red-500/50"
                                        >
                                            Stop Working
                                        </LiquidButton>
                                    ) : (
                                        <LiquidButton 
                                            onClick={() => toggleWorkStatus(true)}
                                            className="px-12 py-5 text-white font-bold text-xl rounded-2xl bg-green-600/20 hover:bg-green-600/40 border-green-500/50"
                                        >
                                            Start Working
                                        </LiquidButton>
                                    )}
                                </div>
                            ) : (
                                <div className="text-red-500 font-bold uppercase tracking-widest text-center">
                                    <p className="text-2xl mb-1">Chain Burst</p>
                                    <p className="text-xs opacity-50">Everyone stopped working</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="text-zinc-500 italic">You are not a member of this chain</p>
                    )}
                </div>
            </main>
        </div>
    );
}
