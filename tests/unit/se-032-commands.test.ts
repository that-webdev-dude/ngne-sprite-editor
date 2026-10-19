import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { findChordConflicts } from "../../src/app/commands/registry";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { createFileDialogs } from "../../src/app/file/dialogs";
import { installFileWorkflows } from "../../src/app/file/install";
import { createFileWorkflows } from "../../src/app/file/workflows";
import { keyContextStore, setKeyContext } from "../../src/app/keymap/contextState";
import { resolveKey } from "../../src/app/keymap/resolve";
import { notices } from "../../src/app/notices/notices";
import {
    ADD_COLOUR,
    MOVE_COLOUR,
    PALETTE_FROM_SPRITE,
    REMOVE_COLOUR,
} from "../../src/app/palette/paletteCommandIds";
import { setCurrentSwatch, setMoveTarget } from "../../src/app/palette/paletteState";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import { editorClipboard } from "../../src/app/selection/clipboard.commands";
import { CLIPBOARD_FEEDBACK } from "../../src/app/selection/clipboard";
import { applyFloating, FloatingApplyError, isFloating } from "../../src/app/selection/floating";
import { FLOATING_COMMANDS } from "../../src/app/selection/floating.commands";
import { floatingState } from "../../src/app/selection/floatingState";
import { MOVE_TOOL_ID } from "../../src/app/selection/move/moveTool";
import { spriteDialogs } from "../../src/app/sprite/dialogs";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, isDirty, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { statusStore } from "../../src/app/state/status";
import { TIMELINE_COMMANDS } from "../../src/app/timeline/timelineCommandIds";
import {
    editProperties,
    initialTimelineState,
    setRenameText,
    timelineStore,
    withArguments,
} from "../../src/app/timeline/timelineState";
import { connectToolMapping, toolPipeline } from "../../src/app/tools/appPipeline";
import { toolState } from "../../src/app/tools/activeTool";
import { toolRegistry } from "../../src/app/tools/toolRegistry";
import { addFrameCommand } from "../../src/core/frames";
import type { PixelAllocator } from "../../src/core/history";
import { celAt, celKey, createDocument } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { serialize } from "../../src/core/project";
import { rectMask, selectCommand } from "../../src/core/selection";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";
import { at, plainMapping } from "./se-014-support";
import { chosen, fakePlatform, MemoryDisk } from "./se-041-support";

// SE-032: the commands of the floating selection and the clipboard in the app's registry —
// their menu items and the keys of SPEC §7.8 in their contexts — and how the app keeps the
// float: Enter applies, Escape and undo cancel, the arrows nudge, the canvas ← → change the
// frame without a selection and lift and nudge with one, a frame switch or another tool
// applies the float to its own cel first, Save applies it (SE-041's `applyFloating` hook).

/** Animation frames that run when the test says so (the app's float follows them). */
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
    timelineStore.setState(initialTimelineState());
    setMoveTarget(null);
    vi.unstubAllGlobals();
});

const W = 8;
const H = 6;

function pattern(seed: number): PixelBuffer {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            data.set([seed * 40 + x * 9, y * 31 + seed, (x + y) * 13, 255], (y * W + x) * 4);
        }
    }
    return { width: W, height: H, data };
}

/** A document of `frames` frames, each cel of the one layer a pattern, frame 1 active. */
function open(frameCount = 1): OpenDocument {
    const session: DocSession = createDocument({ name: "float", width: W, height: H });
    const document = sessionsStore.getState().open(session);
    for (let index = 1; index < frameCount; index++) {
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
    }
    session.doc.frames.forEach((frame, index) => {
        const imageId = `image-${index}`;
        session.doc.images.set(imageId, pattern(index + 1));
        session.doc.cels.set(celKey(session.activeLayerId, frame.id), { imageId, opacity: 255 });
    });
    session.activeFrameId = session.doc.frames[0]!.id;
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

/** Selects the rectangle through the history, as a marquee does. */
function select(rect: { x: number; y: number; width: number; height: number }): void {
    const { session, history } = active();
    const made = selectCommand(session, rectMask(W, H, rect), "replace", "Select");
    if (made) history.execute(made);
}

function celBytes(frame = 0): number[] {
    const { session } = active();
    const cel = celAt(session.doc, session.activeLayerId, session.doc.frames[frame]!.id);
    return Array.from(session.doc.images.get(cel!.imageId)!.data);
}

/** `before` with the rectangle's pixels moved by `dx`, `dy`, the source transparent. */
function moved(
    before: number[],
    rect: { x: number; y: number; width: number; height: number },
    dx: number,
    dy: number,
): number[] {
    const inside = (x: number, y: number) =>
        x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
    const after = [...before];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (inside(x, y)) after.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 4);
        }
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const tx = x + dx;
            const ty = y + dy;
            if (!inside(x, y) || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
            after.splice(
                (ty * W + tx) * 4,
                4,
                ...before.slice((y * W + x) * 4, (y * W + x) * 4 + 4),
            );
        }
    }
    return after;
}

