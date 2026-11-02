'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import type { PublicProfile, ProfileProject } from '@/types/profile';
import type { GithubContributionCalendar } from '@/types/github-contributions';
import { getContributionLevel } from '@/lib/github-contributions';
import { sanitizeProjects, isValidHttpUrl } from '@/lib/profile-utils';
import { cn } from '@/lib/utils';

const emptyProject = (): ProfileProject => ({
    title: '',
    description: '',
    siteUrl: '',
    githubUrl: '',
    technologies: [],
});

function GithubIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3 .405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
    );
}

function LinkIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <p className="folio-mono mb-5 text-xs tracking-widest folio-accent-text">{'// '}{children}</p>;
}

function ProjectCard({ project, index }: { project: ProfileProject; index: number }) {
    const initial = project.title.charAt(0).toUpperCase() || '#';
    const isLive = !!project.siteUrl?.trim();

    return (
        <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, delay: index * 0.06 }}
            className="folio-card group flex flex-col overflow-hidden rounded-xl border"
        >
            <div className="folio-card-strip relative h-1.5 w-full" />
            <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="folio-icon flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-bold">
                            {initial}
                        </div>
                        <h3 className="text-base font-semibold">{project.title || 'Untitled project'}</h3>
                    </div>
                    {isLive && (
                        <span className="folio-badge folio-mono rounded px-2 py-0.5 text-[10px] tracking-wider">LIVE</span>
                    )}
                </div>

                {project.description && (
                    <p className="folio-muted mt-3 line-clamp-3 text-sm leading-relaxed">{project.description}</p>
                )}

                {!!project.technologies?.length && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                        {project.technologies.slice(0, 6).map((tech) => (
                            <span key={tech} className="folio-chip folio-mono rounded border px-2 py-0.5 text-[10px]">
                                {tech}
                            </span>
                        ))}
                    </div>
                )}

                <div className="folio-divider mt-5 flex items-center gap-3 border-t pt-4">
                    {project.siteUrl && (
                        <a
                            href={project.siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="folio-link inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
                        >
                            <LinkIcon className="h-3.5 w-3.5" /> Live site
                        </a>
                    )}
                    {project.githubUrl && (
                        <a
                            href={project.githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="folio-link inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
                        >
                            <GithubIcon className="h-3.5 w-3.5" /> Repo
                        </a>
                    )}
                    {!project.siteUrl && !project.githubUrl && (
                        <span className="folio-muted text-xs">No links yet</span>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

function EditableProjectCard({
    project,
    index,
    techInput,
    onChange,
    onRemove,
    onTechInput,
    onAddTech,
    onRemoveTech,
}: {
    project: ProfileProject;
    index: number;
    techInput: string;
    onChange: (patch: Partial<ProfileProject>) => void;
    onRemove: () => void;
    onTechInput: (v: string) => void;
    onAddTech: () => void;
    onRemoveTech: (tech: string) => void;
}) {
    const initial = project.title.charAt(0).toUpperCase() || '+';

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="folio-card group flex flex-col overflow-hidden rounded-xl border"
        >
            <div className="folio-card-strip relative h-1.5 w-full" />
            <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="folio-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold">
                            {initial}
                        </div>
                        <input
                            value={project.title}
                            onChange={(e) => onChange({ title: e.target.value })}
                            placeholder="Project name"
                            className="folio-edit-input min-w-0 flex-1 bg-transparent text-base font-semibold outline-none"
                        />
                    </div>
                    <button type="button" onClick={onRemove} className="folio-link folio-mono cursor-pointer shrink-0 text-[10px]">
                        REMOVE
                    </button>
                </div>
                <textarea
                    value={project.description || ''}
                    onChange={(e) => onChange({ description: e.target.value })}
                    placeholder="Short description"
                    rows={2}
                    className="folio-edit-input folio-muted mt-3 w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input
                        value={project.siteUrl || ''}
                        onChange={(e) => onChange({ siteUrl: e.target.value })}
                        placeholder="https://yoursite.com"
                        className="folio-edit-field rounded-lg border px-3 py-2 text-xs outline-none"
                    />
                    <input
                        value={project.githubUrl || ''}
                        onChange={(e) => onChange({ githubUrl: e.target.value })}
                        placeholder="github.com/you/repo"
                        className="folio-edit-field rounded-lg border px-3 py-2 text-xs outline-none"
                    />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {(project.technologies || []).map((tech) => (
                        <button
                            key={tech}
                            type="button"
                            onClick={() => onRemoveTech(tech)}
                            className="folio-chip folio-mono cursor-pointer rounded border px-2 py-0.5 text-[10px]"
                        >
                            {tech} ×
                        </button>
                    ))}
                </div>
                <div className="mt-2 flex gap-2">
                    <input
                        value={techInput}
                        onChange={(e) => onTechInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onAddTech())}
                        placeholder="React, Next.js…"
                        className="folio-edit-field min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs outline-none"
                    />
                    <button type="button" onClick={onAddTech} className="folio-btn-ghost folio-mono cursor-pointer rounded-lg border px-3 text-[10px]">
                        TAG
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

const LEVEL_CLASSES = ['folio-heat-0', 'folio-heat-1', 'folio-heat-2', 'folio-heat-3', 'folio-heat-4'];

function GithubHeatmap({ calendar, username }: { calendar: GithubContributionCalendar; username: string }) {
    const monthLabels = useMemo(() => {
        const labels: { label: string; index: number }[] = [];
        let lastMonth = -1;
        calendar.weeks.forEach((week, weekIndex) => {
            for (const day of week.days) {
                if (!day?.date) continue;
                const month = new Date(`${day.date}T00:00:00Z`).getUTCMonth();
                if (month !== lastMonth) {
                    labels.push({
                        label: new Date(`${day.date}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
                        index: weekIndex,
                    });
                    lastMonth = month;
                    break;
                }
            }
        });
        return labels;
    }, [calendar.weeks]);

    return (
        <div className="folio-card rounded-xl border p-5 md:p-6">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <h3 className="text-sm font-semibold">
                    {calendar.totalContributions.toLocaleString()} contributions in the last year
                </h3>
                <a
                    href={`https://github.com/${username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="folio-link folio-mono text-xs"
                >
                    @{username}
                </a>
            </div>

            <div className="overflow-x-auto pb-1">
                <div className="min-w-[680px]">
                    <div className="folio-mono relative mb-2 h-4">
                        {monthLabels.map((month) => (
                            <span
                                key={`${month.label}-${month.index}`}
                                className="folio-muted absolute text-[10px]"
                                style={{ left: `${month.index * 14}px` }}
                            >
                                {month.label}
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-[3px]">
                        {calendar.weeks.map((week, weekIndex) => (
                            <div key={weekIndex} className="flex flex-col gap-[3px]">
                                {Array.from({ length: 7 }).map((_, dayIndex) => {
                                    const day = week.days.find(
                                        (d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === dayIndex
                                    );
                                    if (!day) {
                                        return <div key={dayIndex} className="h-[11px] w-[11px]" />;
                                    }
                                    const level = getContributionLevel(day.count);
                                    return (
                                        <div
                                            key={day.date}
                                            title={`${day.count} contributions on ${day.date}`}
                                            className={cn('h-[11px] w-[11px] rounded-sm', LEVEL_CLASSES[level])}
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="folio-muted folio-mono mt-4 flex items-center justify-end gap-1 text-[10px]">
                <span>Less</span>
                {LEVEL_CLASSES.map((cls, i) => (
                    <div key={i} className={cn('h-[11px] w-[11px] rounded-sm', cls)} />
                ))}
                <span>More</span>
            </div>
        </div>
    );
}

interface PortfolioViewProps {
    profile: PublicProfile;
    isOwner: boolean;
    editMode?: boolean;
    githubCalendar: GithubContributionCalendar | null;
    githubLoading: boolean;
    githubHidden: boolean;
    onConnectGithub?: () => void;
    onHideGithub?: () => void;
    onShowGithub?: () => void;
    onProfileSaved?: (profile: PublicProfile) => void;
}

export function PortfolioView({
    profile,
    isOwner,
    editMode = false,
    githubCalendar,
    githubLoading,
    githubHidden,
    onConnectGithub,
    onHideGithub,
    onShowGithub,
    onProfileSaved,
}: PortfolioViewProps) {
    const [headline, setHeadline] = useState(profile.headline || '');
    const [bio, setBio] = useState(profile.bio || '');
    const [projects, setProjects] = useState<ProfileProject[]>(profile.projects || []);
    const [showGithubContributions, setShowGithubContributions] = useState(profile.showGithubContributions !== false);
    const [techInputs, setTechInputs] = useState<Record<number, string>>({});
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const savingRef = useRef(false);
    // Snapshot that failed to save. Prevents the 2s auto-save effect from
    // retrying the exact same payload forever after a 401/500.
    const failedSnapshotRef = useRef<string | null>(null);

    useEffect(() => {
        if (!editMode || dirty) return;
        setHeadline(profile.headline || '');
        setBio(profile.bio || '');
        setProjects(profile.projects || []);
        setShowGithubContributions(profile.showGithubContributions !== false);
    }, [profile, editMode, dirty]);

    const displayProfile = editMode
        ? { ...profile, headline, bio, projects, showGithubContributions }
        : profile;

    const initial = displayProfile.username.charAt(0).toUpperCase();
    const memberYear = displayProfile.memberSince ? new Date(displayProfile.memberSince).getFullYear() : '—';

    const topTech = useMemo(() => {
        const counts = new Map<string, number>();
        displayProfile.projects.forEach((p) => (p.technologies || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 6);
    }, [displayProfile.projects]);

    const liveCount = displayProfile.projects.filter((p) => p.siteUrl?.trim()).length;
    const repoCount = displayProfile.projects.filter((p) => p.githubUrl?.trim()).length;
    const techCount = new Set(displayProfile.projects.flatMap((p) => p.technologies || [])).size;

    const stats = [
        { label: 'Products Built', value: displayProfile.projects.filter((p) => p.title.trim()).length },
        { label: 'GitHub Commits', value: displayProfile.githubCommitsTotal || 0 },
        { label: 'Infinwork Points', value: displayProfile.points || 0 },
        { label: 'Live Sites', value: liveCount },
        { label: 'Repos Linked', value: repoCount },
        { label: 'Tech in Stack', value: techCount },
    ];

    const showGithubBoard =
        !!displayProfile.githubUsername && displayProfile.showGithubContributions !== false && !githubHidden;

    const markDirty = () => editMode && setDirty(true);

    const updateProject = (index: number, patch: Partial<ProfileProject>) => {
        markDirty();
        setProjects((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    };

    const addProject = () => {
        markDirty();
        setProjects((prev) => [...prev, emptyProject()]);
    };

    const removeProject = (index: number) => {
        markDirty();
        setProjects((prev) => prev.filter((_, i) => i !== index));
        setTechInputs((prev) => {
            const next = { ...prev };
            delete next[index];
            return next;
        });
    };

    const addTech = (index: number) => {
        const raw = techInputs[index]?.trim();
        if (!raw) return;
        markDirty();
        const techs = raw.split(',').map((t) => t.trim()).filter(Boolean);
        updateProject(index, {
            technologies: [...new Set([...(projects[index]?.technologies || []), ...techs])].slice(0, 8),
        });
        setTechInputs((prev) => ({ ...prev, [index]: '' }));
    };

    const handleSave = useCallback(async () => {
        if (savingRef.current) return;

        for (const project of projects) {
            if (project.siteUrl?.trim() && !isValidHttpUrl(project.siteUrl)) {
                setMessage('Invalid site URL — use a full link like https://yoursite.com');
                return;
            }
            if (project.githubUrl?.trim() && !isValidHttpUrl(project.githubUrl)) {
                setMessage('Invalid GitHub URL — use a full link like github.com/you/repo');
                return;
            }
        }

        const hasDraftProject = projects.some(
            (p) =>
                !p.title.trim() &&
                (p.description?.trim() || p.siteUrl?.trim() || p.githubUrl?.trim() || (p.technologies?.length ?? 0) > 0)
        );
        if (hasDraftProject) {
            setMessage('Add a project title before saving');
            return;
        }

        const sanitized = sanitizeProjects(projects);

        const saveSnapshot = JSON.stringify({ headline, bio, projects, showGithubContributions });
        savingRef.current = true;
        setSaving(true);
        setMessage('');
        try {
            const res = await fetch('/api/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ headline, bio, projects: sanitized, showGithubContributions }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            onProfileSaved?.(data.profile);
            setHeadline(data.profile?.headline || headline);
            setBio(data.profile?.bio || bio);
            setProjects(data.profile?.projects || sanitized);
            failedSnapshotRef.current = null;
            setDirty(false);
            setMessage('Saved');
            setTimeout(() => setMessage(''), 2500);
        } catch (err: unknown) {
            failedSnapshotRef.current = saveSnapshot;
            setMessage(err instanceof Error ? err.message : 'Save failed');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }, [headline, bio, projects, showGithubContributions, onProfileSaved]);

    useEffect(() => {
        if (!editMode || !dirty || saving) return;

        // Do not hammer the API with the same failing payload. A new edit
        // changes the snapshot and re-arms auto-save.
        const currentSnapshot = JSON.stringify({ headline, bio, projects, showGithubContributions });
        if (failedSnapshotRef.current === currentSnapshot) return;

        const timer = setTimeout(() => {
            void handleSave();
        }, 2000);
        return () => clearTimeout(timer);
    }, [editMode, dirty, saving, headline, bio, projects, showGithubContributions, handleSave]);

    return (
        <div className="folio relative min-h-full">
            <div className="folio-bg pointer-events-none absolute inset-0" />

            <div className="relative z-10 mx-auto max-w-6xl space-y-16 pb-24">
                <div className="folio-divider flex items-center justify-between border-b pb-5 pt-1">
                    <div className="flex items-center gap-3">
                        {!editMode && (
                            <Link href="/profiles" className="folio-link folio-mono text-xs">
                                ← /profiles
                            </Link>
                        )}
                        <span className="folio-muted folio-mono text-xs">
                            {displayProfile.username}.os
                        </span>
                    </div>
                    {editMode ? (
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className={cn(
                                'folio-cta folio-mono cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium',
                                dirty && 'ring-2 ring-offset-2 ring-[var(--folio-accent)]'
                            )}
                        >
                            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                        </button>
                    ) : isOwner ? (
                        <Link href="/profile" className="folio-cta folio-mono rounded-full px-4 py-1.5 text-xs font-medium">
                            Edit Profile
                        </Link>
                    ) : displayProfile.githubUsername ? (
                        <a
                            href={`https://github.com/${displayProfile.githubUsername}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="folio-cta folio-mono rounded-full px-4 py-1.5 text-xs font-medium"
                        >
                            Let&apos;s Connect ●
                        </a>
                    ) : null}
                </div>

                <AnimatePresence>
                    {editMode && message && (
                        <motion.p
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="folio-mono folio-accent-text -mt-10 text-xs"
                        >
                            {message}
                        </motion.p>
                    )}
                </AnimatePresence>

                <section className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
                    <motion.div
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="flex flex-col justify-center"
                    >
                        <p className="folio-mono folio-accent-text folio-cursor mb-6 text-xs tracking-widest">
                            {editMode ? '>_ EDITING LIVE PROFILE...' : '>_ INITIALIZING PROFILE...'}
                        </p>
                        <div className="flex items-start gap-4">
                            <div className="folio-avatar h-14 w-14 shrink-0 overflow-hidden rounded-xl border">
                                {displayProfile.image ? (
                                    <img src={displayProfile.image} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center text-xl font-bold">{initial}</div>
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="folio-muted folio-mono text-xs">@{displayProfile.username}</p>
                                {editMode ? (
                                    <>
                                        <input
                                            value={headline}
                                            onChange={(e) => { setHeadline(e.target.value); markDirty(); }}
                                            placeholder="FULL-STACK BUILDER · SHIPPING FAST"
                                            maxLength={120}
                                            className="folio-edit-headline folio-headline mt-1 w-full bg-transparent text-2xl font-extrabold uppercase leading-[1.05] tracking-tight outline-none md:text-4xl"
                                        />
                                        <textarea
                                            value={bio}
                                            onChange={(e) => { setBio(e.target.value); markDirty(); }}
                                            placeholder="What you build, what you care about, what you're working on next."
                                            maxLength={500}
                                            rows={3}
                                            className="folio-edit-input folio-muted mt-4 w-full resize-none bg-transparent text-sm leading-relaxed outline-none md:text-base"
                                        />
                                    </>
                                ) : (
                                    <>
                                        <h1 className="folio-headline mt-1 text-3xl font-extrabold uppercase leading-[1.05] tracking-tight md:text-5xl">
                                            {displayProfile.headline || 'Builder shipping real products.'}
                                        </h1>
                                        {displayProfile.bio && (
                                            <p className="folio-muted mt-6 max-w-xl text-sm leading-relaxed md:text-base">{displayProfile.bio}</p>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {!editMode && (
                            <div className="mt-8 flex flex-wrap items-center gap-3">
                                {liveCount > 0 && displayProfile.projects.find((p) => p.siteUrl) && (
                                    <a
                                        href={displayProfile.projects.find((p) => p.siteUrl)!.siteUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="folio-cta folio-mono inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold"
                                    >
                                        Explore Work →
                                    </a>
                                )}
                                {displayProfile.githubUsername && (
                                    <a
                                        href={`https://github.com/${displayProfile.githubUsername}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="folio-btn-ghost inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium"
                                    >
                                        <GithubIcon className="h-4 w-4" /> GitHub
                                    </a>
                                )}
                            </div>
                        )}
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                        className="space-y-4"
                    >
                        <div className="folio-card rounded-xl border p-5">
                            <div className="folio-divider mb-4 flex items-center justify-between border-b pb-3">
                                <span className="folio-mono text-xs tracking-widest">BUILDER PULSE</span>
                                <span className="folio-accent-text folio-mono inline-flex items-center gap-1.5 text-[10px]">
                                    <span className="folio-dot h-1.5 w-1.5 rounded-full" /> LIVE
                                </span>
                            </div>
                            <div className="space-y-4">
                                <div className="flex items-end justify-between">
                                    <span className="folio-muted folio-mono text-xs">INFINWORK POINTS</span>
                                    <span className="folio-accent-text text-2xl font-bold tabular-nums">
                                        {(displayProfile.points || 0).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex items-end justify-between">
                                    <span className="folio-muted folio-mono text-xs">PROJECTS SHIPPED</span>
                                    <span className="text-xl font-semibold tabular-nums">
                                        {displayProfile.projects.filter((p) => p.title.trim()).length}
                                    </span>
                                </div>
                                <div className="flex items-end justify-between">
                                    <span className="folio-muted folio-mono text-xs">MEMBER SINCE</span>
                                    <span className="text-xl font-semibold tabular-nums">{memberYear}</span>
                                </div>
                            </div>
                        </div>

                        <div className="folio-card rounded-xl border p-5">
                            <p className="folio-mono mb-3 text-xs tracking-widest">STACK INSIGHT</p>
                            {topTech.length ? (
                                <>
                                    <p className="folio-muted text-sm">Key strength in</p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {topTech.map((t) => (
                                            <span key={t} className="folio-chip folio-mono rounded border px-2 py-0.5 text-[11px]">
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className="folio-muted text-sm">
                                    {editMode ? 'Add tech tags to projects below.' : 'Add tech tags to your projects to surface your stack.'}
                                </p>
                            )}
                        </div>
                    </motion.div>
                </section>

                <section>
                    <div className="flex items-end justify-between gap-4">
                        <SectionLabel>FEATURED PROJECTS</SectionLabel>
                        {editMode && (
                            <button
                                type="button"
                                onClick={addProject}
                                className="folio-btn-ghost folio-mono mb-5 cursor-pointer rounded-lg border px-3 py-1.5 text-xs"
                            >
                                + ADD
                            </button>
                        )}
                    </div>
                    {editMode ? (
                        projects.length === 0 ? (
                            <button
                                type="button"
                                onClick={addProject}
                                className="folio-card w-full cursor-pointer rounded-xl border border-dashed p-12 text-center"
                            >
                                <p className="folio-muted text-sm">No projects yet — click to add your first</p>
                            </button>
                        ) : (
                            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                                <AnimatePresence mode="popLayout">
                                    {projects.map((project, i) => (
                                        <EditableProjectCard
                                            key={i}
                                            project={project}
                                            index={i}
                                            techInput={techInputs[i] || ''}
                                            onChange={(patch) => updateProject(i, patch)}
                                            onRemove={() => removeProject(i)}
                                            onTechInput={(v) => setTechInputs((prev) => ({ ...prev, [i]: v }))}
                                            onAddTech={() => addTech(i)}
                                            onRemoveTech={(tech) => updateProject(i, {
                                                technologies: (project.technologies || []).filter((t) => t !== tech),
                                            })}
                                        />
                                    ))}
                                </AnimatePresence>
                            </div>
                        )
                    ) : displayProfile.projects.length === 0 ? (
                        <div className="folio-card rounded-xl border border-dashed p-12 text-center">
                            <p className="folio-muted text-sm">No projects shared yet.</p>
                        </div>
                    ) : (
                        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                            {displayProfile.projects.map((project, i) => (
                                <ProjectCard key={project._id || `${project.title}-${i}`} project={project} index={i} />
                            ))}
                        </div>
                    )}
                </section>

                <section>
                    <SectionLabel>DASHBOARD OVERVIEW</SectionLabel>
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {stats.map((stat) => (
                            <div key={stat.label} className="folio-card rounded-xl border p-4">
                                <p className="folio-accent-text text-2xl font-bold tabular-nums">
                                    {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                                </p>
                                <p className="folio-muted folio-mono mt-1 text-[10px] leading-tight tracking-wide">
                                    {stat.label}
                                </p>
                            </div>
                        ))}
                    </div>

                    {editMode && (
                        <label className="folio-card mt-4 flex cursor-pointer items-center justify-between rounded-xl border p-4">
                            <span className="folio-mono text-xs">SHOW GITHUB BOARD ON PORTFOLIO</span>
                            <input
                                type="checkbox"
                                checked={showGithubContributions}
                                onChange={(e) => { setShowGithubContributions(e.target.checked); markDirty(); }}
                                className="h-4 w-4 cursor-pointer accent-[var(--folio-accent)]"
                            />
                        </label>
                    )}

                    <div className="mt-6">
                        {showGithubBoard ? (
                            githubLoading ? (
                                <div className="folio-card flex justify-center rounded-xl border p-10">
                                    <div className="folio-spinner h-8 w-8 animate-spin rounded-full border-2" />
                                </div>
                            ) : githubCalendar && displayProfile.githubUsername ? (
                                <GithubHeatmap calendar={githubCalendar} username={displayProfile.githubUsername} />
                            ) : (
                                <div className="folio-card rounded-xl border p-8 text-center">
                                    <p className="folio-muted text-sm">Could not load GitHub contributions right now.</p>
                                </div>
                            )
                        ) : !displayProfile.githubUsername && (isOwner || editMode) ? (
                            <div className="folio-card rounded-xl border border-dashed p-8 text-center">
                                <p className="folio-muted text-sm">Connect GitHub to display your contribution board.</p>
                                <button
                                    type="button"
                                    onClick={onConnectGithub}
                                    className="folio-btn-ghost folio-mono mt-4 cursor-pointer rounded-lg border px-5 py-2 text-sm"
                                >
                                    Connect GitHub
                                </button>
                            </div>
                        ) : (displayProfile.showGithubContributions === false || githubHidden) && (isOwner || editMode) ? (
                            <div className="folio-card flex flex-col gap-4 rounded-xl border p-6 sm:flex-row sm:items-center sm:justify-between">
                                <p className="folio-muted text-sm">GitHub board hidden from visitors.</p>
                                <button
                                    type="button"
                                    onClick={onShowGithub}
                                    className="folio-btn-ghost folio-mono cursor-pointer rounded-lg border px-4 py-2 text-sm"
                                >
                                    Show GitHub
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {!editMode && isOwner && showGithubBoard && (
                        <div className="mt-3 text-right">
                            <button
                                type="button"
                                onClick={onHideGithub}
                                className="folio-link folio-mono cursor-pointer text-xs"
                            >
                                Hide GitHub board
                            </button>
                        </div>
                    )}
                </section>

                <footer className="folio-divider flex flex-col items-center justify-between gap-3 border-t pt-8 sm:flex-row">
                    <p className="folio-muted folio-mono text-xs">
                        © {new Date().getFullYear()} {displayProfile.username} · built on Infinwork
                    </p>
                    {!editMode && (
                        <Link href="/profiles" className="folio-link folio-mono text-xs">
                            Discover more builders →
                        </Link>
                    )}
                </footer>
            </div>

            {editMode && dirty && (
                <motion.div
                    initial={{ y: 80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 md:hidden"
                >
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="folio-cta folio-mono cursor-pointer rounded-full px-6 py-3 text-sm shadow-lg"
                    >
                        {saving ? 'Saving…' : 'Save changes'}
                    </button>
                </motion.div>
            )}
        </div>
    );
}
