import { afterEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import { findChordConflicts } from "../../src/app/commands/registry";
import type { Command } from "../../src/app/commands/types";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { beginDurationEdit, shownDuration } from "../../src/app/timeline/frameDuration";
import { clickTimeline } from "../../src/app/timeline/timelineClicks";
import { TIMELINE_COMMANDS as IDS } from "../../src/app/timeline/timelineCommandIds";
import { activateCel } from "../../src/app/timeline/timelineDocument";
import {
    cancelRename,
    editProperties,
    endDurationEdit,
    initialTimelineState,
    setRenameText,
    timelineStore,
    withArguments,
} from "../../src/app/timeline/timelineState";
import { celKey, createDocument } from "../../src/core/model";
import { rectMask, selectionOf } from "../../src/core/selection";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";

// SE-022: the timeline's commands in the app's registry — their menu items, keys and contexts,
// what they do to the active document and its history, and the rule that a switch of the
// active frame or layer applies a floating selection first.

/**
 * Calls of `applyFloating` (SE-032's hook), each with the active frame's index and the active
 * layer's name at the call: what the session was before the switch. With `commit`, the hook
 * does what SE-032's will: it commits the transaction that holds the floating pixels, as one
 * step ("Move").
 */
const floating = vi.hoisted(() => ({ calls: [] as string[], commit: false }));
vi.mock("../../src/app/selection/floating", async () => {
    const sessions = await import("../../src/app/state/sessions");
    return {
        applyFloating: () => {
            const document = sessions.activeDocument(sessions.sessionsStore.getState());
            if (!document) return;
            const { doc, activeFrameId, activeLayerId } = document.session;
            const frame = doc.frames.findIndex((entry) => entry.id === activeFrameId);
            const layer = doc.layers.find((entry) => entry.id === activeLayerId)?.name;
            floating.calls.push(`frame ${frame + 1}, ${layer}`);
            const transaction = document.history.transaction;
            if (!floating.commit || !transaction) return;
            transaction.image.data[3] = transaction.image.data[3] === 255 ? 0 : 255;
            transaction.markDirty({ x: 0, y: 0, width: 1, height: 1 });
            transaction.commit("Move");
        },
    };
});

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    timelineStore.setState(initialTimelineState());
    setKeyContext("floating", false);
    floating.calls.length = 0;
    floating.commit = false;
});

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

/** Runs a command as the registry's callers do: only while enabled. Returns whether it ran. */
function run(id: string): boolean {
    const found = command(id);
    if (!found.enabled()) return false;
    void found.run();
    return true;
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document is open");
    return document;
}

function open(): OpenDocument {
    return sessionsStore.getState().open(createDocument({ name: "t", width: 4, height: 4 }));
}

/** A document with `layers` pixel layers ("Layer 1" at the bottom) and `frames` frames. */
function openWith(layers: number, frames: number): OpenDocument {
    open();
    for (let index = 1; index < layers; index++) run(IDS.newLayer);
    for (let index = 1; index < frames; index++) run(IDS.newEmptyFrame);
    return active();
}

/** What the model holds: layers, frames, cels, active cel. */
function snapshot(document: OpenDocument = active()) {
    const { doc, activeLayerId, activeFrameId } = document.session;
    return {
        layers: doc.layers.map(({ id, name, visible, locked, opacity }) => ({
            id,
            name,
            visible,
            locked,
            opacity,
        })),
        frames: doc.frames.map(({ id, durationMs }) => ({ id, durationMs })),
        cels: [...doc.cels.entries()].map(([key, cel]) => [key, cel.imageId, cel.opacity]),
        images: [...doc.images.keys()],
        activeLayerId,
        activeFrameId,
    };
}

const frameIndex = () => {
    const { doc, activeFrameId } = active().session;
    return doc.frames.findIndex((frame) => frame.id === activeFrameId);
};
const layerName = () => {
    const { doc, activeLayerId } = active().session;
    return doc.layers.find((layer) => layer.id === activeLayerId)?.name;
};
const frameAt = (index: number) => active().session.doc.frames[index]?.id ?? "";
const layerNamed = (name: string) =>
    active().session.doc.layers.find((layer) => layer.name === name)?.id ?? "";

