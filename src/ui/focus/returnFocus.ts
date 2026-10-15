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
//
// A select (Radix Select, `role="combobox"`) is activated in two steps: opened, then a choice
// made in its list, after which the list gives the focus back to the select. Opened with the
// pointer and chosen with the pointer, it is a pointer activation: once the list has gone and
// the select has the focus again, the focus moves on to the viewport. Opened or chosen with
// the keyboard, it keeps the focus.

/** Elements a pointer activates; a `gridcell` is a palette swatch (SE-016). */
export const CONTROL_SELECTOR = [
    "button",
    "input",
    "select",
    "summary",
    "a[href]",
    ...[
        "button",
        "checkbox",
        "switch",
        "radio",
        "tab",
        "slider",
        "separator",
        "option",
        "gridcell",
    ].map((role) => `[role="${role}"]`),
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

/** A select's trigger. */
export const SELECT_SELECTOR = '[role="combobox"]';
/** The list of an open select, and a choice in it. */
const OPEN_LIST_SELECTOR = '[role="listbox"]';
const CHOICE_SELECTOR = '[role="option"]';

/**
 * The select whose list, opened by a pointer press on `target`, returns the focus to the
 * viewport after a choice made with the pointer; null when the press is on no such select.
 */
export function focusReturningSelect(target: ControlElement | null): ControlElement | null {
    const select = target?.closest(SELECT_SELECTOR) ?? null;
    if (!select || isTextField(select)) return null;
    if (select.closest(TIMELINE_SELECTOR) !== null) return null;
    if (select.closest(OVERLAY_SELECTOR) !== null) return null;
    if (select.closest(`[${KEEP_FOCUS_ATTRIBUTE}]`) !== null) return null;
    return select;
}

/**
 * Applies the rule while `viewport`, the focusable viewport element, is on the page. Returns
 * the function that stops it.
 */
export function returnFocusToViewport(viewport: HTMLElement): () => void {
    let pressed: { control: Element; pointerId: number } | null = null;
    /** A select opened with the pointer, while its list may be open. */
    let opened: Element | null = null;
    /** A select whose list a pointer choice is closing; it gets the focus back next. */
    let chosen: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Moves the focus to the viewport once nothing else holds it and `owner` still has it. */
    const returnLater = (owner: Element) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const active = document.activeElement;
            if (!active || !owner.contains(active)) return;
            if (!viewport.isConnected || document.querySelector(OVERLAY_SELECTOR)) return;
            viewport.focus({ preventScroll: true });
        }, 0);
    };

    const onPointerDown = (event: PointerEvent) => {
        pressed = null;
        const target = event.target instanceof Element ? event.target : null;
        // A press in the open list of a select is part of its activation.
        if (!target?.closest(OPEN_LIST_SELECTOR)) {
            opened = null;
            chosen = null;
        }
        if (event.button !== 0 && event.button !== 2) return;
        const select = focusReturningSelect(target);
        if (select instanceof Element && !viewport.contains(select)) opened = select;
        const control = focusReturningControl(target);
        if (control instanceof Element && !viewport.contains(control)) {
            pressed = { control, pointerId: event.pointerId };
        }
    };

    const onPointerUp = (event: PointerEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (opened && target?.closest(CHOICE_SELECTOR)?.closest(OPEN_LIST_SELECTOR)) {
            chosen = opened;
            opened = null;
        }
        const press = pressed;
        pressed = null;
        if (press?.pointerId !== event.pointerId) return;
        // After the click that follows the release, and whatever the control did in it.
        returnLater(press.control);
    };

    const onPointerCancel = () => {
        pressed = null;
    };

    // The list gave the focus back to the select it closed for.
    const onFocusIn = (event: FocusEvent) => {
        if (!chosen || event.target !== chosen) return;
        const select = chosen;
        chosen = null;
        returnLater(select);
    };

    // A choice made with the keyboard (Enter in the list) keeps the focus on the select.
    const onKeyDown = () => {
        chosen = null;
    };

    // In the capture phase: a control that stops its pointer events still counts.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
        clearTimeout(timer);
        window.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("pointercancel", onPointerCancel, true);
        window.removeEventListener("focusin", onFocusIn, true);
        window.removeEventListener("keydown", onKeyDown, true);
    };
}
