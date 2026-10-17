import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { findChordConflicts } from "../../src/app/commands/registry";
import { keyContextStore } from "../../src/app/keymap/contextState";
import { installKeymap } from "../../src/app/keymap/install";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import { toolState } from "../../src/app/tools/activeTool";
import { connectToolMapping, toolPipeline } from "../../src/app/tools/appPipeline";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { nextVariantCommandId, selectCommandId } from "../../src/app/tools/tools.commands";
import { invokeCommand } from "../../src/app/commands/invoke";
import { createViewMapping } from "../../src/app/view/coordinates";
import { setViewSurface } from "../../src/app/view/viewNavigation";
import { viewportLink } from "../../src/app/viewport/viewportLink";
import type { ViewportMount } from "../../src/app/viewport/viewportLink";
import { createDocument } from "../../src/core/model";
import { rowsOf } from "./se-030-support";

// SE-031: the selection tools' keys on the app's own stores (SPEC §7.8). M, Shift+M, Q,
// Shift+Q and W select the tools, a key pressed again switches the rail slot's variant, and
// while the polygon lasso's gesture is open the `gesture` context takes Enter, which closes it
// instead of reaching a `canvas` binding (play/pause), and Escape takes it back.

const SIZE = { width: 400, height: 300 };
const VIEW = { scale: 8, originX: 40, originY: 20 };

let mounted: ViewportMount | null = null;
let disconnect: (() => void) | null = null;
let uninstall: (() => void) | null = null;
const target = new EventTarget();
/** The environment of the keys: the viewport focused, the gesture context as the app sets it. */
const environment = (): KeyEnvironment => ({
    overlayOpen: false,
    focus: "viewport",
    inTimeline: false,
    nativeKeys: new Set(),
    typeahead: false,
    gesture: keyContextStore.getState().gesture,
    floating: keyContextStore.getState().floating,
});
const surface = { ownerDocument: { activeElement: null as unknown } };

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
    surface.ownerDocument.activeElement = surface;
    setViewSurface(surface as unknown as HTMLElement);
    uninstall = installKeymap({ registry: appCommands, target, environment });
});