/** A key pressed on the focused viewport, with the floating context as it is now. */
function viewportKey(overrides: Partial<KeyEnvironment> = {}): KeyEnvironment {
    return {
        overlayOpen: false,
        focus: "viewport",
        inTimeline: false,
        nativeKeys: new Set(),
        typeahead: false,
        gesture: false,
        floating: keyContextStore.getState().floating,
        ...overrides,
    };
}

/** The command a chord runs on the viewport now, with its context; run when `run` is set. */
function press(chord: string, run = true): string {
    const resolution = resolveKey(appCommands, chord, viewportKey());
    if (resolution.action !== "run") return resolution.action;
    const { command: found, context } = resolution;
    if (!found.enabled()) return `${context}:${found.id} (disabled)`;
    if (run) void found.run();
    return `${context}:${found.id}`;
}

describe("the commands in the registry", () => {
    it("Cut, Copy, Paste, Delete and Fill take their planned Edit items and the keys of SPEC §7.8", () => {
        const expected: Record<string, string[]> = {
            "edit.cut": ["Ctrl+X"],
            "edit.copy": ["Ctrl+C"],
            "edit.paste": ["Ctrl+V"],
            "edit.delete": ["Delete"],
            "edit.fill": [],
        };
        const table = readSpecKeyTable().bindings;
        for (const [id, shortcuts] of Object.entries(expected)) {
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(command(id), id).toMatchObject({
                planned: false,
                source: "../selection/clipboard.commands.ts",
                menuPath: ["Edit"],
                menuOrder: plan?.menuOrder,
                shortcuts,
            });
            expect(command(id).title(), id).toBe(plan?.title);
            for (const chord of shortcuts) {
                expect(command(id).contexts, id).toEqual(["global"]);
                const row = table.find((binding) => binding.chord === chord);
                expect(row, chord).toMatchObject({ context: "global", text: false });
                expect(row?.row, chord).toMatch(/Cut, copy, paste, delete selection content/);
            }
        }
        const edit = menuCommands(buildMenu(appCommands.list(), ["Edit"])).map((entry) => entry.id);
        expect(edit.slice(2, 7)).toEqual([
            "edit.cut",
            "edit.copy",
            "edit.paste",
            "edit.delete",
            "edit.fill",
        ]);
    });

    it("bind exactly the floating rows of SPEC §7.8 in `floating`, and the arrows with a selection in `canvas`", () => {
        const table = readSpecKeyTable().bindings;
        const floatingIds = appCommands
            .list()
            .filter((entry) => entry.contexts.includes("floating"))
            .flatMap((entry) => entry.shortcuts.map((chord) => `${chord} ${entry.id}`));
        expect(
            floatingIds.map((entry) => entry.split(" ")[0]).sort(),
            "the table's floating rows",
        ).toEqual(
            table
                .filter((binding) => binding.context === "floating")
                .map((binding) => binding.chord)
                .sort(),
        );
        const lifts = table.filter(
            (binding) => binding.context === "canvas" && binding.condition === "selection",
        );
        expect(lifts.map((binding) => binding.chord).sort()).toEqual(
            ["Left", "Right", "Up", "Down"]
                .flatMap((name) => [`Arrow${name}`, `Shift+Arrow${name}`])
                .sort(),
        );
        for (const binding of lifts) {
            const ids = appCommands.bindings("canvas", binding.chord).map((entry) => entry.id);
            expect(
                ids.filter((id) => id.startsWith("selection.liftNudge")),
                binding.chord,
            ).toHaveLength(1);
        }
    });

    it("the Move tool takes its planned rail slot, with its key V", () => {
        const slot = toolRegistry.railSlots().find((entry) => entry.id === MOVE_TOOL_ID);
        expect(slot?.tool?.id).toBe(MOVE_TOOL_ID);
        expect(slot?.tool?.source).toBe("../selection/move/move.tools.ts");
        expect(slot?.shortcut).toBe("V");
        expect(command(`tool.${MOVE_TOOL_ID}`).shortcuts).toEqual(["V"]);
    });

    it("no two enabled commands share a chord: with a selection, while floating, during a whole-cel drag", () => {
        open(3);
        expect(findChordConflicts(appCommands)).toEqual([]);
        select({ x: 1, y: 1, width: 2, height: 2 });
        expect(findChordConflicts(appCommands)).toEqual([]);
        floatingState.lift(active());
        expect(findChordConflicts(appCommands)).toEqual([]);
        floatingState.apply();
        void command("select.none").run();
        floatingState.lift(active(), { whole: true });
        expect(findChordConflicts(appCommands)).toEqual([]);
    });
});

