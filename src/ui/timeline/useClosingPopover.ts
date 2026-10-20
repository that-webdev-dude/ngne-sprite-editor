import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Once idle, at the latest this long after the frames it waits for, a popover goes (ms). */
const LATEST_MS = 50;
/** The mark Radix's `hideOthers` puts beside `aria-hidden` (and `inertOutsideModalLayers` reads). */
const HIDDEN_MARK = "data-aria-hidden";

export interface ClosingPopover<Draft> {
    /** The draft to show: the store's, or the last one while the popover is taken down. */
    shown: Draft | null;
    /**
     * A key for the popover's content: a popover that opens while the last one is still on the
     * screen is a new content, modal again (Radix sets that up when the content mounts).
     */
    opening: number;
    /** The popover's content element (Radix `Content`'s ref). */
    contentRef: RefObject<HTMLDivElement | null>;
    /** Set by the popover's `onOpenAutoFocus` to the element that had the focus. */
    returnToRef: RefObject<Element | null>;
}

/**
 * The life of a modal timeline popover around its close (SE-061 and its review, A).
 *
 * A popover closes when its values become a history step, and taking it down (React, Radix's
 * focus trap, scroll lock and `aria-hidden`, the page's `inert`) in that step's microtasks made
 * the canvas miss the two animation frames it has to show the step in (DESIGN §1, principle 3).
 * So its content stays mounted until two animation frames have passed and the main thread is
 * idle, as the panel draws a change (`useShownTimeline`).
 *
 * But what the next key or press acts on follows at once (DESIGN §5.6). In the commit that
 * closes it the popover stops being modal by hand: the page's `aria-hidden` and `inert` marks
 * and the body's `pointer-events` lock that Radix set are taken off, and the focused field of
 * the popover lets go of the focus. Before the next key or press is handled (a capturing
 * listener on the window), or with the unmount, the content becomes `inert` and no longer an
 * open dialog for the keymap, and the focus goes back to the element that had it when the
 * popover opened, or to `fallback` when that is gone (a menu item). Radix's own clean-up at the
 * unmount then finds nothing left to undo, and its focus return a task later is prevented by
 * the popover (`onCloseAutoFocus`). Radix's focus trap cannot pull the focus back into the
 * closed content: nothing there is focused, and once inert nothing can be. While the closed
 * content is on the screen its layer still handles Escape (an Escape pressed in those frames
 * closes nothing and reaches nothing) and still blocks the wheel outside it (Radix's scroll
 * lock).
 */
export function useClosingPopover<Draft>(
    draft: Draft | null,
    fallback: () => void,
): ClosingPopover<Draft> {
    const contentRef = useRef<HTMLDivElement | null>(null);
    const returnToRef = useRef<Element | null>(null);
    const [closed, setClosed] = useState<Draft | null>(null);
    const [last, setLast] = useState<Draft | null>(draft);
    const [opening, setOpening] = useState(0);
    // The draft that ended is kept while it closes; a new draft takes its place at once.
    // The pass that sees the draft end shows it too. React renders the host again at once with
    // the state set here, and the memos of the second pass compare with the first: a null
    // shown in the first gave the popover a new anchor, which Radix positioned again in a task
    // of its own between the history step and its frames (the canvas lost a frame on CI).
    let shown = draft ?? closed;
    if (draft !== null && last !== draft) {
        setLast(draft);
        if (closed !== null) {
            setClosed(null);
            setOpening(opening + 1);
        }
    } else if (draft === null && last !== null) {
        setLast(null);
        setClosed(last);
        shown = last;
    }

    // The close, in its own commit: the page takes presses again and the focus leaves the
    // popover. Only what a press needs at once is done here (each change restyles the page,
    // and in the step's microtasks that costs the canvas its frame, measured in the review);
    // the rest waits for the next key or press, or for the unmount (`finish`).
    const finishRef = useRef<(() => void) | null>(null);
    useLayoutEffect(() => {
        if (closed === null) return;
        for (const node of document.querySelectorAll<HTMLElement>(`[${HIDDEN_MARK}]`)) {
            node.removeAttribute("aria-hidden");
            node.removeAttribute(HIDDEN_MARK);
            node.inert = false;
        }
        document.body.style.pointerEvents = "";
        const content = contentRef.current;
        const focused = document.activeElement;
        // The next key goes to the page, not to a field of the closed popover.
        if (focused instanceof HTMLElement && content?.contains(focused)) focused.blur();
        const target = returnToRef.current;
        returnToRef.current = null;
        const events = ["keydown", "pointerdown", "mousedown"] as const;
        const finish = () => {
            if (finishRef.current !== finish) return;
            finishRef.current = null;
            for (const type of events) window.removeEventListener(type, finish, true);
            if (content) {
                // No more an open dialog for the keymap (`OVERLAY_SELECTOR`), nor a target.
                content.setAttribute("data-state", "closed");
                const layer = content.closest<HTMLElement>("[data-radix-popper-content-wrapper]");
                (layer ?? content).inert = true;
            }
            if (document.activeElement && document.activeElement !== document.body) return;
            if (target instanceof HTMLElement && target.isConnected) {
                target.focus({ preventScroll: true });
            } else {
                fallback();
            }
        };
        finishRef.current = finish;
        // Capture on the window: before the keymap and the tools hear the event.
        for (const type of events) window.addEventListener(type, finish, true);
    }, [closed, fallback]);

    // The unmount, after the canvas has had its frames.
    useEffect(() => {
        if (closed === null) return;
        let idle: number | null = null;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                idle = requestIdleCallback(
                    () => {
                        finishRef.current?.();
                        setClosed(null);
                    },
                    { timeout: LATEST_MS },
                );
            });
        });
        return () => {
            cancelAnimationFrame(frame);
            if (idle !== null) cancelIdleCallback(idle);
        };
    }, [closed]);

    return { shown, opening, contentRef, returnToRef };
}
