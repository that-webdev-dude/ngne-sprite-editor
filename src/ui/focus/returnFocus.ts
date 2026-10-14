import { isTextField, OVERLAY_SELECTOR, TIMELINE_SELECTOR } from "../../app/keymap/environment";
import type { FocusedElement } from "../../app/keymap/environment";

// A focus rule of SPEC §7.8 (SE-014): activating a non-text control outside the timeline with
// the pointer — a tool button, a swatch, a toggle, a splitter — returns the focus to the
// viewport afterwards, so the `canvas` keys act at once. Keyboard activation leaves the focus
// where it is.
//
// Not returned: a text or number field, which keeps the focus to be typed in; a control in
// the timeline, where a click keeps the focus; a control inside an open menu, dialog,
// popover or list, which manage their own focus; a control that opens one of those
// (`aria-haspopup`, a select); and anything inside `[data-keep-focus]`, for a later control
// that must keep it. The focus moves only when the control still has it once its click has
// run: a control that sent the focus elsewhere (a dialog it opened) is left alone.

/** Elements a pointer activates. */
export const CONTROL_SELECTOR = [
    "button",
    "input",
    "select",
    "summary",
    "a[href]",
    ...["button", "checkbox", "switch", "radio", "tab", "slider", "separator", "option"].map(
        (role) => `[role="${role}"]`,
    ),
].join(", ");

/** Controls that open a surface of their own, which takes the focus. */
export const OPENS_SURFACE_SELECTOR =
    '[aria-haspopup]:not([aria-haspopup="false"]), [role="combobox"], select';

/** Opts a control or a region out of the rule. */
export const KEEP_FOCUS_ATTRIBUTE = "data-keep-focus";

/** The part of an element the rule reads; DOM elements and test doubles both fit. */
export interface ControlElement extends FocusedElement {
    closest(selector: string): ControlElement | null;
    matches(selector: string): boolean;
}

/**
 * The control whose pointer activation returns the focus to the viewport, for a pointer
 * press on `target`; null when the press is on no such control.
 */
export function focusReturningControl(target: ControlElement | null): ControlElement | null {
    const control = target?.closest(CONTROL_SELECTOR) ?? null;
    if (!control || isTextField(control)) return null;
    if (control.matches(OPENS_SURFACE_SELECTOR)) return null;
    if (control.closest(TIMELINE_SELECTOR) !== null) return null;
    if (control.closest(OVERLAY_SELECTOR) !== null) return null;
    if (control.closest(`[${KEEP_FOCUS_ATTRIBUTE}]`) !== null) return null;
    return control;
}

/**
 * Applies the rule while `viewport`, the focusable viewport element, is on the page. Returns
 * the function that stops it.
 */
export function returnFocusToViewport(viewport: HTMLElement): () => void {
    let pressed: { control: Element; pointerId: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onPointerDown = (event: PointerEvent) => {
        pressed = null;
        if (event.button !== 0 && event.button !== 2) return;
        const target = event.target instanceof Element ? event.target : null;
        const control = focusReturningControl(target);
        if (control instanceof Element && !viewport.contains(control)) {
            pressed = { control, pointerId: event.pointerId };
        }
    };

    const onPointerUp = (event: PointerEvent) => {
        const press = pressed;
        pressed = null;
        if (press?.pointerId !== event.pointerId) return;
        clearTimeout(timer);
        // After the click that follows the release, and whatever the control did in it.
        timer = setTimeout(() => {
            const active = document.activeElement;
            if (!active || !press.control.contains(active)) return;
            if (!viewport.isConnected || document.querySelector(OVERLAY_SELECTOR)) return;
            viewport.focus({ preventScroll: true });
        }, 0);
    };

    const onPointerCancel = () => {
        pressed = null;
    };

    // In the capture phase: a control that stops its pointer events still counts.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
        clearTimeout(timer);
        window.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("pointercancel", onPointerCancel, true);
    };
}