describe("the keys on the canvas (keymap context test)", () => {
    it("with no selection ← and → change the frame; with a selection they lift and nudge; while floating they nudge", () => {
        open(3);
        const ids = () => active().session.doc.frames.map((frame) => frame.id);
        expect(press("ArrowRight")).toBe(`canvas:${TIMELINE_COMMANDS.nextFrameOnCanvas}`);
        expect(active().session.activeFrameId).toBe(ids()[1]);
        expect(press("ArrowLeft")).toBe(`canvas:${TIMELINE_COMMANDS.previousFrameOnCanvas}`);
        expect(active().session.activeFrameId).toBe(ids()[0]);

        const rect = { x: 0, y: 2, width: 3, height: 2 };
        select(rect);
        const steps = active().history.undoCount;
        const before = celBytes();
        expect(press("ArrowLeft")).toBe(`canvas:${FLOATING_COMMANDS.liftNudge("Left", 1)}`);
        // Lifted, nudged, and the Move tool holds it; the frame did not change.
        expect(isFloating()).toBe(true);
        expect(toolState.selectedId()).toBe(MOVE_TOOL_ID);
        expect(active().session.activeFrameId).toBe(ids()[0]);
        expect(celBytes()).toEqual(moved(before, rect, -1, 0));

        expect(press("ArrowLeft")).toBe(`floating:${FLOATING_COMMANDS.nudge("Left", 1)}`);
        expect(press("Shift+ArrowDown")).toBe(`floating:${FLOATING_COMMANDS.nudge("Down", 8)}`);
        expect(press("ArrowUp")).toBe(`floating:${FLOATING_COMMANDS.nudge("Up", 1)}`);
        expect(press("Shift+ArrowUp")).toBe(`floating:${FLOATING_COMMANDS.nudge("Up", 8)}`);
        expect(press("Shift+ArrowRight")).toBe(`floating:${FLOATING_COMMANDS.nudge("Right", 8)}`);
        expect(celBytes()).toEqual(moved(before, rect, 6, -1));
        expect(active().session.activeFrameId).toBe(ids()[0]);
        expect(active().history.undoCount).toBe(steps);

        expect(press("Enter")).toBe(`floating:${FLOATING_COMMANDS.apply}`);
        expect(isFloating()).toBe(false);
        expect(celBytes()).toEqual(moved(before, rect, 6, -1));
        expect(active().history.undoLabel).toBe("Move");
        expect(active().history.undoCount).toBe(steps + 1);
        // The selection moved with the pixels (and was clipped to the canvas).
        expect(active().session.selection?.bounds).toEqual({ x: 6, y: 1, width: 2, height: 2 });
    });

    it("Escape cancels the float and the cel is as it was; nothing is recorded", () => {
        open();
        select({ x: 0, y: 0, width: 4, height: 4 });
        const before = celBytes();
        press("ArrowDown");
        press("Shift+ArrowRight");
        expect(press("Escape")).toBe(`floating:${FLOATING_COMMANDS.cancel}`);
        expect(isFloating()).toBe(false);
        expect(celBytes()).toEqual(before);
        expect(active().history.undoCount).toBe(1);
        expect(active().history.transaction).toBeNull();
    });

    it("the canvas lift is refused on a locked layer, with the status bar saying so", () => {
        open();
        select({ x: 0, y: 0, width: 2, height: 2 });
        active().session.doc.layers[0]!.locked = true;
        press("ArrowRight");
        expect(isFloating()).toBe(false);
        expect(statusStore.getState().feedback).toBe("Layer is locked");
    });
});