/** The planned ids this ticket implements, and the menu each was planned in. */
const IMPLEMENTED = [
    IDS.newLayer,
    IDS.duplicateLayer,
    IDS.deleteLayer,
    IDS.layerProperties,
    IDS.newFrame,
    IDS.newEmptyFrame,
    IDS.deleteFrame,
    IDS.firstFrame,
    IDS.previousFrame,
    IDS.nextFrame,
    IDS.lastFrame,
    IDS.toggleTimeline,
];

describe("the timeline's commands in the registry", () => {
    it("take the menu items planned for them", () => {
        for (const id of IMPLEMENTED) {
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(plan, id).toBeDefined();
            expect(command(id), id).toMatchObject({
                planned: false,
                menuPath: plan?.menuPath,
                menuOrder: plan?.menuOrder,
            });
        }
    });

    it("bind the keys of SPEC §7.8 in its contexts, and nothing the table does not list", () => {
        const table = readSpecKeyTable().bindings;
        const expected: Record<string, [string, string]> = {
            [IDS.newLayer]: ["Shift+N", "global"],
            [IDS.newFrame]: ["Alt+N", "global"],
            [IDS.newEmptyFrame]: ["Alt+B", "global"],
            [IDS.firstFrame]: ["Home", "timeline"],
            [IDS.previousFrame]: ["ArrowLeft", "timeline"],
            [IDS.nextFrame]: ["ArrowRight", "timeline"],
            [IDS.lastFrame]: ["End", "timeline"],
            [IDS.layerAbove]: ["ArrowUp", "timeline"],
            [IDS.layerBelow]: ["ArrowDown", "timeline"],
            [IDS.previousFrameOnCanvas]: ["ArrowLeft", "canvas"],
            [IDS.nextFrameOnCanvas]: ["ArrowRight", "canvas"],
            [IDS.toggleTimeline]: ["Tab", "canvas"],
        };
        for (const [id, [chord, context]] of Object.entries(expected)) {
            expect(command(id), id).toMatchObject({ shortcuts: [chord], contexts: [context] });
            expect(
                table.some((binding) => binding.chord === chord && binding.context === context),
                `${chord} in ${context}`,
            ).toBe(true);
        }
        // The canvas arrows are the row "canvas (viewport focused), no selection".
        expect(
            table.filter(
                (binding) => binding.chord === "ArrowLeft" && binding.context === "canvas",
            ),
        ).toContainEqual(expect.objectContaining({ condition: "no-selection" }));
        // Every other command of the timeline has no key.
        const own = Object.values(IDS).filter((id) => !(id in expected));
        for (const id of own) expect(command(id).shortcuts, id).toEqual([]);
    });

    it("no two enabled commands share a chord, with or without a selection, in a multi-frame document", () => {
        openWith(2, 3);
        run(IDS.previousFrame);
        expect(findChordConflicts(appCommands)).toEqual([]);
        const { session } = active();
        session.selection = selectionOf(rectMask(4, 4, { x: 0, y: 0, width: 2, height: 2 }));
        sessionsStore.getState().touch(active().id);
        expect(findChordConflicts(appCommands)).toEqual([]);
    });
});

