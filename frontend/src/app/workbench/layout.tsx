import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Workbench — Compile work into impact',
    description:
        'A work compiler for people who care about impact per hour. Give any piece of work its own protocol: impact, proof, time box, and kill criteria.',
    alternates: {
        canonical: '/workbench',
    },
};

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
    return children;
}