describe("undo, switches and the other tools while floating", () => {
    it("undo while floating cancels the float, under the float's own label", () => {
        open();
        select({ x: 1, y: 1, width: 2, height: 2 });
        const before = celBytes();
        press("ArrowRight");
        expect(command("edit.undo").enabled()).toBe(true);
        expect(command("edit.undo").title()).toBe("Undo Move");
        expect(command("edit.redo").enabled()).toBe(false);
        expect(press("Ctrl+Z")).toBe("global:edit.undo");
        expect(isFloating()).toBe(false);
        expect(celBytes()).toEqual(before);
        // The step before the float is undone by the next undo: the selection.
        expect(command("edit.undo").title()).toBe("Undo Select");
        press("Ctrl+Z");
        expect(active().session.selection).toBeNull();
    });

    it("switching the frame while floating applies the float to the original frame first", () => {
        open(2);
        const rect = { x: 0, y: 0, width: 2, height: 3 };
        select(rect);
        const first = celBytes(0);
        const second = celBytes(1);
        press("ArrowRight");
        press("ArrowRight");
        expect(command(TIMELINE_COMMANDS.nextFrame).enabled()).toBe(true);
        void command(TIMELINE_COMMANDS.nextFrame).run();
        const { session, history } = active();
        expect(session.activeFrameId).toBe(session.doc.frames[1]!.id);
        expect(isFloating()).toBe(false);
        expect(celBytes(0)).toEqual(moved(first, rect, 2, 0));
        expect(celBytes(1)).toEqual(second);
        expect(history.undoLabel).toBe("Move");
        history.undo();
        expect(celBytes(0)).toEqual(first);
    });

    it("selecting another tool applies the float; holding one (Space → hand) does not", () => {
        open();
        const rect = { x: 3, y: 3, width: 2, height: 2 };
        select(rect);
        const before = celBytes();
        press("ArrowUp");
        toolState.hold("hand");
        expect(isFloating()).toBe(true);
        toolState.release("hand");
        expect(isFloating()).toBe(true);
        toolState.select("pencil");
        expect(isFloating()).toBe(false);
        expect(celBytes()).toEqual(moved(before, rect, 0, -1));
        expect(active().history.undoLabel).toBe("Move");
    });

    it("applyFloating applies the float of the active document; isFloating follows it", () => {
        expect(isFloating()).toBe(false);
        applyFloating();
        open();
        select({ x: 0, y: 0, width: 1, height: 1 });
        press("ArrowRight");
        expect(isFloating()).toBe(true);
        expect(keyContextStore.getState().floating).toBe(true);
        applyFloating();
        expect(isFloating()).toBe(false);
        expect(active().history.transaction).toBeNull();
        expect(active().history.undoLabel).toBe("Move");
    });

    it("Save while floating applies the float, then saves the document with it", async () => {
        const disk = new MemoryDisk();
        const platform = fakePlatform();
        const dialogs = createFileDialogs();
        dialogs.attachHost();
        const errors: string[] = [];
        const workflows = createFileWorkflows({
            sessions: sessionsStore,
            platform,
            dialogs,
            notices: { info() {}, error: (message) => void errors.push(message) },
        });
        open();
        select({ x: 0, y: 0, width: 2, height: 2 });
        press("ArrowRight");
        expect(workflows.canSave()).toBe(true);
        const handle = disk.handle("float.ngsprite");
        platform.toSave.push(handle);
        expect(await workflows.save()).toBe(true);
        expect(isFloating()).toBe(false);
        expect(handle.writes).toHaveLength(1);
        expect(active().history.undoLabel).toBe("Move");
        expect(isDirty(active())).toBe(false);
        expect(errors).toEqual([]);
    });
});

