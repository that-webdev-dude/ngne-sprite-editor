import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { invokeCommand } from "../../src/app/commands/invoke";
import { findChordConflicts } from "../../src/app/commands/registry";
import { installKeymap } from "../../src/app/keymap/install";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import { toolState } from "../../src/app/tools/activeTool";
import { connectToolMapping, toolPipeline } from "../../src/app/tools/appPipeline";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { holdCommandId, selectCommandId } from "../../src/app/tools/tools.commands";
import { createViewMapping } from "../../src/app/view/coordinates";
import { setViewSurface } from "../../src/app/view/viewNavigation";
import { viewportLink } from "../../src/app/viewport/viewportLink";
import type { ViewportMount } from "../../src/app/viewport/viewportLink";
import { celAt, createDocument } from "../../src/core/model";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";
import { rgbaAt } from "./se-014-support";

// SE-014: the tools on the app's own stores — their keys in the command registry and the
// keymap, the temporary tools of held keys, Escape, and the hand and zoom tools driven
// through the app's pointer pipeline. The viewport is a size registered at the link and a
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
const BUTTON: KeyEnvironment = {
    ...VIEWPORT,
    focus: "control",
    nativeKeys: new Set(["Enter", "Space", "Tab"]),
};

let mounted: ViewportMount | null = null;
let disconnect: (() => void) | null = null;
let environment = VIEWPORT;

/** The viewport element, as far as the hold commands look at it: whether it has the focus. */
const surface = { ownerDocument: { activeElement: null as unknown } };

/** Moves the focus to where `next` says: the viewport element, or elsewhere. */
function focus(next: KeyEnvironment): void {
    environment = next;
    surface.ownerDocument.activeElement = next.focus === "viewport" ? surface : null;
}
const target = new EventTarget();
let uninstall: (() => void) | null = null;

