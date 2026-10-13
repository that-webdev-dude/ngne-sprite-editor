import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import { findChordConflicts } from "../../src/app/commands/registry";
import { activeDocument, isDirty, sessionsStore } from "../../src/app/state/sessions";
import { fitView, visibleExtent } from "../../src/app/view/navigate";
import {
    activeView,
    canNavigate,
    currentViewMapping,
    fitActiveView,
    panBy,
    zoomBy,
    zoomTo,
} from "../../src/app/view/viewNavigation";
import { viewportRegion } from "../../src/app/view/viewportSize";
import { ZOOM_STEPS } from "../../src/app/view/zoom";
import { viewportLink } from "../../src/app/viewport/viewportLink";
import type { ViewportMount } from "../../src/app/viewport/viewportLink";
import { createDocument } from "../../src/core/model";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";

// SE-012: the view commands (View menu, keys 0 to 6) and the navigation they run, on the
// app's own stores with a viewport of a known size registered at the link.

const SIZE = { width: 972, height: 424 };
let mounted: ViewportMount | null = null;

/** Registers a viewport of `size` at the app's link, as `mountViewport` does. */
function mount(size = SIZE): void {
    mounted = viewportLink.mount({ invalidate() {} }, size);
}

function open(width = 32, height = 32, view?: { scale: number; originX: number; originY: number }) {
    return sessionsStore.getState().open(createDocument({ name: "hero", width, height }), { view });
}

const view = () => {
    const current = activeView();
    if (!current) throw new Error("no active document");
    return current;
};

function command(id: string) {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    mounted?.unmount();
    mounted = null;
});

const VIEW_IDS = ["view.zoomIn", "view.zoomOut", "view.fit", "view.zoom100"];
const KEY_IDS = ["view.zoom2x", "view.zoom4x", "view.zoom8x", "view.zoom16x", "view.zoom32x"];

describe("view commands in the registry", () => {
    it("implements Zoom In, Zoom Out, Fit and 100% at their planned places in the View menu", () => {
        for (const id of VIEW_IDS) {
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(command(id).planned, id).toBe(false);
            expect(command(id).source, id).toMatch(/view\/view\.commands\.ts$/);
            expect(command(id).menuPath, id).toEqual(["View"]);
            expect(command(id).menuOrder, id).toBe(plan?.menuOrder);
            expect(command(id).title(), id).toBe(plan?.title);
        }
        const menu = menuCommands(buildMenu(appCommands.list(), ["View"])).map((entry) => entry.id);
        expect(menu.slice(0, 4)).toEqual(VIEW_IDS);
        // The zooms of the keys 2 to 6 are commands without a menu item.
        for (const id of KEY_IDS) expect(command(id).menuPath, id).toBeNull();
    });

    it("binds the keys of SPEC §7.8: 1 to 6 are 1×, 2×, 4×, 8×, 16×, 32× and 0 fits, in canvas", () => {
        const table = readSpecKeyTable();
        const digits = table.bindings.filter((binding) => /^[0-6]$/.test(binding.chord));
        expect(digits.map((binding) => [binding.chord, binding.context])).toEqual([
            ["1", "canvas"],
            ["2", "canvas"],
            ["3", "canvas"],
            ["4", "canvas"],
            ["5", "canvas"],
            ["6", "canvas"],
            ["0", "canvas"],
        ]);
        const bound = (chord: string) =>
            appCommands.bindings("canvas", chord).map((entry) => entry.id);
        expect(digits.map((binding) => bound(binding.chord))).toEqual([
            ["view.zoom100"],
            ["view.zoom2x"],
            ["view.zoom4x"],
            ["view.zoom8x"],
            ["view.zoom16x"],
            ["view.zoom32x"],
            ["view.fit"],
        ]);
        for (const id of [...VIEW_IDS, ...KEY_IDS]) {
            // Canvas only: a digit typed into a field is text, and no other context has them.
            expect(command(id).contexts, id).toEqual(
                command(id).shortcuts.length ? ["canvas"] : ["global"],
            );
        }
        // SPEC §7.8 gives Zoom In and Zoom Out no key: the wheel does that.
        expect(command("view.zoomIn").shortcuts).toEqual([]);
        expect(command("view.zoomOut").shortcuts).toEqual([]);
        expect(KEY_IDS.map((id) => command(id).title())).toEqual([
            "Zoom 2×",
            "Zoom 4×",
            "Zoom 8×",
            "Zoom 16×",
            "Zoom 32×",
        ]);
    });

    it("is enabled only with a document in a viewport that has a size", () => {
        const enabled = () => [...VIEW_IDS, ...KEY_IDS].map((id) => command(id).enabled());
        const none = enabled().map(() => false);
        expect(enabled()).toEqual(none);
        expect(canNavigate()).toBe(false);

        open();
        // A document, and no viewport: nothing to fit into yet.
        expect(enabled()).toEqual(none);
        mount({ width: 0, height: 0 });
        expect(enabled()).toEqual(none);
        mounted?.resize(SIZE);
        expect(canNavigate()).toBe(true);
        expect(enabled()).toEqual(none.map(() => true));
        expect(findChordConflicts(appCommands)).toEqual([]);

        mounted?.resize({ width: 0, height: 0 });
        expect(enabled()).toEqual(none);
    });

    it("disables Zoom In at the largest step and Zoom Out at the smallest", () => {
        mount();
        open(32, 32, { scale: 64, originX: 0, originY: 0 });
        expect(command("view.zoomIn").enabled()).toBe(false);
        expect(command("view.zoomOut").enabled()).toBe(true);
        zoomTo(1 / 8);
        expect(command("view.zoomIn").enabled()).toBe(true);
        expect(command("view.zoomOut").enabled()).toBe(false);
    });

    it("a disabled command changes nothing when it is run without a viewport", () => {
        const { id } = open(32, 32, { scale: 4, originX: 7, originY: 9 });
        for (const run of [() => zoomBy(1), () => zoomTo(8), () => panBy(5, 5), fitActiveView]) {
            run();
        }
        expect(view()).toEqual({ scale: 4, originX: 7, originY: 9 });
        expect(sessionsStore.getState().documents.find((entry) => entry.id === id)?.revision).toBe(
            0,
        );
    });
});