describe("adding and deleting layers and frames", () => {
    it("3 layers and 4 frames added by the commands are undone back to the start state", () => {
        open();
        const start = snapshot();
        for (const id of [IDS.newLayer, IDS.newFrame, IDS.newLayer, IDS.newEmptyFrame]) {
            expect(run(id), id).toBe(true);
        }
        for (const id of [IDS.newFrame, IDS.newLayer, IDS.newEmptyFrame]) {
            expect(run(id), id).toBe(true);
        }
        expect(active().session.doc.layers).toHaveLength(4);
        expect(active().session.doc.frames).toHaveLength(5);
        expect(active().history.undoCount).toBe(7);
        for (let step = 0; step < 7; step++) expect(run("edit.undo")).toBe(true);
        expect(snapshot()).toEqual(start);
        expect(command("edit.undo").enabled()).toBe(false);
    });

    it("New Layer goes above the active layer and becomes active; Duplicate Layer copies it", () => {
        openWith(2, 1);
        run(IDS.layerBelow);
        expect(layerName()).toBe("Layer 1");
        run(IDS.newLayer);
        expect(active().session.doc.layers.map((layer) => layer.name)).toEqual([
            "Layer 1",
            "Layer 3",
            "Layer 2",
        ]);
        expect(layerName()).toBe("Layer 3");
        run(IDS.duplicateLayer);
        expect(layerName()).toBe("Layer 3 Copy");
    });

    it("New Frame duplicates the active frame with its cels; New Empty Frame adds one without", () => {
        const document = open();
        const { session } = document;
        session.doc.images.set("i", { width: 4, height: 4, data: new Uint8ClampedArray(64) });
        session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
            imageId: "i",
            opacity: 255,
        });
        run(IDS.newFrame);
        expect(frameIndex()).toBe(1);
        expect(session.doc.cels.has(celKey(session.activeLayerId, frameAt(1)))).toBe(true);
        run(IDS.newEmptyFrame);
        expect(frameIndex()).toBe(2);
        expect(session.doc.cels.has(celKey(session.activeLayerId, frameAt(2)))).toBe(false);
    });

    it("Delete Layer removes the selected layers in one step, or the active layer; never the last pixel layer", () => {
        openWith(4, 1);
        const names = () => active().session.doc.layers.map((layer) => layer.name);
        // The active layer when no layer is selected.
        run(IDS.deleteLayer);
        expect(names()).toEqual(["Layer 1", "Layer 2", "Layer 3"]);
        // Two selected layers, one step.
        clickTimeline(
            { kind: "layers", layerId: layerNamed("Layer 1") },
            { shift: false, toggle: false },
        );
        clickTimeline(
            { kind: "layers", layerId: layerNamed("Layer 2") },
            { shift: true, toggle: false },
        );
        const steps = active().history.undoCount;
        run(IDS.deleteLayer);
        expect(names()).toEqual(["Layer 3"]);
        expect(active().history.undoCount).toBe(steps + 1);
        expect(command(IDS.deleteLayer).enabled()).toBe(false);
        run("edit.undo");
        expect(names()).toEqual(["Layer 1", "Layer 2", "Layer 3"]);
        // Every pixel layer selected: disabled.
        clickTimeline(
            { kind: "layers", layerId: layerNamed("Layer 1") },
            { shift: false, toggle: false },
        );
        clickTimeline(
            { kind: "layers", layerId: layerNamed("Layer 3") },
            { shift: true, toggle: false },
        );
        expect(command(IDS.deleteLayer).enabled()).toBe(false);
    });

    it("Delete Frame removes the selected frames, or the active one; never every frame", () => {
        openWith(1, 5);
        const ids = () => active().session.doc.frames.map((frame) => frame.id);
        const [, second, third, fourth] = ids();
        clickTimeline({ kind: "frames", frameId: second ?? "" }, { shift: false, toggle: false });
        clickTimeline({ kind: "frames", frameId: fourth ?? "" }, { shift: true, toggle: false });
        run(IDS.deleteFrame);
        expect(ids()).toHaveLength(2);
        expect(ids()).not.toContain(third);
        expect(active().history.undoCount).toBe(5);
        // The active frame alone.
        run(IDS.deleteFrame);
        expect(ids()).toHaveLength(1);
        expect(command(IDS.deleteFrame).enabled()).toBe(false);
    });
});