beforeEach(() => {
    // The live-stroke path asks for animation frames; Node has none.
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

function open(view = { scale: 8, originX: 40, originY: 20 }) {
    return sessionsStore
        .getState()
        .open(createDocument({ name: "tools", width: 16, height: 12 }), { view });
}

/** Dispatches a key event and reports whether its default was prevented. */
function key(type: "keydown" | "keyup", name: string, init: { ctrlKey?: boolean } = {}) {
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

/** A pointer input at client `x, y`. */
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

function view() {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document");
    return document.view;
}

describe("tool commands in the registry", () => {
    it("binds each tool's key in the canvas context, and the hold keys and Escape (SPEC §7.8)", () => {
        expect(appCommands.get(selectCommandId({ id: "hand" }))).toMatchObject({
            shortcuts: ["H"],
            contexts: ["canvas"],
            menuPath: null,
        });
        expect(appCommands.get("tool.hand")?.title()).toBe("Hand Tool");
        expect(appCommands.get("tool.zoom")).toMatchObject({
            shortcuts: ["Z"],
            contexts: ["canvas"],
        });
        // The development tool has a command for the palette and no key.
        expect(appCommands.get("tool.dot")?.shortcuts).toEqual([]);
        const hold = appCommands.get(holdCommandId({ id: "hand" }));
        expect(hold).toMatchObject({ shortcuts: ["Space"], contexts: ["canvas"] });
        expect(hold?.release).not.toBeNull();
        expect(appCommands.get("tool.cancel")).toMatchObject({
            shortcuts: ["Escape"],
            contexts: ["canvas"],
        });
        // Every one of them is a row of the SPEC's table.
        const canvas = readSpecKeyTable().bindings.filter(
            (binding) => binding.context === "canvas",
        );
        for (const chord of ["H", "Z", "Escape"]) {
            expect(canvas.map((binding) => binding.chord)).toContain(chord);
        }
        expect(canvas.find((binding) => binding.chord === "Space")?.hold).toBe(true);
    });

    it("leaves no two enabled commands on one chord, with and without a stroke", () => {
        open();
        expect(findChordConflicts(appCommands)).toEqual([]);
        toolState.select("dot");
        toolPipeline.down(pointer(50, 30, { button: 0 }));
        expect(toolPipeline.stroking).toBe(true);
        expect(appCommands.get("tool.cancel")?.enabled()).toBe(true);
        expect(findChordConflicts(appCommands)).toEqual([]);
        toolPipeline.cancel();
        expect(appCommands.get("tool.cancel")?.enabled()).toBe(false);
    });
});

describe("keys", () => {
    it("selects a tool by its key from the viewport and from a control", () => {
        open();
        expect(key("keydown", "h")).toBe(true);
        expect(toolState.selectedId()).toBe("hand");
        focus(BUTTON);
        key("keydown", "z");
        expect(toolState.selectedId()).toBe("zoom");
    });

    it("leaves the tool alone with a text field focused, where Ctrl+S still reaches the registry", () => {
        open();
        toolState.select("dot");
        const saves: string[] = [];
        const remove = appCommands.register({
            id: "se014.save",
            title: "Save probe",
            shortcut: "Ctrl+S",
            context: ["global", "text"],
            run: () => void saves.push("save"),
        });
        focus(TEXT);
        expect(key("keydown", "h")).toBe(false);
        expect(toolState.selectedId()).toBe("dot");
        expect(key("keydown", "s", { ctrlKey: true })).toBe(true);
        expect(saves).toEqual(["save"]);
        remove();
    });

    for (const selected of ["dot", "zoom", "hand"]) {
        it(`holding Space pans with the ${selected} tool selected and gives it back on release`, () => {
            const { session, history } = open();
            toolState.select(selected);
            expect(key("keydown", " ")).toBe(true);
            // The key repeats while held: still one hold.
            key("keydown", " ");
            expect(toolState.activeId()).toBe("hand");
            expect(toolState.selectedId()).toBe(selected);
            const start = view();
            expect(toolPipeline.down(pointer(100, 80, { button: 0 }))).toBe(true);
            toolPipeline.move([pointer(110, 85), pointer(117, 93)]);
            toolPipeline.up(pointer(117, 93, { button: 0, buttons: 0 }));
            expect(view()).toEqual({
                ...start,
                originX: start.originX + 17,
                originY: start.originY + 13,
            });
            // Nothing painted, nothing recorded.
            expect(
                celAt(session.doc, session.activeLayerId, session.activeFrameId),
            ).toBeUndefined();
            expect(history.undoCount).toBe(0);
            key("keyup", " ");
            expect(toolState.activeId()).toBe(selected);
        });
    }

    it("Space acts only while the viewport itself has focus: a focused button takes it", () => {
        open();
        toolState.select("zoom");
        focus(BUTTON);
        expect(key("keydown", " ")).toBe(false);
        expect(toolState.activeId()).toBe("zoom");
    });

    it("lists the hold command as inert where no key can be held over the viewport (the palette)", () => {
        open();
        const hold = appCommands.get("tool.hand.hold")!;
        expect(hold.enabled()).toBe(true);
        focus(TEXT);
        expect(hold.enabled()).toBe(false);
        // Run as the palette runs a command: not at all while it is disabled.
        expect(invokeCommand(hold, () => {})).toBe(false);
        expect(toolState.activeId()).toBe(DEFAULT_TOOL);
        setViewSurface(null);
        expect(hold.enabled()).toBe(false);
    });

    it("Escape cancels the stroke in progress: no entry, the pixels as before", () => {
        const { session, history } = open();
        toolState.select("dot");
        toolPipeline.down(pointer(40 + 8 * 3 + 4, 20 + 8 * 2 + 4, { button: 0 }));
        toolPipeline.move([pointer(40 + 8 * 4 + 4, 20 + 8 * 2 + 4)]);
        const image = session.doc.images.get(
            celAt(session.doc, session.activeLayerId, session.activeFrameId)!.imageId,
        )!;
        expect(rgbaAt(image, 4, 2)).toEqual([0, 0, 0, 255]);
        expect(key("keydown", "Escape")).toBe(true);
        expect(toolPipeline.stroking).toBe(false);
        expect(history.undoCount).toBe(0);
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
    });
});

describe("hand and zoom tools", () => {
    it("the hand drags the document with the pointer, as far as the pan limit allows", () => {
        open();
        toolState.select("hand");
        const start = view();
        toolPipeline.down(pointer(100, 80, { button: 0 }));
        toolPipeline.move([pointer(90, 77)]);
        expect(view()).toMatchObject({ originX: start.originX - 10, originY: start.originY - 3 });
        // Far to the left: 32 device pixels of the document stay in the viewport.
        toolPipeline.move([pointer(-2000, 77)]);
        expect(view().originX).toBe(32 - 16 * 8);
        toolPipeline.up(pointer(-2000, 77, { button: 0, buttons: 0 }));
    });

    it("the zoom tool steps in on a click and out on an Alt-click, about the clicked pixel", () => {
        open();
        toolState.select("zoom");
        // Device 77, 45: pixel 4, 3 at 8× from origin 40, 20.
        const pixelUnder = () => {
            const { scale, originX, originY } = view();
            return { x: Math.floor((77 - originX) / scale), y: Math.floor((45 - originY) / scale) };
        };
        expect(pixelUnder()).toEqual({ x: 4, y: 3 });
        toolPipeline.down(pointer(77, 45, { button: 0 }));
        toolPipeline.up(pointer(77, 45, { button: 0, buttons: 0 }));
        expect(view().scale).toBe(10);
        expect(pixelUnder()).toEqual({ x: 4, y: 3 });
        toolPipeline.down(pointer(77, 45, { button: 0, altKey: true }));
        toolPipeline.up(pointer(77, 45, { button: 0, buttons: 0, altKey: true }));
        expect(view().scale).toBe(8);
        expect(pixelUnder()).toEqual({ x: 4, y: 3 });
        // The right button does nothing.
        toolPipeline.down(pointer(77, 45, { button: 2, buttons: 2 }));
        toolPipeline.up(pointer(77, 45, { button: 2, buttons: 0 }));
        expect(view().scale).toBe(8);
        // No history entry: navigation is view state.
        expect(activeDocument(sessionsStore.getState())?.history.undoCount).toBe(0);
    });

    it("the zoom tool's cursor and hint follow Alt", () => {
        const zoom = toolState.registry.get("zoom")!;
        const cursor = zoom.cursor as (state: { modifiers: object; pressed: boolean }) => string;
        const none = { shift: false, ctrl: false, alt: false, meta: false };
        expect(cursor({ modifiers: none, pressed: false })).toBe("zoom-in");
        expect(cursor({ modifiers: { ...none, alt: true }, pressed: false })).toBe("zoom-out");
        expect(zoom.hint).toBe("Alt: zoom out");
    });
});
