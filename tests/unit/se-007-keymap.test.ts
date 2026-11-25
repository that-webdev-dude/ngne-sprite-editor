import { describe, expect, it } from "vitest";
import {
    isTextField,
    nativeKeysOf,
    OVERLAY_SELECTOR,
    readKeyEnvironment,
} from "@ngne/editor-ui/commands";
import type { FocusedElement, KeymapDocument } from "@ngne/editor-ui/commands";

// SE-007: the key environment read from the page (SPEC §7.8): text fields, the native keys and
// typeahead of the focused control, and the surfaces that hold the keys while they are open.

// --- Reading the environment from the page -------------------------------------------------

function element(
    tagName: string,
    attributes: Record<string, string> = {},
    inside: string[] = [],
): FocusedElement {
    return {
        tagName: tagName.toUpperCase(),
        isContentEditable: attributes.contenteditable === "true",
        getAttribute: (name) => attributes[name] ?? null,
        hasAttribute: (name) => name in attributes,
        closest: (selector) => (inside.includes(selector) ? {} : null),
    };
}

function page(active: FocusedElement | null, open: string[] = []): KeymapDocument {
    return {
        activeElement: active,
        querySelector: (selector) => (open.includes(selector) ? {} : null),
    };
}

describe("reading the environment from the page", () => {
    it("recognises text and number fields", () => {
        for (const field of [
            element("input"),
            element("input", { type: "text", role: "spinbutton" }),
            element("input", { type: "number" }),
            element("input", { type: "search" }),
            element("textarea"),
            element("div", { contenteditable: "true" }),
            element("div", { role: "textbox" }),
        ]) {
            expect(isTextField(field)).toBe(true);
            expect(readKeyEnvironment(page(field)).focus).toBe("text");
        }
        for (const control of [
            element("input", { type: "checkbox" }),
            element("input", { type: "range" }),
            element("button"),
            element("div", { tabindex: "0" }),
        ]) {
            expect(isTextField(control)).toBe(false);
        }
    });

    it("knows which native keys each kind of control consumes", () => {
        const keys = (target: FocusedElement) => [...nativeKeysOf(target)].sort();
        const activate = ["Enter", "Space", "Tab"];
        const navigate = [
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "End",
            "Enter",
            "Home",
            "Space",
            "Tab",
        ];
        expect(keys(element("button"))).toEqual(activate);
        expect(keys(element("a", { href: "#" }))).toEqual(activate);
        expect(keys(element("input", { type: "checkbox" }))).toEqual(activate);
        expect(keys(element("div", { role: "button", tabindex: "0" }))).toEqual(activate);
        // The splitter, a Radix select trigger, a segmented control item, a menu bar trigger.
        expect(keys(element("div", { role: "separator", tabindex: "0" }))).toEqual(navigate);
        expect(keys(element("button", { role: "combobox" }))).toEqual(navigate);
        expect(keys(element("button", { role: "radio" }))).toEqual(navigate);
        expect(keys(element("button", { role: "menuitem" }))).toEqual(navigate);
        expect(keys(element("select"))).toEqual(navigate);
        expect(keys(element("input", { type: "range" }))).toEqual(navigate);
        // A timeline cell: nothing but Tab.
        expect(keys(element("div", { role: "gridcell", tabindex: "0" }))).toEqual(["Tab"]);
        expect(keys(element("div", { tabindex: "0" }))).toEqual(["Tab"]);
        expect(keys(element("a"))).toEqual(["Tab"]);
    });

    it("gives typeahead to selects only", () => {
        const typeahead = (target: FocusedElement) => readKeyEnvironment(page(target)).typeahead;
        expect(typeahead(element("button", { role: "combobox" }))).toBe(true);
        expect(typeahead(element("select"))).toBe(true);
        expect(typeahead(element("button"))).toBe(false);
        expect(typeahead(element("button", { role: "menuitem" }))).toBe(false);
    });

    it("recognises Radix surfaces by role and state, and marked surfaces", () => {
        for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
            expect(OVERLAY_SELECTOR).toContain(`[role="${role}"][data-state="open"]`);
        }
        expect(OVERLAY_SELECTOR).toContain("[data-keymap-overlay]");
        expect(OVERLAY_SELECTOR).not.toContain("tooltip");
    });
});
