import { useEffect, useRef } from "react";
import { VIEWPORT_FOCUS_ATTRIBUTE } from "../../app/keymap/environment";
import { REGION_FOCUS_ATTRIBUTE } from "../../app/keymap/regions";
import { attachViewNavigation } from "../../app/view/pointerNavigation";
import { returnFocusToViewport } from "../focus/returnFocus";
import { OverlayCanvas } from "./OverlayCanvas";
import { ViewportCanvas } from "./ViewportCanvas";
import "./toolPointer.css";
import "./viewportArea.css";

/** Marks the viewport element. */
export const VIEWPORT_ATTRIBUTE = "data-viewport";

const MARKS = {
    [VIEWPORT_ATTRIBUTE]: "",
    // SPEC §7.8: only this element counts as "the viewport itself is focused".
    [VIEWPORT_FOCUS_ATTRIBUTE]: "",
    // F6 enters the viewport region here.
    [REGION_FOCUS_ATTRIBUTE]: "",
};

/**
 * The viewport element (SE-012, DESIGN §6): the focusable container of the editing viewport.
 * It holds the element the NGNE viewport fills with its canvas and, as its second child, the
 * overlay canvas of SE-013: a sibling of that element, never inside it.
 *
 * Keyboard focus, the F6 focus region and the pointer listeners of view navigation are on
 * this element and not on a canvas: NGNE replaces its canvas at every resize. Wheel and
 * middle-drag act by pointer location, whatever has focus (`app/view/pointerNavigation`);
 * their events reach this element from the overlay, the pointer target, by bubbling. While it
 * is on the page, a control activated with the pointer returns the focus to it (SE-014).
 */
export function ViewportArea() {
    const element = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!element.current) return;
        return attachViewNavigation(element.current);
    }, []);

    // SPEC §7.8: a control activated with the pointer gives the focus back to this element.
    useEffect(() => {
        if (!element.current) return;
        return returnFocusToViewport(element.current);
    }, []);

    return (
        <div
            ref={element}
            className="viewport-area"
            tabIndex={0}
            // A pointer surface with keys of its own, not a control a screen reader operates
            // (DESIGN §8); the name says what has focus.
            role="application"
            aria-label="Canvas"
            {...MARKS}
        >
            <ViewportCanvas />
            <OverlayCanvas />
        </div>
    );
}