describe("view navigation on the stores", () => {
    it("Zoom In and Zoom Out walk the steps about the centre of the viewport", () => {
        mount();
        // A 32×32 document with its middle at the centre of the viewport, (486, 212).
        open(32, 32, { scale: 1, originX: 470, originY: 196 });
        const walked = [];
        for (let step = 0; step < ZOOM_STEPS.length; step++) {
            void command("view.zoomIn").run();
            walked.push(view().scale);
            // The middle of the document, pixel boundary 16, stays at the centre.
            expect(view().originX + 16 * view().scale).toBe(486);
            expect(view().originY + 16 * view().scale).toBe(212);
        }
        expect(walked.slice(0, 14)).toEqual(ZOOM_STEPS.filter((step) => step > 1));
        expect(walked.at(-1)).toBe(64);

        void command("view.zoomOut").run();
        expect(view()).toEqual({ scale: 48, originX: 486 - 16 * 48, originY: 212 - 16 * 48 });
        for (let step = 0; step < ZOOM_STEPS.length; step++) void command("view.zoomOut").run();
        expect(view().scale).toBe(1 / 8);
    });

    it("the keys' commands set 1×, 2×, 4×, 8×, 16× and 32×, and Fit fits and centres", () => {
        mount();
        const { id } = open(32, 32, { scale: 3, originX: 438, originY: 164 });
        const zooms = ["view.zoom100", ...KEY_IDS].map((commandId) => {
            void command(commandId).run();
            expect(view().originX + 16 * view().scale).toBe(486);
            return view().scale;
        });
        expect(zooms).toEqual([1, 2, 4, 8, 16, 32]);

        void command("view.fit").run();
        expect(view()).toEqual({ scale: 12, originX: 294, originY: 20 });
        expect(view()).toEqual(fitView({ width: 32, height: 32 }, SIZE));
        // Fit again changes nothing, and does not touch the document.
        const before = sessionsStore.getState().documents.find((entry) => entry.id === id);
        void command("view.fit").run();
        expect(sessionsStore.getState().documents.find((entry) => entry.id === id)).toBe(before);
    });

    it("navigates the active document only, and never makes it dirty", () => {
        mount();
        const first = open(32, 32, { scale: 2, originX: 10, originY: 10 });
        const second = sessionsStore
            .getState()
            .open(createDocument({ name: "other", width: 8, height: 8 }), {
                view: { scale: 4, originX: 100, originY: 100 },
            });
        zoomBy(1);
        panBy(3, -4);
        const documents = sessionsStore.getState().documents;
        expect(documents.find((entry) => entry.id === first.id)?.view).toEqual({
            scale: 2,
            originX: 10,
            originY: 10,
        });
        expect(view().scale).toBe(5);
        const active = activeDocument(sessionsStore.getState());
        expect(active?.id).toBe(second.id);
        expect(active && isDirty(active)).toBe(false);
        expect(active?.history.undoCount).toBe(0);
    });

    it("pans by device pixels and stops at the pan limits", () => {
        mount();
        open(32, 32, { scale: 8, originX: 100, originY: 50 });
        panBy(17, -9);
        expect(view()).toEqual({ scale: 8, originX: 117, originY: 41 });
        panBy(-100_000, 100_000);
        expect(view()).toEqual({ scale: 8, originX: 32 - 256, originY: 424 - 32 });
        expect(visibleExtent(view(), { width: 32, height: 32 }, SIZE)).toEqual({
            width: 32,
            height: 32,
        });
    });

    it("zooms about an anchor: the document pixel under it stays", () => {
        mount();
        open(64, 48, { scale: 8, originX: 100, originY: 60 });
        // Device (144, 104) is 5.5 document pixels into the document.
        zoomTo(16, { x: 144, y: 104 });
        expect(view()).toEqual({ scale: 16, originX: 56, originY: 16 });
        zoomBy(-1, { x: 144, y: 104 });
        expect(view().scale).toBe(12);
        expect(Math.floor((144 - view().originX) / 12)).toBe(5);
    });

    it("navigates with the size of the viewport region while no viewport is mounted", () => {
        open(32, 32, { scale: 1, originX: 0, originY: 0 });
        expect(canNavigate()).toBe(false);
        viewportRegion.report(SIZE);
        try {
            expect(canNavigate()).toBe(true);
            expect(command("view.fit").enabled()).toBe(true);
            void command("view.fit").run();
            expect(view()).toEqual({ scale: 12, originX: 294, originY: 20 });
            // A mounted viewport's own size comes first.
            mount({ width: 512, height: 512 });
            void command("view.fit").run();
            expect(view()).toEqual({ scale: 16, originX: 0, originY: 0 });
        } finally {
            viewportRegion.report({ width: 0, height: 0 });
        }
        expect(canNavigate()).toBe(true);
        mounted?.unmount();
        mounted = null;
        expect(canNavigate()).toBe(false);
    });

    it("has no mapping without a viewport element", () => {
        mount();
        open();
        // The element is registered by the interface (pointerNavigation); Node has none.
        expect(currentViewMapping()).toBeNull();
    });
});
