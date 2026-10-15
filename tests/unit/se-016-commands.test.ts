import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESET_COLOURS, SWAP_COLOURS } from "../../src/app/colour/colour.commands";
import { appCommands } from "../../src/app/commands/appCommands";
import { findChordConflicts } from "../../src/app/commands/registry";
import { runPaletteCommand } from "../../src/app/commandPalette/paletteModel";
import { installKeymap } from "../../src/app/keymap/install";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import { toolState } from "../../src/app/tools/activeTool";
import { connectToolMapping, toolPipeline } from "../../src/app/tools/appPipeline";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { toolRegistry } from "../../src/app/tools/toolRegistry";
import { holdCommandId } from "../../src/app/tools/tools.commands";
import { createViewMapping } from "../../src/app/view/coordinates";
import { setViewSurface } from "../../src/app/view/viewNavigation";
import { viewportLink } from "../../src/app/viewport/viewportLink";
import type { ViewportMount } from "../../src/app/viewport/viewportLink";
import { createDocument } from "../../src/core/model";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";

// SE-016: the colour commands and the Alt hold of the eyedropper on the app's own registry,
// keymap, stores and pointer pipeline. The viewport is a size registered at the link and a
// mapping with the viewport element at the client origin, ratio 1.

const SIZE = { width: 400, height: 300 };
const VIEWPORT: KeyEnvironment = {
    overlayOpen: false,
    focus: "viewport",
    inTimeline: false,
    nativeKeys: new Set(),
    typeahead: false,
    gesture: false,
    floating: false,
};
const TEXT: KeyEnvironment = { ...VIEWPORT, focus: "text" };
/** A focused button of the dock or the rail. */
const BUTTON: KeyEnvironment = {
    ...VIEWPORT,
    focus: "control",
    nativeKeys: new Set(["Enter", "Space", "Tab"]),
};
/** A focused slider of the colour panel. */
const SLIDER: KeyEnvironment = {
    ...VIEWPORT,
    focus: "control",
    nativeKeys: new Set([
        "Enter",
        "Space",
        "Tab",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
    ]),
};
const MENU: KeyEnvironment = { ...VIEWPORT, overlayOpen: true };

const surface = { ownerDocument: { activeElement: null as unknown } };
let environment = VIEWPORT;
function focus(next: KeyEnvironment): void {
    environment = next;
    surface.ownerDocument.activeElement = next.focus === "viewport" ? surface : null;
}

const target = new EventTarget();
let mounted: ViewportMount | null = null;
let disconnect: (() => void) | null = null;
let uninstall: (() => void) | null = null;

beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    mounted = viewportLink.mount({ invalidate() {} }, SIZE);
    disconnect = connectToolMapping(() => {
        const document = activeDocument(sessionsStore.getState());
        if (!document) return null;
        return createViewMapping({
            view: document.view,
            docWidth: document.session.doc.width,
            docHeight: document.session.doc.height,
            ratio: 1,
            left: 0,
            top: 0,
        });
    });
    setViewSurface(surface as unknown as HTMLElement);
    focus(VIEWPORT);
    uninstall = installKeymap({ registry: appCommands, target, environment: () => environment });
    editorStore.getState().resetColours();
});

afterEach(() => {
    uninstall?.();
    disconnect?.();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    mounted?.unmount();
    setViewSurface(null);
    editorStore.getState().setTool(DEFAULT_TOOL);
    vi.unstubAllGlobals();
});

