import { NextRequest, NextResponse } from 'next/server';
import { revokeMobileToken } from '@/lib/mobile-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (token) {
        await revokeMobileToken(token);
    }
    return NextResponse.json({ ok: true });
}
