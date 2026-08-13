import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The two Beautiful UI atoms its components import but the site does not
 * publish, reimplemented against the same props so the vendored files can be
 * taken verbatim.
 *
 * Both are deliberately thin. They exist to satisfy an import, and every visual
 * decision in them belongs to the tokens and keyframes in `beautiful-ui.css` —
 * if either grows a colour of its own, the theme has stopped being the single
 * place that decides how this library looks.
 */

/**
 * Text under a moving highlight, for a label attached to work in progress.
 *
 * The gradient is painted on the text itself with `background-clip: text`,
 * which is why the colour is transparent — a foreground colour here would
 * cover the animation completely.
 */
export function Shimmer({ children, className = '' }: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <span
            className={`bg-clip-text text-transparent ${className}`}
            style={{
                backgroundImage:
                    'linear-gradient(90deg, var(--color-ink-3) 35%, var(--color-ink) 50%, var(--color-ink-3) 65%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer-text 1.4s linear infinite',
            }}
        >
            {children}
        </span>
    );
}

/**
 * Reveal text a word at a time.
 *
 * `onProgress` fires on every tick because the caller uses it to keep a
 * position marker attached to text that is still growing; a single `onDone`
 * would leave that marker behind for the whole reveal.
 *
 * The callbacks are held in refs rather than listed as effect dependencies. A
 * parent that passes an inline arrow — which is how every call site here writes
 * it — would otherwise get a new function identity on each render, restarting
 * the interval and freezing the reveal on its first word.
 */
export function StreamText({ text, speed = 26, onProgress, onDone }: {
    text: string;
    speed?: number;
    onProgress?: () => void;
    onDone?: () => void;
}) {
    const [shown, setShown] = useState(0);
    const progressRef = useRef(onProgress);
    const doneRef = useRef(onDone);

    progressRef.current = onProgress;
    doneRef.current = onDone;

    const words = text.split(' ');

    useEffect(() => {
        setShown(0);
        const id = setInterval(() => {
            setShown(n => {
                if (n >= words.length) {
                    clearInterval(id);
                    doneRef.current?.();
                    return n;
                }
                progressRef.current?.();
                return n + 1;
            });
        }, speed);
        return () => clearInterval(id);
    }, [text, speed, words.length]);

    return <>{words.slice(0, shown).join(' ')}</>;
}
