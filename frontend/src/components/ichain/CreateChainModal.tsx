'use client';

import { useState, useEffect } from 'react';
import { LiquidButton } from '@/components/ui/liquid-glass-button';

interface CreateChainModalProps {
    isOpen: boolean;
    onClose: () => void;
    onChainCreated: (chain: any) => void;
}

export function CreateChainModal({ isOpen, onClose, onChainCreated }: CreateChainModalProps) {
    const [name, setName] = useState('');
    const [memberInput, setMemberInput] = useState('');
    const [suggestions, setSuggestions] = useState<{ username?: string; image?: string | null }[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [members, setMembers] = useState<string[]>([]);
    const [whatsappLink, setWhatsappLink] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCheckingMember, setIsCheckingMember] = useState(false);
    const [memberError, setMemberError] = useState('');

    useEffect(() => {
        if (!isOpen) return;

        const fetchSuggestions = async () => {
            const query = memberInput.trim();
            if (!query) {
                setSuggestions([]);
                setShowSuggestions(false);
                return;
            }

            try {
                const res = await fetch(`/api/user/search?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.users && data.users.length > 0) {
                        setSuggestions(data.users);
                        setShowSuggestions(true);
                    } else {
                        setShowSuggestions(false);
                    }
                }
            } catch (error) {
                console.error("Error fetching suggestions", error);
            }
        };

        const timeoutId = setTimeout(fetchSuggestions, 300);
        return () => clearTimeout(timeoutId);
    }, [memberInput, isOpen]);

    if (!isOpen) return null;

    const handleAddMember = async () => {
        const identifier = memberInput.trim();
        if (!identifier) return;

        setMemberError('');
        if (members.includes(identifier)) {
            setMemberError('Member already added.');
            return;
        }

        setIsCheckingMember(true);
        try {
            const response = await fetch(`/api/user/lookup?identifier=${encodeURIComponent(identifier)}`);
            const data = await response.json();

            if (!response.ok || !data.exists) {
                setMemberError('User not found in database.');
                return;
            }

            setMembers([...members, identifier]);
            setMemberInput('');
        } catch (error) {
            console.error('Error checking member:', error);
            setMemberError('Unable to verify user right now.');
        } finally {
            setIsCheckingMember(false);
        }
    };

    const removeMember = (identifier: string) => {
        setMembers(members.filter(m => m !== identifier));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // The API always adds the creator, so a solo chain is valid.
        if (!name) return;

        setIsSubmitting(true);
        try {
            const response = await fetch('/api/ichain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    members,
                    whatsappLink,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                onChainCreated(data.chain);
                onClose();
                // Reset form
                setName('');
                setMembers([]);
                setWhatsappLink('');
                setMemberError('');
            } else {
                const data = await response.json();
                setMemberError(data.error || 'Failed to create chain');
            }
        } catch (error) {
            console.error('Error creating chain:', error);
            setMemberError('Failed to create chain. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div 
                className="bg-black border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-white/10 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white">Create New Chain</h2>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Chain Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. IIT Study Squad"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/20 transition-colors"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Add Members (Email or Username)</label>
                        <div className="flex gap-2 relative">
                            <input
                                type="text"
                                value={memberInput}
                                onChange={(e) => setMemberInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddMember())}
                                onFocus={() => memberInput.trim() && setShowSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                placeholder="priyanshu or member@example.com"
                                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/20 transition-colors"
                            />
                            <LiquidButton type="button" onClick={handleAddMember} size="sm" className="px-4" disabled={isCheckingMember}>
                                {isCheckingMember ? 'Checking...' : 'Add'}
                            </LiquidButton>
                            
                            {showSuggestions && suggestions.length > 0 && (
                                <div className="absolute top-[calc(100%+0.5rem)] left-0 right-0 bg-zinc-900 border border-white/10 rounded-xl overflow-hidden z-50 shadow-2xl max-h-48 overflow-y-auto">
                                    {suggestions.map((suggestion, index) => {
                                        const identifier = suggestion.username;
                                        if (!identifier) return null;
                                        return (
                                            <div
                                                key={index}
                                                className="px-4 py-3 hover:bg-white/10 cursor-pointer flex justify-between items-center transition-colors border-b border-white/5 last:border-0"
                                                onClick={() => {
                                                    setMemberError('');
                                                    if (!members.includes(identifier)) {
                                                        setMembers([...members, identifier]);
                                                    } else {
                                                        setMemberError('Member already added.');
                                                    }
                                                    setMemberInput('');
                                                    setShowSuggestions(false);
                                                }}
                                            >
                                                <div className="flex flex-col">
                                                    <span className="text-white text-sm font-medium">{suggestion.username}</span>
                                                </div>
                                                <div className="text-xs text-zinc-400 bg-white/5 px-2 py-1 rounded">Add</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        {memberError && (
                            <p className="text-xs text-red-400 mt-2">{memberError}</p>
                        )}
                        
                        <div className="flex flex-wrap gap-2 mt-3">
                            {members.map(identifier => (
                                <div key={identifier} className="bg-white/10 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-2 border border-white/10">
                                    <span>{identifier}</span>
                                    <button type="button" onClick={() => removeMember(identifier)} className="text-zinc-400 hover:text-white">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">WhatsApp Group Link (Optional)</label>
                        <input
                            type="url"
                            value={whatsappLink}
                            onChange={(e) => setWhatsappLink(e.target.value)}
                            placeholder="https://chat.whatsapp.com/..."
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/20 transition-colors"
                        />
                    </div>

                    <div className="pt-4">
                        <LiquidButton 
                            type="submit" 
                            className="w-full py-4 text-white font-bold"
                            disabled={isSubmitting || isCheckingMember || !name}
                        >
                            {isSubmitting ? 'Creating...' : 'Create Chain'}
                        </LiquidButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
