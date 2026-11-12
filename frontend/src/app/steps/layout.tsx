import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Step-by-step — Follow the work to the target',
    description:
        'Describe the whole procedure or the work you are going to do. infinWORK turns it into steps you follow until the target is complete.',
    alternates: {
        canonical: '/steps',
    },
};

export default function StepsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
