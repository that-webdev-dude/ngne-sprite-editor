import type { KeyContextState } from "./contextState";
import type { KeyEnvironment } from "./resolve";

/**
 * Reads the keymap environment (SPEC §7.8) from the page. The contracts with the interface:
 *
 * - The focusable viewport element carries `data-viewport-focus`. Only that element counts as
 *   "the viewport itself is focused".
 * - The timeline panel is the element with `data-region="timeline"`.
 * - An open Radix menu, dialog, popover or select list is recognised by its role and
 *   `data-state="open"`; any other surface that handles its own keys carries
 *   `data-keymap-overlay` while it is open.
 */
export const VIEWPORT_FOCUS_ATTRIBUTE = "data-viewport-focus";
export const TIMELINE_SELECTOR = '[data-region="timeline"]';
export const OVERLAY_ATTRIBUTE = "data-keymap-overlay";
export const OVERLAY_SELECTOR = [
    ...["dialog", "alertdialog", "menu", "listbox"].map(
        (role) => `[role="${role}"][data-state="open"]`,
    ),
    `[${OVERLAY_ATTRIBUTE}]`,
].join(", ");

/** The part of an element the keymap reads; DOM elements and test doubles both fit. */
export interface FocusedElement {
    tagName: string;
    isContentEditable?: boolean;
    getAttribute(name: string): string | null;
    hasAttribute(name: string): boolean;
    closest(selector: string): unknown;
}

/** The part of a document the keymap reads. */
export interface KeymapDocument {
    activeElement: FocusedElement | null;
    querySelector(selector: string): unknown;
}

const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
]);

const ACTIVATION_KEYS = ["Enter", "Space", "Tab"];
/** Nothing focused, or a focusable element without keys of its own: Tab still moves focus. */
const TAB_ONLY: ReadonlySet<string> = new Set(["Tab"]);
/** Buttons, links and checkboxes. */
const ACTIVATE: ReadonlySet<string> = new Set(ACTIVATION_KEYS);
/** Controls that also move a value or a choice: sliders, splitters, selects, radio groups. */
const NAVIGATE: ReadonlySet<string> = new Set([
    ...ACTIVATION_KEYS,
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
]);
const NOTHING: ReadonlySet<string> = new Set();

const ACTIVATE_ROLES = new Set(["button", "link", "checkbox", "switch"]);
const NAVIGATE_ROLES = new Set([
    "combobox",
    "listbox",
    "option",
    "slider",
    "separator",
    "scrollbar",
    "spinbutton",
    "radio",
    "radiogroup",
    "tab",
    "tablist",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tree",
    "treeitem",
]);
const TYPEAHEAD_ROLES = new Set(["combobox", "listbox", "option", "tree", "treeitem"]);

function tagOf(element: FocusedElement): string {
    return element.tagName.toLowerCase();
}

function inputType(element: FocusedElement): string {
    return (element.getAttribute("type") ?? "text").toLowerCase();
}

/** A text or number field: it handles typing, Enter, Escape, arrows and Tab itself. */
export function isTextField(element: FocusedElement): boolean {
    if (element.isContentEditable) return true;
    const tag = tagOf(element);
    if (tag === "textarea") return true;
    if (tag === "input") return !NON_TEXT_INPUT_TYPES.has(inputType(element));
    const role = element.getAttribute("role");
    return role === "textbox" || role === "searchbox";
}

/** The native keys a focused non-text control consumes itself. */
export function nativeKeysOf(element: FocusedElement): ReadonlySet<string> {
    const role = element.getAttribute("role");
    if (role) {
        if (NAVIGATE_ROLES.has(role)) return NAVIGATE;
        if (ACTIVATE_ROLES.has(role)) return ACTIVATE;
        return TAB_ONLY;
    }
    const tag = tagOf(element);
    if (tag === "select") return NAVIGATE;
    if (tag === "input") {
        const type = inputType(element);
        return type === "range" || type === "radio" ? NAVIGATE : ACTIVATE;
    }
    if (tag === "button" || tag === "summary") return ACTIVATE;
    if (tag === "a" && element.hasAttribute("href")) return ACTIVATE;
    return TAB_ONLY;
}

function usesTypeahead(element: FocusedElement): boolean {
    const role = element.getAttribute("role");
    return role ? TYPEAHEAD_ROLES.has(role) : tagOf(element) === "select";
}

/** The environment of a key pressed now, from the document and the context state. */
export function readKeyEnvironment(
    document: KeymapDocument,
    contexts: KeyContextState,
): KeyEnvironment {
    const active = document.activeElement;
    const focused = active && !["body", "html"].includes(tagOf(active)) ? active : null;
    const base = {
        overlayOpen: document.querySelector(OVERLAY_SELECTOR) !== null,
        inTimeline: focused !== null && focused.closest(TIMELINE_SELECTOR) != null,
        gesture: contexts.gesture,
        floating: contexts.floating,
    };
    if (!focused) return { ...base, focus: "none", nativeKeys: TAB_ONLY, typeahead: false };
    if (isTextField(focused)) {
        return { ...base, focus: "text", nativeKeys: NOTHING, typeahead: false };
    }
    if (focused.hasAttribute(VIEWPORT_FOCUS_ATTRIBUTE)) {
        return { ...base, focus: "viewport", nativeKeys: NOTHING, typeahead: false };
    }
    return {
        ...base,
        focus: "control",
        nativeKeys: nativeKeysOf(focused),
        typeahead: usesTypeahead(focused),
    };
}
