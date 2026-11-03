import type { ReactNode } from 'react';

function renderInline(text: string, keyPrefix: string): ReactNode[] {
    const tokens = text.split(
        /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*]+\*)/g
    );

    return tokens.map((token, index) => {
        const key = `${keyPrefix}-${index}`;

        if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
            return <strong key={key}>{token.slice(2, -2)}</strong>;
        }
        if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
            return (
                <code key={key} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]">
                    {token.slice(1, -1)}
                </code>
            );
        }
        const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(token);
        if (link) {
            return (
                <a
                    key={key}
                    href={link[2]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
                >
                    {link[1]}
                </a>
            );
        }
        if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
            return <em key={key}>{token.slice(1, -1)}</em>;
        }
        return <span key={key}>{token}</span>;
    });
}

/**
 * Small, safe Markdown renderer for ideas and replies.
 * Supports headings, bold, italic, inline code, fenced code, lists and https links.
 * Everything is rendered as React nodes, never dangerouslySetInnerHTML.
 */
export function MarkdownText({
    text,
    className = '',
}: {
    text?: string | null;
    className?: string;
}) {
    if (!text) return null;

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const blocks: ReactNode[] = [];
    let paragraph: string[] = [];
    let listItems: string[] = [];
    let codeLines: string[] = [];
    let inCode = false;

    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        const key = `p-${blocks.length}`;
        blocks.push(
            <p key={key} className="leading-relaxed">
                {paragraph.map((line, index) => (
                    <span key={`${key}-${index}`}>
                        {renderInline(line, `${key}-${index}`)}
                        {index < paragraph.length - 1 ? <br /> : null}
                    </span>
                ))}
            </p>
        );
        paragraph = [];
    };

    const flushList = () => {
        if (listItems.length === 0) return;
        const key = `ul-${blocks.length}`;
        blocks.push(
            <ul key={key} className="list-disc space-y-1 pl-5">
                {listItems.map((item, index) => (
                    <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
                ))}
            </ul>
        );
        listItems = [];
    };

    const flushCode = () => {
        if (codeLines.length === 0) return;
        blocks.push(
            <pre
                key={`pre-${blocks.length}`}
                className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-xs leading-relaxed text-zinc-200"
            >
                <code>{codeLines.join('\n')}</code>
            </pre>
        );
        codeLines = [];
    };

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            flushParagraph();
            flushList();
            if (inCode) {
                flushCode();
                inCode = false;
            } else {
                inCode = true;
            }
            continue;
        }

        if (inCode) {
            codeLines.push(line);
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }

        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
            flushParagraph();
            flushList();
            const level = heading[1].length;
            const key = `h-${blocks.length}`;
            const content = renderInline(heading[2], key);
            if (level === 1) {
                blocks.push(<h2 key={key} className="text-xl font-bold text-white">{content}</h2>);
            } else if (level === 2) {
                blocks.push(<h3 key={key} className="text-lg font-semibold text-white">{content}</h3>);
            } else {
                blocks.push(<h4 key={key} className="text-base font-semibold text-white">{content}</h4>);
            }
            continue;
        }

        const bullet = /^[-*]\s+(.*)$/.exec(line);
        if (bullet) {
            flushParagraph();
            listItems.push(bullet[1]);
            continue;
        }

        paragraph.push(line);
    }

    flushParagraph();
    flushList();
    flushCode();

    return <div className={`space-y-3 break-words ${className}`}>{blocks}</div>;
}