describe("the clipboard commands of the app", () => {
    it("copy and paste within the app (no system clipboard in Node): the region byte for byte, and the status bar says why", async () => {
        open();
        const rect = { x: 1, y: 2, width: 3, height: 2 };
        select(rect);
        const before = celBytes();
        expect(command("edit.copy").enabled()).toBe(true);
        await command("edit.copy").run();
        expect(statusStore.getState().feedback).toBe(CLIPBOARD_FEEDBACK.copiedInEditor);
        expect(editorClipboard.content?.pixels.width).toBe(3);

        await command("edit.paste").run();
        expect(statusStore.getState().feedback).toBe(CLIPBOARD_FEEDBACK.pastedFromEditor);
        expect(isFloating()).toBe(true);
        expect(toolState.selectedId()).toBe(MOVE_TOOL_ID);
        // No viewport: centred on the document, at whole pixels.
        const float = floatingState.float!;
        expect(float.bounds).toEqual({ x: 3, y: 2, width: 3, height: 2 });
        floatingState.moveTo(0, 0);
        press("Enter");
        const after = celBytes();
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 3; x++) {
                const from = ((rect.y + y) * W + rect.x + x) * 4;
                const to = (y * W + x) * 4;
                expect(after.slice(to, to + 4), `${x},${y}`).toEqual(before.slice(from, from + 4));
            }
        }
        expect(active().history.undoLabel).toBe("Paste");
    });

    it("Delete and Fill act on the selection; Cut copies and clears in one step", async () => {
        open();
        const rect = { x: 0, y: 0, width: 2, height: 1 };
        select(rect);
        editorStore.getState().setForeground(0x102030ff);
        void command("edit.fill").run();
        expect(celBytes().slice(0, 8)).toEqual([16, 32, 48, 255, 16, 32, 48, 255]);
        expect(active().history.undoLabel).toBe("Fill");
        void command("edit.delete").run();
        expect(celBytes().slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(active().history.undoLabel).toBe("Delete");
        active().history.undo();
        const steps = active().history.undoCount;
        await command("edit.cut").run();
        expect(celBytes().slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(active().history.undoCount).toBe(steps + 1);
        expect(active().history.undoLabel).toBe("Cut");
        expect(Array.from(editorClipboard.content!.pixels.data)).toEqual([
            16, 32, 48, 255, 16, 32, 48, 255,
        ]);
        // Without a selection there is nothing to cut, copy, delete or fill; paste remains.
        void command("select.none").run();
        for (const id of ["edit.cut", "edit.copy", "edit.delete", "edit.fill"]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        expect(command("edit.paste").enabled()).toBe(true);
    });
});

// SE-032 review (A): Escape during a drag of the Move tool takes back that drag only.
describe("Escape during a drag of the Move tool", () => {
    it("during a later drag it takes back that drag and the pixels float on; during the drag that lifted them it cancels the float", () => {
        const document = open();
        sessionsStore.getState().setView(document.id, { scale: 8, originX: 0, originY: 0 });
        const disconnect = connectToolMapping(() => plainMapping(sessionsStore));
        try {
            const view = { document: active };
            select({ x: 1, y: 1, width: 2, height: 2 });
            toolState.select(MOVE_TOOL_ID);
            const steps = active().history.undoCount;
            const before = celBytes();
            toolPipeline.down(at(view, { x: 1, y: 1 }, { button: 0, buttons: 1 }));
            toolPipeline.move([at(view, { x: 3, y: 2 })]);
            toolPipeline.up(at(view, { x: 3, y: 2 }, { button: 0, buttons: 0 }));
            expect(isFloating()).toBe(true);
            const afterFirst = celBytes();
            expect(afterFirst).toEqual(moved(before, { x: 1, y: 1, width: 2, height: 2 }, 2, 1));

            // A press on the float, a move, Escape: the drag is taken back, the float stays.
            toolPipeline.down(at(view, { x: 3, y: 2 }, { button: 0, buttons: 1 }));
            toolPipeline.move([at(view, { x: 5, y: 4 })]);
            expect(celBytes()).not.toEqual(afterFirst);
            expect(press("Escape")).toBe(`floating:${FLOATING_COMMANDS.cancel}`);
            expect(toolPipeline.stroking).toBe(false);
            expect(isFloating()).toBe(true);
            expect(celBytes()).toEqual(afterFirst);
            // The release finds no drag.
            toolPipeline.up(at(view, { x: 5, y: 4 }, { button: 0, buttons: 0 }));
            expect(isFloating()).toBe(true);
            expect(celBytes()).toEqual(afterFirst);
            expect(active().history.transaction).not.toBeNull();

            // Escape with no drag cancels the float.
            expect(press("Escape")).toBe(`floating:${FLOATING_COMMANDS.cancel}`);
            expect(isFloating()).toBe(false);
            expect(celBytes()).toEqual(before);

            // Escape during the drag that lifted the pixels cancels the float.
            toolPipeline.down(at(view, { x: 2, y: 2 }, { button: 0, buttons: 1 }));
            toolPipeline.move([at(view, { x: 4, y: 4 })]);
            expect(isFloating()).toBe(true);
            press("Escape");
            expect(toolPipeline.stroking).toBe(false);
            expect(isFloating()).toBe(false);
            expect(celBytes()).toEqual(before);
            expect(active().history.undoCount).toBe(steps);
            expect(active().history.transaction).toBeNull();
        } finally {
            disconnect();
        }
    });
});

// SE-032 review (B, C, E): the commands that apply the float first are enabled while it
// floats, and only a stroke disables them.
describe("commands that apply the float first, with a real float", () => {
    /** Lifts the selection by the canvas arrow: a float of one pixel's move. */
    function float(): void {
        select({ x: 1, y: 1, width: 3, height: 2 });
        press("ArrowRight");
        expect(isFloating()).toBe(true);
    }

    /** The labels of the steps undo would take back, newest first, `count` of them. */
    function labels(count: number): (string | null)[] {
        const { history } = active();
        const found: (string | null)[] = [];
        for (let index = 0; index < count; index++) {
            found.push(history.undoLabel);
            history.undo();
        }
        for (let index = 0; index < count; index++) history.redo();
        return found;
    }

    const SPRITE_COMMANDS = [
        "sprite.canvasSize",
        "sprite.spriteSize",
        "sprite.crop",
        "sprite.trim",
        "sprite.rotate90",
        "sprite.rotate180",
        "sprite.flipHorizontal",
        "sprite.flipVertical",
        "sprite.properties",
    ];

    it("the sprite-wide commands and Sprite Properties: enabled while floating, a Move step then theirs; disabled during a stroke", async () => {
        open();
        float();
        for (const id of SPRITE_COMMANDS) expect(command(id).enabled(), id).toBe(true);
        const steps = active().history.undoCount;
        void command("sprite.rotate180").run();
        expect(isFloating()).toBe(false);
        expect(active().history.undoCount).toBe(steps + 2);
        expect(labels(2)).toEqual(["Rotate Canvas 180°", "Move"]);

        // Sprite Properties applies the float before its dialog (no host: cancelled at once).
        float();
        const before = active().history.undoCount;
        await command("sprite.properties").run();
        expect(isFloating()).toBe(false);
        expect(active().history.undoCount).toBe(before + 1);
        expect(active().history.undoLabel).toBe("Move");

        const { session, history } = active();
        const stroke = history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        for (const id of SPRITE_COMMANDS) expect(command(id).enabled(), id).toBe(false);
        stroke.abort();
    });

    it("Select All, Deselect and Invert: Ctrl+D after a paste drops the pixels in place and deselects; each applies the float first", async () => {
        open();
        const rect = { x: 0, y: 0, width: 2, height: 2 };
        select(rect);
        const before = celBytes();
        await command("edit.copy").run();
        await command("edit.paste").run();
        expect(isFloating()).toBe(true);
        floatingState.moveTo(5, 3);
        expect(press("Ctrl+D")).toBe("global:select.none");
        expect(isFloating()).toBe(false);
        expect(active().session.selection).toBeNull();
        expect(labels(2)).toEqual(["Deselect", "Paste"]);
        const after = celBytes();
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
                const from = (y * W + x) * 4;
                const to = ((3 + y) * W + 5 + x) * 4;
                expect(after.slice(to, to + 4)).toEqual(before.slice(from, from + 4));
            }
        }

        float();
        expect(press("Ctrl+A")).toBe("global:select.all");
        expect(isFloating()).toBe(false);
        expect(labels(2)).toEqual(["Select All", "Move"]);
        float();
        expect(press("Ctrl+I")).toBe("global:select.invert");
        expect(isFloating()).toBe(false);
        expect(labels(2)).toEqual(["Invert Selection", "Move"]);

        const { session, history } = active();
        const stroke = history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        for (const id of ["select.all", "select.none", "select.invert"]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        stroke.abort();
    });

    it("the palette's commands, swatch reorder included: enabled while floating, a Move step then theirs; disabled during a stroke", () => {
        open();
        editorStore.getState().setForeground(0x123456ff);
        float();
        expect(command(ADD_COLOUR).enabled()).toBe(true);
        void command(ADD_COLOUR).run();
        expect(isFloating()).toBe(false);
        expect(active().session.doc.palette.colors).toContain(0x123456ff);
        expect(labels(2)).toEqual(["Add Current Colour", "Move"]);

        editorStore.getState().setForeground(0x654321ff);
        void command(ADD_COLOUR).run();
        const colours = () => active().session.doc.palette.colors;
        const first = colours().indexOf(0x123456ff);
        const last = colours().length - 1;
        expect(colours()[last]).toBe(0x654321ff);
        float();
        // The last swatch dragged before the first one added.
        setCurrentSwatch(last);
        setMoveTarget(first);
        expect(command(MOVE_COLOUR).enabled()).toBe(true);
        expect(command(REMOVE_COLOUR).enabled()).toBe(true);
        expect(command(PALETTE_FROM_SPRITE).enabled()).toBe(true);
        void command(MOVE_COLOUR).run();
        expect(isFloating()).toBe(false);
        expect(colours().slice(first, first + 2)).toEqual([0x654321ff, 0x123456ff]);
        expect(labels(2)).toEqual(["Move Colour", "Move"]);

        const { session, history } = active();
        const stroke = history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        // The current swatch is the moved one: a target after it is valid but for the stroke.
        setMoveTarget(first + 1);
        for (const id of [ADD_COLOUR, REMOVE_COLOUR, MOVE_COLOUR, PALETTE_FROM_SPRITE]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        stroke.abort();
        setMoveTarget(null);
    });

    it("the timeline's apply commands (SE-022): rename, layer properties and frame duration apply a real float, a Move step then theirs", () => {
        open(2);
        const layer = () => active().session.doc.layers[0]!;
        float();
        void command(TIMELINE_COMMANDS.renameLayer).run();
        setRenameText("Ink");
        expect(command(TIMELINE_COMMANDS.applyLayerName).enabled()).toBe(true);
        void command(TIMELINE_COMMANDS.applyLayerName).run();
        expect(isFloating()).toBe(false);
        expect(layer().name).toBe("Ink");
        expect(labels(2)[1]).toBe("Move");

        float();
        void command(TIMELINE_COMMANDS.layerProperties).run();
        editProperties({ opacity: 100 });
        const steps = active().history.undoCount;
        void command(TIMELINE_COMMANDS.applyLayerProperties).run();
        expect(isFloating()).toBe(false);
        expect(layer().opacity).toBe(100);
        expect(active().history.undoCount).toBe(steps + 2);
        expect(labels(2)[1]).toBe("Move");

        float();
        const before = active().history.undoCount;
        withArguments({ duration: 250 }, () => void command(TIMELINE_COMMANDS.setDuration).run());
        expect(isFloating()).toBe(false);
        expect(active().session.doc.frames[0]!.durationMs).toBe(250);
        expect(active().history.undoCount).toBe(before + 2);
        expect(labels(2)[1]).toBe("Move");
    });
});

// SE-032 review (D): the file workflows and New Sprite apply the float first, so the question
// before unsaved changes are lost covers it; the unload guard is armed while it floats.
describe("the file workflows while floating", () => {
    function workflowsOf() {
        const platform = fakePlatform();
        const dialogs = createFileDialogs();
        const detach = dialogs.attachHost();
        const questions: string[] = [];
        dialogs.store.subscribe(({ request }) => {
            if (request) questions.push(`${request.action} ${request.document}`);
        });
        const notes: string[] = [];
        const workflows = createFileWorkflows({
            sessions: sessionsStore,
            platform,
            dialogs,
            notices: {
                info: (message) => void notes.push(`info: ${message}`),
                error: (message) => void notes.push(`error: ${message}`),
            },
        });
        /** Answers the question once it is asked: true discards, null keeps the document. */
        const answer = async (discard: true | null) => {
            const asked = await vi.waitFor(() => {
                const request = dialogs.store.getState().request;
                if (!request) throw new Error("no question yet");
                return request;
            });
            asked.answer(discard);
        };
        return { platform, dialogs, detach, questions, notes, workflows, answer };
    }

    /** A clean document (saved where it is) with a floating selection. */
    function cleanWithFloat(): OpenDocument {
        const document = open();
        select({ x: 1, y: 1, width: 2, height: 2 });
        sessionsStore.getState().markSaved(document.id);
        press("ArrowRight");
        expect(isFloating()).toBe(true);
        expect(isDirty(active())).toBe(false);
        return active();
    }

    it("Open, Close and Revert are enabled while floating; disabled during a stroke", () => {
        const document = cleanWithFloat();
        expect(command("file.open").enabled()).toBe(true);
        expect(command("file.close").enabled()).toBe(true);
        expect(command("file.revert").enabled()).toBe(false);
        floatingState.cancel();
        const stroke = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        for (const id of ["file.open", "file.close", "file.save", "file.saveAs"]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        stroke.abort();
    });

    it("Close applies the float first and asks: Cancel keeps the document with the float applied, Discard closes it", async () => {
        const { detach, questions, notes, workflows, answer } = workflowsOf();
        const document = cleanWithFloat();
        let closing = workflows.close();
        await answer(null);
        expect(await closing).toBe(false);
        expect(questions).toEqual(["close float"]);
        expect(isFloating()).toBe(false);
        expect(active().history.undoLabel).toBe("Move");
        closing = workflows.close();
        await answer(true);
        expect(await closing).toBe(true);
        expect(sessionsStore.getState().documents.some((entry) => entry.id === document.id)).toBe(
            false,
        );
        expect(notes).toEqual([]);
        detach();
    });

    it("a dropped project opens once read in a tab of its own: the float is applied, nothing is asked; an unreadable one changes nothing (SE-047)", async () => {
        const { detach, questions, notes, workflows } = workflowsOf();
        const floated = cleanWithFloat();
        expect(
            await workflows.openFiles([chosen("bad.ngsprite", new Uint8Array([1, 2, 3]), null)]),
        ).toBe(false);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatch(/^error: Could not open “bad\.ngsprite”\./);
        expect(notes[0]).not.toMatch(/stroke/);
        expect(isFloating()).toBe(true);
        expect(questions).toEqual([]);

        const bytes = serialize(
            createDocument({ name: "dropped", width: 3, height: 3 }).doc,
            new Map(),
        );
        expect(await workflows.openFiles([chosen("dropped.ngsprite", bytes, null)])).toBe(true);
        // The float landed in its document, which stays open beside the new one.
        expect(questions).toEqual([]);
        expect(isFloating()).toBe(false);
        expect(active().session.doc.name).toBe("dropped");
        const kept = sessionsStore
            .getState()
            .documents.find((entry) => entry.session === floated.session)!;
        expect(kept.history.undoLabel).toBe("Move");
        expect(kept.history.transaction).toBeNull();
        expect(notes.slice(1)).toEqual(["info: Opened dropped.ngsprite"]);
        detach();
    });

    it("Revert applies the float first and asks; Discard reads the file again", async () => {
        const { platform, detach, questions, notes, workflows, answer } = workflowsOf();
        open();
        select({ x: 1, y: 1, width: 2, height: 2 });
        const saved = celBytes();
        const disk = new MemoryDisk();
        platform.toSave.push(disk.handle("float.ngsprite"));
        expect(await workflows.save()).toBe(true);
        press("ArrowRight");
        expect(isFloating()).toBe(true);
        expect(workflows.canAct()).toBe(true);
        const reverting = workflows.revert();
        await answer(true);
        expect(await reverting).toBe(true);
        expect(questions).toEqual(["revert float"]);
        expect(isFloating()).toBe(false);
        expect(celBytes()).toEqual(saved);
        expect(notes).toEqual(["info: Saved float.ngsprite", "info: Reverted to float.ngsprite"]);
        detach();
    });

    it("New Sprite applies the float before its dialog, which has nothing to discard (SE-047)", async () => {
        const detach = spriteDialogs.attachHost();
        try {
            cleanWithFloat();
            const done = command("file.new").run();
            const request = spriteDialogs.store.getState().request;
            expect(request?.kind).toBe("new-sprite");
            expect(request?.kind === "new-sprite" ? request.discards : undefined).toBeNull();
            expect(isFloating()).toBe(false);
            expect(active().history.undoLabel).toBe("Move");
            if (request?.kind === "new-sprite") request.answer(null);
            await done;
        } finally {
            detach();
        }
    });

    it("the unload guard is armed while a selection floats on a clean document", () => {
        let listeners = 0;
        const target = {
            addEventListener: (type: string) => void (type === "beforeunload" && listeners++),
            removeEventListener: (type: string) => void (type === "beforeunload" && listeners--),
        };
        const stop = installFileWorkflows({
            target,
            workflows: { busy: false, openFiles: async () => false },
            overlayOpen: () => false,
        });
        try {
            open();
            select({ x: 1, y: 1, width: 2, height: 2 });
            sessionsStore.getState().markSaved(active().id);
            expect(listeners).toBe(0);
            press("ArrowRight");
            expect(isDirty(active())).toBe(false);
            expect(listeners).toBe(1);
            floatingState.cancel();
            expect(listeners).toBe(0);
            press("ArrowRight");
            expect(listeners).toBe(1);
            press("Enter");
            // Applied: the document is dirty now, and stays guarded.
            expect(isDirty(active())).toBe(true);
            expect(listeners).toBe(1);
        } finally {
            stop();
        }
        expect(listeners).toBe(0);
    });
});

// SE-032 review (F): a float that cannot be applied is reported by a toast and taken back;
// `applyFloating` throws, so Save says it could not save.
describe("a float that cannot be applied", () => {
    it("is reported by a toast and taken back; applyFloating throws; Save reports that it could not save and writes nothing", async () => {
        const toasts: string[] = [];
        const detachSink = notices.attachSink(
            (kind, message) => void toasts.push(`${kind}: ${message}`),
        );
        let failing = false;
        const allocate: PixelAllocator = (length) => {
            if (failing) throw new RangeError("out of memory");
            return new Uint8ClampedArray(length);
        };
        const session = createDocument({ name: "float", width: W, height: H });
        session.doc.images.set("image-0", pattern(1));
        session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
            imageId: "image-0",
            opacity: 255,
        });
        sessionsStore.getState().open(session, { history: { allocate } });
        try {
            select({ x: 0, y: 0, width: 2, height: 2 });
            const selection = active().session.selection;
            const before = celBytes();
            press("ArrowDown");
            failing = true;
            expect(() => applyFloating()).toThrow(FloatingApplyError);
            expect(isFloating()).toBe(false);
            expect(celBytes()).toEqual(before);
            expect(active().session.selection).toBe(selection);
            expect(active().history.transaction).toBeNull();
            expect(toasts).toHaveLength(1);
            expect(toasts[0]).toMatch(/^error: Could not apply the floating selection\. /);

            failing = false;
            press("ArrowDown");
            failing = true;
            const platform = fakePlatform();
            const disk = new MemoryDisk();
            const handle = disk.handle("float.ngsprite");
            platform.toSave.push(handle);
            const errors: string[] = [];
            const infos: string[] = [];
            const workflows = createFileWorkflows({
                sessions: sessionsStore,
                platform,
                dialogs: createFileDialogs(),
                notices: {
                    info: (message) => void infos.push(message),
                    error: (message) => void errors.push(message),
                },
            });
            expect(await workflows.save()).toBe(false);
            expect(errors).toEqual([
                "Could not save “float.ngsprite”. The floating selection could not be applied.",
            ]);
            expect(infos).toEqual([]);
            expect(handle.writes).toHaveLength(0);
            expect(platform.toSave).toHaveLength(1);
            expect(toasts).toHaveLength(2);
            expect(celBytes()).toEqual(before);
        } finally {
            detachSink();
        }
    });
});
