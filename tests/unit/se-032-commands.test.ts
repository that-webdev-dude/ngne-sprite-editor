import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { findChordConflicts } from "../../src/app/commands/registry";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { createFileDialogs } from "../../src/app/file/dialogs";
import { createFileWorkflows } from "../../src/app/file/workflows";
import { keyContextStore, setKeyContext } from "../../src/app/keymap/contextState";
import { resolveKey } from "../../src/app/keymap/resolve";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import { editorClipboard } from "../../src/app/selection/clipboard.commands";
import { CLIPBOARD_FEEDBACK } from "../../src/app/selection/clipboard";
import { applyFloating, isFloating } from "../../src/app/selection/floating";
import { FLOATING_COMMANDS, LONG_NUDGE } from "../../src/app/selection/floating.commands";
import { floatingState } from "../../src/app/selection/floatingState";
import { MOVE_TOOL_ID } from "../../src/app/selection/move/moveTool";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, isDirty, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { statusStore } from "../../src/app/state/status";
import { TIMELINE_COMMANDS } from "../../src/app/timeline/timelineCommandIds";
import { toolState } from "../../src/app/tools/activeTool";
import { toolRegistry } from "../../src/app/tools/toolRegistry";
import { addFrameCommand } from "../../src/core/frames";
import { celAt, celKey, createDocument } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { rectMask, selectCommand } from "../../src/core/selection";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";
import { fakePlatform, MemoryDisk } from "./se-041-support";

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
        expect(floatingIds.sort()).toEqual(
            [
                `Enter ${FLOATING_COMMANDS.apply}`,
                `Escape ${FLOATING_COMMANDS.cancel}`,
                ...["Left", "Right", "Up", "Down"].flatMap((name) => [
                    `Arrow${name} ${FLOATING_COMMANDS.nudge(name, 1)}`,
                    `Shift+Arrow${name} ${FLOATING_COMMANDS.nudge(name, LONG_NUDGE)}`,
                ]),
            ].sort(),
        );
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
