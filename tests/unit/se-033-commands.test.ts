import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { FLOATING_COMMANDS } from "../../src/app/selection/floating.commands";
import { floatingState, TRANSFORM_LABEL } from "../../src/app/selection/floatingState";
import { MOVE_TOOL_ID } from "../../src/app/selection/move/moveTool";
import { TRANSFORM_COMMANDS } from "../../src/app/selection/transform/transform.commands";
import { draftTransform, transformDraft } from "../../src/app/selection/transform/transformDraft";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { statusStore } from "../../src/app/state/status";
import { toolState } from "../../src/app/tools/activeTool";
import { celAt, celKey, createDocument } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { rectMask, selectCommand } from "../../src/core/selection";
import {
    collectContextBarContent,
    shownContextBarContent,
} from "../../src/ui/tools/contextBarRegistry";
import type { ContextBarContent } from "../../src/ui/tools/contextBarRegistry";
import { contextBarContent } from "../../src/ui/tools/transform.contextbar";

// SE-033: the transform commands of the app's registry (SPEC §7.2): Flip Horizontal, Flip
// Vertical, Rotate 90° CW / CCW and Rotate 180° take the Edit menu's planned items. With a
// selection they lift it into a float of the Move tool and transform it; while pixels float
// they transform the float; with no selection they turn the whole cel in one step. Set
// Transform takes the context bar's typed values. Apply is one undo step, undo while floating
// cancels, and a stroke disables them. The context bar shows the transform fields exactly
// while a selection floats.

const frames = vi.hoisted(() => ({ next: 1, queue: new Map<number, () => void>() }));

beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
        const id = frames.next++;
        frames.queue.set(id, callback);
        return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => void frames.queue.delete(id));
});

afterEach(() => {
    floatingState.cancel();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    frames.queue.clear();
    editorStore.getState().setTool(DEFAULT_TOOL);
    setKeyContext("floating", false);
    statusStore.getState().setFeedback(null);
    transformDraft.setState({ draft: null });
    vi.unstubAllGlobals();
});

const W = 6;
const H = 4;

function pattern(): PixelBuffer {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            data.set([30 + x * 30, 40 + y * 50, (x * 13 + y * 5) & 255, 255], (y * W + x) * 4);
        }
    }
    return { width: W, height: H, data };
}

function open(image: PixelBuffer | null = pattern()): OpenDocument {
    const session: DocSession = createDocument({ name: "t", width: W, height: H });
    const document = sessionsStore.getState().open(session);
    if (image) {
        session.doc.images.set("img", image);
        session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
            imageId: "img",
            opacity: 255,
        });
    }
    sessionsStore.getState().touch(document.id);
    return active();
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no active document");
    return document;
}

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

function run(id: string): void {
    const found = command(id);
    expect(found.enabled()).toBe(true);
    void found.run();
}

function select(rect: { x: number; y: number; width: number; height: number }): void {
    const { session, history } = active();
    const made = selectCommand(session, rectMask(W, H, rect), "replace", "Select");
    if (made) history.execute(made);
}

function bytes(): number[] {
    const { session } = active();
    const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId);
    return Array.from(session.doc.images.get(cel!.imageId)!.data);
}

function rgba(data: number[], x: number, y: number): number[] {
    return data.slice((y * W + x) * 4, (y * W + x) * 4 + 4);
}

const TRANSFORM_IDS = [
    TRANSFORM_COMMANDS.flipHorizontal,
    TRANSFORM_COMMANDS.flipVertical,
    TRANSFORM_COMMANDS.rotate90cw,
    TRANSFORM_COMMANDS.rotate90ccw,
    TRANSFORM_COMMANDS.rotate180,
];