describe("frame durations", () => {
    it("Apply Frame Duration with three frames selected changes exactly those three, in one undo step", () => {
        openWith(1, 6);
        const durations = () => active().session.doc.frames.map((frame) => frame.durationMs);
        clickTimeline({ kind: "frames", frameId: frameAt(1) }, { shift: false, toggle: false });
        clickTimeline({ kind: "frames", frameId: frameAt(3) }, { shift: true, toggle: false });
        const steps = active().history.undoCount;
        withArguments({ duration: 250 }, () => void run(IDS.setDuration));
        expect(durations()).toEqual([100, 250, 250, 250, 100, 100]);
        expect(active().history.undoCount).toBe(steps + 1);
        expect(timelineStore.getState().duration).toBeNull();
        run("edit.undo");
        expect(durations()).toEqual([100, 100, 100, 100, 100, 100]);
    });

    it("acts on the active frame without a selection, and on the frames of a cel selection", () => {
        openWith(2, 4);
        const durations = () => active().session.doc.frames.map((frame) => frame.durationMs);
        withArguments({ duration: 40 }, () => void run(IDS.setDuration));
        expect(durations()).toEqual([100, 100, 100, 40]);
        const [lower, upper] = active().session.doc.layers.map((layer) => layer.id);
        clickTimeline(
            { kind: "cels", cel: { layerId: upper ?? "", frameId: frameAt(0) } },
            { shift: false, toggle: false },
        );
        clickTimeline(
            { kind: "cels", cel: { layerId: lower ?? "", frameId: frameAt(1) } },
            { shift: true, toggle: false },
        );
        withArguments({ duration: 60 }, () => void run(IDS.setDuration));
        expect(durations()).toEqual([60, 60, 100, 40]);
    });

    it("the duration field acts on the frames it acted on when it took the focus", () => {
        openWith(1, 6);
        const durations = () => active().session.doc.frames.map((frame) => frame.durationMs);
        clickTimeline({ kind: "frames", frameId: frameAt(1) }, { shift: false, toggle: false });
        clickTimeline({ kind: "frames", frameId: frameAt(3) }, { shift: true, toggle: false });
        beginDurationEdit();
        expect(timelineStore.getState().durationEdit?.frameIds).toEqual(
            [1, 2, 3].map((index) => frameAt(index)),
        );
        // A click on frame 6 before the typed value is applied.
        clickTimeline({ kind: "frames", frameId: frameAt(5) }, { shift: false, toggle: false });
        withArguments({ duration: 250 }, () => void run(IDS.setDuration));
        expect(durations()).toEqual([100, 250, 250, 250, 100, 100]);
        endDurationEdit();
        expect(timelineStore.getState().durationEdit).toBeNull();
        // Without the focus, the selection: frame 6.
        withArguments({ duration: 300 }, () => void run(IDS.setDuration));
        expect(durations()).toEqual([100, 250, 250, 250, 100, 300]);
    });

    it("the field shows the active frame's duration, and no number when the frames' durations differ", () => {
        openWith(1, 3);
        const document = active();
        const shown = () => shownDuration(document, timelineStore.getState());
        expect(shown()).toEqual({ durationMs: 100, mixed: false });
        withArguments({ duration: 300 }, () => void run(IDS.setDuration));
        clickTimeline({ kind: "frames", frameId: frameAt(1) }, { shift: false, toggle: false });
        withArguments({ duration: 200 }, () => void run(IDS.setDuration));
        clickTimeline({ kind: "frames", frameId: frameAt(0) }, { shift: false, toggle: false });
        clickTimeline({ kind: "frames", frameId: frameAt(2) }, { shift: true, toggle: false });
        // 100, 200, 300 with frame 3 active: its value is where the arrow keys step from.
        expect(shown()).toEqual({ durationMs: 300, mixed: true });
        const steps = active().history.undoCount;
        withArguments({ duration: 100 }, () => void run(IDS.setDuration));
        expect(active().session.doc.frames.map((frame) => frame.durationMs)).toEqual([
            100, 100, 100,
        ]);
        expect(active().history.undoCount).toBe(steps + 1);
        expect(shown()).toEqual({ durationMs: 100, mixed: false });
    });

    it("is disabled without a value, and refuses a value outside 1..65535", () => {
        openWith(1, 2);
        expect(command(IDS.setDuration).enabled()).toBe(false);
        const steps = active().history.undoCount;
        for (const duration of [0, 65536, 1.5]) {
            withArguments({ duration }, () => void run(IDS.setDuration));
        }
        expect(active().history.undoCount).toBe(steps);
    });
});

