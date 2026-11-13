'use client';

import dynamic from 'next/dynamic';

// Neither is needed for first paint: the palette opens on a shortcut and the
// install prompt only appears after the browser fires its install event.
const CommandPalette = dynamic(() => import('./CommandPalette').then((m) => m.CommandPalette), { ssr: false });
const InstallPrompt = dynamic(() => import('./InstallPrompt').then((m) => m.InstallPrompt), { ssr: false });

export function LazyGlobals() {
    return (
        <>
            <CommandPalette />
            <InstallPrompt />
        </>
    );
}