afterEach(() => {
    toolPipeline.cancel();
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

function open() {
    return sessionsStore
        .getState()
        .open(createDocument({ name: "keys", width: 10, height: 8 }), { view: VIEW });
}

/** Dispatches a key down and reports whether its default was prevented. */
function key(name: string, init: { shiftKey?: boolean } = {}) {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
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

/** A pointer input over the centre of document pixel `x, y`. */
function pixel(x: number, y: number, fields: Partial<PointerInput> = {}): PointerInput {
    return {
        pointerId: 1,
        button: 0,
        buttons: 1,
        clientX: VIEW.originX + (x + 0.5) * VIEW.scale,
        clientY: VIEW.originY + (y + 0.5) * VIEW.scale,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: 0,
        ...fields,
    };
}

function click(x: number, y: number) {
    toolPipeline.down(pixel(x, y));
    toolPipeline.up(pixel(x, y, { buttons: 0 }));
}

/**
 * Records what the `canvas` bindings of Enter run (play/pause, once it exists): each runs the
 * record and is enabled, as play/pause may not be on a one-frame document; or a probe bound
 * there records while none is.
 */
function recordCanvasEnter(): { calls: string[]; restore(): void } {
    const calls: string[] = [];
    const record = () => void calls.push("canvas Enter");
    const bound = appCommands.bindings("canvas", "Enter");
    if (bound.length === 0) {
        const remove = appCommands.register({
            id: "se031.play",
            title: "Play probe",
            shortcut: "Enter",
            context: "canvas",
            run: record,
        });
        return { calls, restore: remove };
    }
    const kept = bound.map((command) => ({ run: command.run, enabled: command.enabled }));
    for (const command of bound) {
        command.run = record;
        command.enabled = () => true;
    }
    return {
        calls,
        restore() {
            bound.forEach((command, index) => {
                command.run = kept[index]?.run ?? command.run;
                command.enabled = kept[index]?.enabled ?? command.enabled;
            });
        },
    };
}

describe("tool keys", () => {
    it("select the selection tools, and a key pressed again switches the slot's variant", () => {
        open();
        for (const [name, shiftKey, id] of [
            ["w", false, "wand"],
            ["q", false, "lasso"],
            ["M", true, "ellipse-marquee"],
            ["Q", true, "polygon-lasso"],
            ["m", false, "marquee"],
        ] as const) {
            expect(key(name, { shiftKey }), name).toBe(true);
            expect(toolState.selectedId(), name).toBe(id);
        }
        key("m");
        expect(toolState.selectedId()).toBe("ellipse-marquee");
        key("m");
        expect(toolState.selectedId()).toBe("marquee");
        key("M", { shiftKey: true });
        expect(toolState.selectedId()).toBe("ellipse-marquee");
        key("M", { shiftKey: true });
        expect(toolState.selectedId()).toBe("marquee");
        key("q");
        key("q");
        expect(toolState.selectedId()).toBe("polygon-lasso");
        expect(appCommands.get(selectCommandId({ id: "polygon-lasso" }))?.title()).toBe(
            "Polygon lasso Tool",
        );
    });

    it("are two commands on one key with exclusive conditions: the tool, or its next variant once it is selected", () => {
        open();
        const select = appCommands.get(selectCommandId({ id: "marquee" }))!;
        const next = appCommands.get(nextVariantCommandId({ id: "marquee" }))!;
        expect(next.shortcuts).toEqual(select.shortcuts);
        expect(next.contexts).toEqual(["canvas"]);
        toolState.select("wand");
        expect([select.enabled(), next.enabled()]).toEqual([true, false]);
        expect(findChordConflicts(appCommands)).toEqual([]);
        toolState.select("marquee");
        expect([select.enabled(), next.enabled()]).toEqual([false, true]);
        expect(findChordConflicts(appCommands)).toEqual([]);
        // A tool with no variant of its letter has no such command.
        expect(appCommands.get(nextVariantCommandId({ id: "wand" }))).toBeUndefined();
        expect(appCommands.get(nextVariantCommandId({ id: "hand" }))).toBeUndefined();
    });

    it("run from the palette, a tool's command selects exactly that tool, also while it is selected", () => {
        open();
        const marquee = appCommands.get(selectCommandId({ id: "marquee" }))!;
        const ellipse = appCommands.get(selectCommandId({ id: "ellipse-marquee" }))!;
        toolState.select("ellipse-marquee");
        // As the palette runs a command: only while it is enabled.
        invokeCommand(marquee, () => {});
        expect(toolState.selectedId()).toBe("marquee");
        invokeCommand(marquee, () => {});
        expect(toolState.selectedId()).toBe("marquee");
        invokeCommand(ellipse, () => {});
        expect(toolState.selectedId()).toBe("ellipse-marquee");
        invokeCommand(ellipse, () => {});
        expect(toolState.selectedId()).toBe("ellipse-marquee");
    });
});

describe("the gesture context", () => {
    it("is on while the polygon lasso is open; Enter closes it and does not reach the canvas binding", () => {
        const { session, history } = open();
        const play = recordCanvasEnter();
        try {
            toolState.select("polygon-lasso");
            // No gesture: Enter is the canvas's.
            key("Enter");
            expect(play.calls).toEqual(["canvas Enter"]);
            click(1, 1);
            expect(keyContextStore.getState().gesture).toBe(true);
            click(6, 1);
            click(6, 4);
            click(1, 4);
            expect(findChordConflicts(appCommands)).toEqual([]);
            expect(key("Enter")).toBe(true);
            expect(play.calls).toEqual(["canvas Enter"]);
            expect(keyContextStore.getState().gesture).toBe(false);
            expect(rowsOf(session.selection!.mask)).toEqual([
                "..........",
                ".######...",
                ".######...",
                ".######...",
                ".######...",
                "..........",
                "..........",
                "..........",
            ]);
            expect(history.undoCount).toBe(1);
            // Closed: Enter is the canvas's again.
            key("Enter");
            expect(play.calls).toEqual(["canvas Enter", "canvas Enter"]);
        } finally {
            play.restore();
        }
    });

    it("Escape takes the polygon back, and so does another tool's key", () => {
        const { session, history } = open();
        toolState.select("polygon-lasso");
        click(1, 1);
        click(6, 1);
        click(6, 4);
        expect(key("Escape")).toBe(true);
        expect(keyContextStore.getState().gesture).toBe(false);
        expect(toolPipeline.stroking).toBe(false);
        click(1, 1);
        click(6, 1);
        click(6, 4);
        expect(keyContextStore.getState().gesture).toBe(true);
        key("w");
        expect(toolState.selectedId()).toBe("wand");
        expect(keyContextStore.getState().gesture).toBe(false);
        expect(session.selection).toBeNull();
        expect(history.undoCount).toBe(0);
    });
});