describe("navigation", () => {
    it("moves the active cell through frames and layers and stops at the ends", () => {
        openWith(3, 4);
        expect([frameIndex(), layerName()]).toEqual([3, "Layer 3"]);
        expect(command(IDS.nextFrame).enabled()).toBe(false);
        expect(command(IDS.lastFrame).enabled()).toBe(false);
        expect(command(IDS.layerAbove).enabled()).toBe(false);
        run(IDS.previousFrame);
        run(IDS.previousFrame);
        expect(frameIndex()).toBe(1);
        run(IDS.firstFrame);
        expect(frameIndex()).toBe(0);
        expect(command(IDS.previousFrame).enabled()).toBe(false);
        expect(command(IDS.firstFrame).enabled()).toBe(false);
        run(IDS.nextFrame);
        expect(frameIndex()).toBe(1);
        run(IDS.lastFrame);
        expect(frameIndex()).toBe(3);
        run(IDS.layerBelow);
        run(IDS.layerBelow);
        expect(layerName()).toBe("Layer 1");
        expect(command(IDS.layerBelow).enabled()).toBe(false);
        run(IDS.layerAbove);
        expect(layerName()).toBe("Layer 2");
        // Navigation records nothing.
        expect(active().history.undoCount).toBe(5);
    });

    it("on the canvas, ← and → change the frame only without a selection", () => {
        openWith(1, 3);
        run(IDS.previousFrameOnCanvas);
        expect(frameIndex()).toBe(1);
        const { session } = active();
        session.selection = selectionOf(rectMask(4, 4, { x: 1, y: 1, width: 2, height: 2 }));
        sessionsStore.getState().touch(active().id);
        expect(command(IDS.previousFrameOnCanvas).enabled()).toBe(false);
        expect(command(IDS.nextFrameOnCanvas).enabled()).toBe(false);
        // The menu's and the timeline's commands do not depend on it.
        expect(command(IDS.previousFrame).enabled()).toBe(true);
        run(IDS.nextFrame);
        expect(frameIndex()).toBe(2);
    });

    it("a switch of frame or layer applies the floating selection first; staying puts nothing", () => {
        openWith(2, 3);
        floating.calls.length = 0;
        run(IDS.previousFrame);
        clickTimeline(
            { kind: "layers", layerId: layerNamed("Layer 1") },
            { shift: false, toggle: false },
        );
        activateCel({ frameId: frameAt(0), layerId: layerNamed("Layer 2") });
        // Each call saw the session before its switch.
        expect(floating.calls).toEqual([
            "frame 3, Layer 2",
            "frame 2, Layer 2",
            "frame 2, Layer 1",
        ]);
        // A click on what is active already switches nothing.
        activateCel({ frameId: frameAt(0) });
        clickTimeline({ kind: "frames", frameId: frameAt(0) }, { shift: false, toggle: false });
        expect(floating.calls).toHaveLength(3);
    });

    it("nothing switches during a stroke; with a floating selection the switch goes ahead", () => {
        openWith(1, 3);
        floating.calls.length = 0;
        const { history, session } = active();
        const stroke = history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        expect(command(IDS.previousFrame).enabled()).toBe(false);
        expect(command(IDS.newLayer).enabled()).toBe(false);
        expect(activateCel({ frameId: frameAt(0) })).toBeNull();
        expect(frameIndex()).toBe(2);
        // A floating selection lives in an open transaction too (SPEC §5.2): the commands are
        // enabled, and apply it before they act. The hook here does not commit it, so the
        // switch still finds the transaction open and does nothing.
        setKeyContext("floating", true);
        expect(command(IDS.previousFrame).enabled()).toBe(true);
        run(IDS.previousFrame);
        expect(floating.calls).toHaveLength(1);
        expect(frameIndex()).toBe(2);
        stroke.abort();
        setKeyContext("floating", false);
        run(IDS.previousFrame);
        expect(frameIndex()).toBe(1);
    });

    it("a selection ends when the active cel moves other than by the click that made it", () => {
        openWith(1, 4);
        clickTimeline({ kind: "frames", frameId: frameAt(1) }, { shift: false, toggle: false });
        clickTimeline({ kind: "frames", frameId: frameAt(2) }, { shift: true, toggle: false });
        const durations = () => active().session.doc.frames.map((frame) => frame.durationMs);
        run(IDS.nextFrame);
        withArguments({ duration: 30 }, () => void run(IDS.setDuration));
        // Only the active frame: the selection of frames 2–3 ended with the move.
        expect(durations()).toEqual([100, 100, 100, 30]);
    });

    it("a selection does not come back when the active cel returns to where it was made", () => {
        openWith(1, 4);
        clickTimeline({ kind: "frames", frameId: frameAt(1) }, { shift: false, toggle: false });
        clickTimeline({ kind: "frames", frameId: frameAt(2) }, { shift: true, toggle: false });
        const durations = () => active().session.doc.frames.map((frame) => frame.durationMs);
        // → then ←: the active cel is where the selection was made again.
        run(IDS.nextFrame);
        run(IDS.previousFrame);
        expect(frameIndex()).toBe(2);
        expect(timelineStore.getState().selection).toBeNull();
        withArguments({ duration: 30 }, () => void run(IDS.setDuration));
        expect(durations()).toEqual([100, 100, 30, 100]);
    });

    it("New Layer then undo leaves no selection; undo and redo end a selection where they leave the active cel", () => {
        openWith(1, 4);
        const select = () => {
            clickTimeline({ kind: "frames", frameId: frameAt(1) }, { shift: false, toggle: false });
            clickTimeline({ kind: "frames", frameId: frameAt(2) }, { shift: true, toggle: false });
            expect(timelineStore.getState().selection).toMatchObject({ kind: "frames" });
        };
        select();
        run(IDS.newLayer);
        expect(timelineStore.getState().selection).toBeNull();
        run("edit.undo");
        expect(layerName()).toBe("Layer 1");
        expect(frameIndex()).toBe(2);
        expect(timelineStore.getState().selection).toBeNull();
        const durations = () => active().session.doc.frames.map((frame) => frame.durationMs);
        withArguments({ duration: 40 }, () => void run(IDS.setDuration));
        expect(durations()).toEqual([100, 100, 40, 100]);

        // A step that leaves the active cel where it is keeps the selection; its undo ends it.
        select();
        withArguments({ duration: 50 }, () => void run(IDS.setDuration));
        expect(durations()).toEqual([100, 50, 50, 100]);
        expect(timelineStore.getState().selection).not.toBeNull();
        run("edit.undo");
        expect(timelineStore.getState().selection).toBeNull();
        select();
        run("edit.redo");
        expect(durations()).toEqual([100, 50, 50, 100]);
        expect(timelineStore.getState().selection).toBeNull();
    });
});

