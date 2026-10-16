'use client';

import { useEffect } from 'react';

export function PwaRegister() {
    useEffect(() => {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
            console.error('Service worker registration failed:', error);
        });
    }, []);

    return null;
}