describe("the transform commands", () => {
    it("take the Edit menu items planned for them, in their places", () => {
        for (const id of TRANSFORM_IDS) {
            const planned = plannedCommands.find((entry) => entry.id === id);
            expect(planned, id).toBeDefined();
            const registered = command(id);
            expect(registered.planned).toBe(false);
            expect(registered.title()).toBe(planned!.title);
            expect(registered.menuPath).toEqual(planned!.menuPath);
            expect(registered.menuOrder).toBe(planned!.menuOrder);
        }
    });

    it("with a selection: Flip Horizontal lifts it into a float of the Move tool, mirrored; Enter applies one Transform step; undo restores", () => {
        open();
        toolState.select("pencil");
        const rect = { x: 1, y: 1, width: 3, height: 2 };
        select(rect);
        const before = bytes();
        const { history } = active();
        const steps = history.undoCount;
        run(TRANSFORM_COMMANDS.flipHorizontal);
        expect(floatingState.floats()).toBe(true);
        expect(toolState.selectedId()).toBe(MOVE_TOOL_ID);
        const shown = bytes();
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const inside = x >= 1 && x < 4 && y >= 1 && y < 3;
                expect(rgba(shown, x, y)).toEqual(rgba(before, inside ? 1 + 3 - x : x, y));
            }
        }
        run(FLOATING_COMMANDS.apply);
        expect(floatingState.floats()).toBe(false);
        expect(history.undoCount).toBe(steps + 1);
        expect(history.undoLabel).toBe(TRANSFORM_LABEL);
        expect(bytes()).toEqual(shown);
        run("edit.undo");
        expect(bytes()).toEqual(before);
        expect(active().session.selection?.bounds).toEqual(rect);
    });

    it("while pixels float: the turns act on the float; undo cancels it, the cel as before the lift", () => {
        open();
        select({ x: 0, y: 0, width: 2, height: 2 });
        const before = bytes();
        run(TRANSFORM_COMMANDS.rotate90cw);
        const once = floatingState.float!.content;
        run(TRANSFORM_COMMANDS.rotate90cw);
        run(TRANSFORM_COMMANDS.rotate90ccw);
        expect(Array.from(floatingState.float!.content.pixels.data)).toEqual(
            Array.from(once.pixels.data),
        );
        run(TRANSFORM_COMMANDS.rotate180);
        run(TRANSFORM_COMMANDS.flipVertical);
        expect(floatingState.floats()).toBe(true);
        expect(command("edit.undo").title()).toBe(`Undo ${TRANSFORM_LABEL}`);
        run("edit.undo");
        expect(floatingState.floats()).toBe(false);
        expect(bytes()).toEqual(before);
        expect(active().history.undoLabel).toBe("Select");
    });

    it("with no selection: the whole cel is turned about the canvas centre in one step named after the command", () => {
        open();
        const before = bytes();
        const { history } = active();
        run(TRANSFORM_COMMANDS.rotate180);
        expect(floatingState.floats()).toBe(false);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Rotate 180°");
        const after = bytes();
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                expect(rgba(after, x, y)).toEqual(rgba(before, W - 1 - x, H - 1 - y));
            }
        }
        expect(active().session.selection).toBeNull();
        run(TRANSFORM_COMMANDS.flipVertical);
        expect(history.undoLabel).toBe("Flip Vertical");
        history.undo();
        history.undo();
        expect(bytes()).toEqual(before);
        // An empty cel has nothing to turn: no step, no cel.
        const empty = open(null);
        run(TRANSFORM_COMMANDS.flipHorizontal);
        expect(empty.history.undoCount).toBe(0);
        expect(empty.session.doc.cels.size).toBe(0);
    });

    it("are refused on a locked layer, with the status bar saying so", () => {
        open();
        select({ x: 0, y: 0, width: 2, height: 2 });
        active().session.doc.layers[0]!.locked = true;
        const before = bytes();
        run(TRANSFORM_COMMANDS.flipHorizontal);
        expect(statusStore.getState().feedback).toBe("Layer is locked");
        expect(floatingState.floats()).toBe(false);
        expect(bytes()).toEqual(before);
    });

    it("are disabled during a stroke, enabled while pixels float", () => {
        const document = open();
        const stroke = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        for (const id of TRANSFORM_IDS) expect(command(id).enabled(), id).toBe(false);
        stroke.abort();
        select({ x: 0, y: 0, width: 2, height: 2 });
        floatingState.lift(active());
        for (const id of TRANSFORM_IDS) expect(command(id).enabled(), id).toBe(true);
    });
});

describe("Set Transform (the context bar's fields)", () => {
    it("sets the typed box and angle on the float, taking the draft once; disabled without a selection floating", () => {
        open();
        expect(command(TRANSFORM_COMMANDS.set).enabled()).toBe(false);
        select({ x: 1, y: 1, width: 2, height: 2 });
        floatingState.lift(active());
        expect(command(TRANSFORM_COMMANDS.set).enabled()).toBe(true);
        draftTransform({ x: 0, y: 0, width: 4, height: 3, angle: 0 });
        run(TRANSFORM_COMMANDS.set);
        expect(floatingState.float?.transform).toEqual({
            x: 0,
            y: 0,
            width: 4,
            height: 3,
            angle: 0,
        });
        expect(transformDraft.getState().draft).toBeNull();
        // Nothing typed: nothing changes.
        run(TRANSFORM_COMMANDS.set);
        expect(floatingState.float?.transform).toEqual({
            x: 0,
            y: 0,
            width: 4,
            height: 3,
            angle: 0,
        });
        run(FLOATING_COMMANDS.apply);
        expect(active().history.undoLabel).toBe(TRANSFORM_LABEL);
    });
});

describe("the context bar's registered content", () => {
    it("shows the transform fields exactly while a selection floats in the active document", () => {
        expect(contextBarContent.shown()).toBe(false);
        open();
        expect(contextBarContent.shown()).toBe(false);
        // A whole cel lifted (no selection) has no fields.
        floatingState.lift(active(), { whole: true });
        expect(contextBarContent.shown()).toBe(false);
        floatingState.cancel();
        select({ x: 1, y: 1, width: 2, height: 2 });
        let told = 0;
        const stop = contextBarContent.subscribe(() => void told++);
        floatingState.lift(active());
        expect(told).toBeGreaterThan(0);
        expect(contextBarContent.shown()).toBe(true);
        expect(shownContextBarContent([contextBarContent])).toBe(contextBarContent);
        floatingState.apply();
        expect(contextBarContent.shown()).toBe(false);
        expect(shownContextBarContent([contextBarContent])).toBeNull();
        stop();
    });

    it("is discovered by id, ordered, and refuses a duplicate id", () => {
        const entry = (id: string, order: number): ContextBarContent => ({
            id,
            order,
            shown: () => true,
            subscribe: () => () => undefined,
            Body: () => null,
        });
        const listed = collectContextBarContent({
            "a.contextbar.tsx": { contextBarContent: entry("b", 20) },
            "b.contextbar.tsx": { contextBarContent: entry("a", 10) },
        });
        expect(listed.map((item) => item.id)).toEqual(["a", "b"]);
        expect(() =>
            collectContextBarContent({
                "a.contextbar.tsx": { contextBarContent: entry("a", 1) },
                "b.contextbar.tsx": { contextBarContent: entry("a", 2) },
            }),
        ).toThrow(/used by a.contextbar.tsx and b.contextbar.tsx/);
        expect(() => collectContextBarContent({ "c.contextbar.tsx": {} })).toThrow(
            /does not export/,
        );
    });
});