/** Dispatches a key event and reports whether its default was prevented. */
function key(type: "keydown" | "keyup", name: string, init: { altKey?: boolean } = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
        key: name,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        ...init,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

const altDown = () => key("keydown", "Alt", { altKey: true });
const altUp = () => key("keyup", "Alt");

function pointer(x: number, y: number, fields: Partial<PointerInput> = {}): PointerInput {
    return {
        pointerId: 1,
        button: -1,
        buttons: 1,
        clientX: x,
        clientY: y,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: 0,
        ...fields,
    };
}

/** A 4 × 4 document at 10×, its cel filled with one colour; the viewport origin at 0, 0. */
function openFilled(rgba: readonly number[]) {
    const document = sessionsStore
        .getState()
        .open(createDocument({ name: "colours", width: 4, height: 4 }), {
            view: { scale: 10, originX: 0, originY: 0 },
        });
    const transaction = document.history.begin({
        layerId: document.session.activeLayerId,
        frameId: document.session.activeFrameId,
    });
    for (let at = 0; at < transaction.image.data.length; at += 4)
        transaction.image.data.set(rgba, at);
    transaction.markDirty({ x: 0, y: 0, width: 4, height: 4 });
    transaction.commit("Fill");
    return document;
}

describe("colour commands", () => {
    it("binds X to Swap Colours in the canvas context; Reset Colours has no key (SPEC §7.8)", () => {
        expect(appCommands.get(SWAP_COLOURS)).toMatchObject({
            shortcuts: ["X"],
            contexts: ["canvas"],
        });
        expect(appCommands.get(SWAP_COLOURS)?.title()).toBe("Swap Colours");
        expect(appCommands.get(RESET_COLOURS)).toMatchObject({ shortcuts: [] });
        expect(appCommands.get(RESET_COLOURS)?.title()).toBe("Reset Colours");
        const canvas = readSpecKeyTable().bindings.filter(
            (binding) => binding.context === "canvas",
        );
        expect(canvas.map((binding) => binding.chord)).toContain("X");
        expect(findChordConflicts(appCommands)).toEqual([]);
    });

    it("X swaps the colours from the viewport and from a focused control, not from a text field or an open menu", () => {
        editorStore.getState().setForeground(0x112233ff);
        editorStore.getState().setBackground(0x44556677);
        expect(key("keydown", "x")).toBe(true);
        expect(editorStore.getState()).toMatchObject({
            foreground: 0x44556677,
            background: 0x112233ff,
        });
        focus(SLIDER);
        key("keydown", "x");
        expect(editorStore.getState()).toMatchObject({
            foreground: 0x112233ff,
            background: 0x44556677,
        });
        focus(TEXT);
        expect(key("keydown", "x")).toBe(false);
        focus(MENU);
        key("keydown", "x");
        expect(editorStore.getState()).toMatchObject({
            foreground: 0x112233ff,
            background: 0x44556677,
        });
    });

    it("Reset Colours puts black in the foreground and white in the background", () => {
        editorStore.getState().setForeground(0x112233ff);
        editorStore.getState().setBackground(0x44556677);
        appCommands.get(RESET_COLOURS)?.run();
        expect(editorStore.getState()).toMatchObject({
            foreground: 0x000000ff,
            background: 0xffffffff,
        });
    });
});

describe("the Alt hold", () => {
    it("is the eyedropper's hold command, bound to Alt in the canvas context", () => {
        const hold = appCommands.get(holdCommandId({ id: "eyedropper" }));
        expect(hold).toMatchObject({ shortcuts: ["Alt"], contexts: ["canvas"] });
        expect(hold?.title()).toBe("Temporary Eyedropper");
        expect(hold?.release).not.toBeNull();
    });

    for (const [where, place] of [
        ["the viewport", VIEWPORT],
        ["a button", BUTTON],
        ["a slider", SLIDER],
    ] as const) {
        it(`with a paint tool selected and the focus on ${where}, holding Alt makes the eyedropper active until it is released`, () => {
            openFilled([0, 0, 0, 0]);
            expect(toolState.selected()?.paints).toBe(true);
            focus(place);
            expect(altDown()).toBe(true);
            // The key repeats while held: still one hold.
            key("keydown", "Alt", { altKey: true });
            expect(toolState.activeId()).toBe("eyedropper");
            expect(toolState.selectedId()).toBe(DEFAULT_TOOL);
            expect(altUp()).toBe(true);
            expect(toolState.activeId()).toBe(DEFAULT_TOOL);
        });
    }

    it("a click while Alt is held picks the pixel's colour, and the pencil paints again after the release", () => {
        const document = openFilled([12, 34, 56, 200]);
        editorStore.getState().setForeground(0xffffffff);
        altDown();
        expect(toolPipeline.down(pointer(15, 25, { button: 0, altKey: true }))).toBe(true);
        toolPipeline.up(pointer(15, 25, { button: 0, buttons: 0, altKey: true }));
        expect(editorStore.getState().foreground).toBe(0x0c2238c8);
        expect(document.history.undoCount).toBe(1);
        // The right button picks into the background.
        toolPipeline.down(pointer(35, 5, { button: 2, buttons: 2, altKey: true }));
        toolPipeline.up(pointer(35, 5, { button: 2, buttons: 0, altKey: true }));
        expect(editorStore.getState().background).toBe(0x0c2238c8);
        altUp();
        expect(toolState.activeId()).toBe("pencil");
        // The pencil, in a colour the pixels do not have: one more undo step.
        editorStore.getState().setForeground(0xff0000ff);
        toolPipeline.down(pointer(15, 25, { button: 0 }));
        expect(toolPipeline.strokeTool?.id).toBe("pencil");
        toolPipeline.up(pointer(15, 25, { button: 0, buttons: 0 }));
        expect(document.history.undoCount).toBe(2);
    });

    it("does nothing with a text field focused, with a menu open, or with the zoom or the hand tool selected", () => {
        openFilled([0, 0, 0, 0]);
        focus(TEXT);
        altDown();
        expect(toolState.activeId()).toBe(DEFAULT_TOOL);
        altUp();
        focus(MENU);
        altDown();
        expect(toolState.activeId()).toBe(DEFAULT_TOOL);
        altUp();
        focus(VIEWPORT);
        for (const tool of ["zoom", "hand"]) {
            toolState.select(tool);
            expect(toolRegistry.get(tool)?.paints).toBeFalsy();
            altDown();
            expect(toolState.activeId(), tool).toBe(tool);
            altUp();
        }
    });

    it("run from the command palette, it is released at once: the active tool stays as it was", () => {
        openFilled([0, 0, 0, 0]);
        focus(BUTTON);
        const hold = appCommands.get(holdCommandId({ id: "eyedropper" }))!;
        const recorded: string[] = [];
        expect(runPaletteCommand(hold, () => {}, { record: (id) => void recorded.push(id) })).toBe(
            true,
        );
        expect(recorded).toEqual([holdCommandId({ id: "eyedropper" })]);
        expect(toolState.activeId()).toBe(DEFAULT_TOOL);
        expect(toolState.held()).toEqual([]);
    });

    it("leaves Space as it was: it still acts only while the viewport itself has the focus", () => {
        openFilled([0, 0, 0, 0]);
        focus(BUTTON);
        expect(key("keydown", " ")).toBe(false);
        expect(toolState.activeId()).toBe(DEFAULT_TOOL);
        expect(appCommands.get(holdCommandId({ id: "hand" }))?.enabled()).toBe(false);
        focus(VIEWPORT);
        expect(appCommands.get(holdCommandId({ id: "hand" }))?.enabled()).toBe(true);
    });
});
