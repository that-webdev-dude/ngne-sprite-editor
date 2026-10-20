import { useEffect, useState } from "react";

/** Once idle, at the latest this long after the frames it waits for, a popover closes (ms). */
const LATEST_MS = 50;

/**
 * The draft a timeline popover shows (SE-061): `draft` itself while there is one, so a popover
 * opens and changes at once; when it ends, the last one until two animation frames have passed
 * and the main thread is idle, as the panel draws a change (`useShownTimeline`). A popover
 * closes when its values become a history step, and taking it down (React, Radix's focus,
 * scroll lock and `aria-hidden`) in the step's own microtasks would make the canvas miss the
 * two frames it has to show the step in (DESIGN §1, principle 3). The store has no draft
 * meanwhile: no command acts on the popover that is still shown.
 */
export function useClosingDraft<Draft>(draft: Draft | null): Draft | null {
    const [closing, setClosing] = useState<Draft | null>(null);
    const [last, setLast] = useState<Draft | null>(draft);
    // The draft that ended is kept while it closes; a new draft takes its place at once.
    if (draft !== null && last !== draft) {
        setLast(draft);
        if (closing !== null) setClosing(null);
    } else if (draft === null && last !== null) {
        setLast(null);
        setClosing(last);
    }
    useEffect(() => {
        if (closing === null) return;
        let idle: number | null = null;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                idle = requestIdleCallback(() => setClosing(null), { timeout: LATEST_MS });
            });
        });
        return () => {
            cancelAnimationFrame(frame);
            if (idle !== null) cancelIdleCallback(idle);
        };
    }, [closing]);
    return draft ?? closing;
}