describe("layer properties, rename, visibility and lock", () => {
    it("the row's toggles act on their layer without making it active; the titles follow the state", () => {
        openWith(2, 1);
        const lower = layerNamed("Layer 1");
        const layer = () => active().session.doc.layers.find((entry) => entry.id === lower);
        withArguments({ layerTarget: lower }, () => {
            expect(command(IDS.toggleVisible).title()).toBe("Hide Layer");
            run(IDS.toggleVisible);
            expect(command(IDS.toggleVisible).title()).toBe("Show Layer");
            expect(command(IDS.toggleLocked).title()).toBe("Lock Layer");
            run(IDS.toggleLocked);
            expect(command(IDS.toggleLocked).title()).toBe("Unlock Layer");
        });
        expect(layer()).toMatchObject({ visible: false, locked: true });
        expect(layerName()).toBe("Layer 2");
        expect(timelineStore.getState().layerTarget).toBeNull();
        // Without a row, the active layer.
        run(IDS.toggleVisible);
        expect(active().session.doc.layers.map((entry) => entry.visible)).toEqual([false, false]);
        expect(active().history.undoCount).toBe(4);
        expect(active().history.undoLabel).toBe("Hide Layer");
    });

    it("the properties popover applies its name and opacity as one undo step when it closes", () => {
        openWith(1, 1);
        run(IDS.layerProperties);
        expect(timelineStore.getState().properties).toMatchObject({
            name: "Layer 1",
            opacity: 255,
        });
        editProperties({ name: "  Ink  ", opacity: 128 });
        const steps = active().history.undoCount;
        run(IDS.applyLayerProperties);
        expect(timelineStore.getState().properties).toBeNull();
        expect(active().session.doc.layers[0]).toMatchObject({ name: "Ink", opacity: 128 });
        expect(active().history.undoCount).toBe(steps + 1);
        run("edit.undo");
        expect(active().session.doc.layers[0]).toMatchObject({ name: "Layer 1", opacity: 255 });

        // An empty name is not applied; nothing changed records nothing.
        run(IDS.layerProperties);
        editProperties({ name: "   ", opacity: 10 });
        run(IDS.applyLayerProperties);
        expect(active().session.doc.layers[0]).toMatchObject({ name: "Layer 1", opacity: 10 });
        const after = active().history.undoCount;
        run(IDS.layerProperties);
        run(IDS.applyLayerProperties);
        expect(active().history.undoCount).toBe(after);
        expect(command(IDS.applyLayerProperties).enabled()).toBe(false);
    });

    it("Apply Layer Name and Apply Layer Properties apply a floating selection first, and keep the draft while it stays", () => {
        openWith(1, 1);
        const { session, history } = active();
        /** A floating selection: lifted pixels in an open transaction (SPEC §5.2). */
        const float = () => {
            history.begin({ layerId: session.activeLayerId, frameId: session.activeFrameId });
            setKeyContext("floating", true);
        };
        const layer = () => session.doc.layers[0];

        float();
        expect(command(IDS.renameLayer).enabled()).toBe(true);
        run(IDS.renameLayer);
        setRenameText("Ink");
        expect(command(IDS.applyLayerName).enabled()).toBe(true);
        // The hook leaves the selection floating: the name cannot be applied, the field stays.
        run(IDS.applyLayerName);
        expect(timelineStore.getState().rename).toMatchObject({ name: "Ink" });
        expect(layer()?.name).toBe("Layer 1");
        // It commits the float, as SE-032's will: the move is a step, then the name.
        floating.commit = true;
        let steps = history.undoCount;
        run(IDS.applyLayerName);
        expect(layer()?.name).toBe("Ink");
        expect(timelineStore.getState().rename).toBeNull();
        expect(history.undoCount).toBe(steps + 2);
        expect(history.undoLabel).toBe("Rename Layer");
        setKeyContext("floating", false);

        floating.commit = false;
        float();
        run(IDS.layerProperties);
        editProperties({ opacity: 100 });
        run(IDS.applyLayerProperties);
        expect(timelineStore.getState().properties).toMatchObject({ opacity: 100 });
        expect(layer()?.opacity).toBe(255);
        floating.commit = true;
        steps = history.undoCount;
        run(IDS.applyLayerProperties);
        expect(layer()?.opacity).toBe(100);
        expect(timelineStore.getState().properties).toBeNull();
        expect(history.undoCount).toBe(steps + 2);
        setKeyContext("floating", false);

        // During a stroke the edit cannot be taken: the commands are disabled, the draft stays.
        const stroke = history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        expect(command(IDS.renameLayer).enabled()).toBe(false);
        timelineStore.setState({
            rename: { documentId: active().id, layerId: session.activeLayerId, name: "Late" },
        });
        expect(command(IDS.applyLayerName).enabled()).toBe(false);
        expect(timelineStore.getState().rename).toMatchObject({ name: "Late" });
        stroke.abort();
        expect(run(IDS.applyLayerName)).toBe(true);
        expect(layer()?.name).toBe("Late");
    });

    it("Rename Layer opens the in-place field; applying is one step, cancelling changes nothing", () => {
        openWith(1, 1);
        run(IDS.renameLayer);
        expect(timelineStore.getState().rename).toMatchObject({ name: "Layer 1" });
        setRenameText("Outline");
        run(IDS.applyLayerName);
        expect(active().session.doc.layers[0]?.name).toBe("Outline");
        expect(active().history.undoLabel).toBe("Rename Layer");
        const steps = active().history.undoCount;
        run(IDS.renameLayer);
        setRenameText("Discarded");
        cancelRename();
        expect(command(IDS.applyLayerName).enabled()).toBe(false);
        run(IDS.renameLayer);
        setRenameText("");
        run(IDS.applyLayerName);
        expect(active().session.doc.layers[0]?.name).toBe("Outline");
        expect(active().history.undoCount).toBe(steps);
    });
});

describe("Tab: the timeline toggle", () => {
    it("hides and shows the panel, titled by what it will do", () => {
        expect(command(IDS.toggleTimeline).title()).toBe("Hide Timeline");
        run(IDS.toggleTimeline);
        expect(timelineStore.getState().visible).toBe(false);
        expect(command(IDS.toggleTimeline).title()).toBe("Show Timeline");
        run(IDS.toggleTimeline);
        expect(timelineStore.getState().visible).toBe(true);
    });

    it("Layer Properties… and Rename Layer show a hidden panel", () => {
        openWith(1, 1);
        run(IDS.toggleTimeline);
        run(IDS.renameLayer);
        expect(timelineStore.getState().visible).toBe(true);
        run(IDS.toggleTimeline);
        run(IDS.layerProperties);
        expect(timelineStore.getState().visible).toBe(true);
    });
});
