import { afterEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildContextMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { closeContextTarget, openContextTarget } from "../../src/app/timeline/contextTarget";
import { TAG_COMMANDS as TAGS } from "../../src/app/timeline/tagCommandIds";
import { initialTagState, tagStore } from "../../src/app/timeline/tagState";
import { clickTimeline } from "../../src/app/timeline/timelineClicks";
import { TIMELINE_COMMANDS } from "../../src/app/timeline/timelineCommandIds";
import { withDrop } from "../../src/app/timeline/timelineDrop";
import type { DropArgument } from "../../src/app/timeline/timelineDrop";
import {
    TIMELINE_EDIT_COMMANDS as IDS,
    TIMELINE_MENUS,
} from "../../src/app/timeline/timelineEditIds";
import { initialTimelineState, timelineStore } from "../../src/app/timeline/timelineState";
import { celAt, celKey, createDocument } from "../../src/core/model";
import { createTagCommand } from "../../src/core/tags";

// SE-026: the timeline's editing commands in the app's registry — the cel commands and the
// locked-layer rule of the SE-021 review, the drops of a drag (one undo step each), Merge Down,
// Flatten and Reverse Frames in their planned menu items, and the context menus they list.

vi.mock("../../src/app/selection/floating", () => ({
    applyFloating: () => {},
    isFloating: () => false,
}));

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    timelineStore.setState(initialTimelineState());
    tagStore.setState(initialTagState());
    setKeyContext("floating", false);
});

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document is open");
    return document;
}

/**
 * A 2×2 document of three pixel layers and three frames; every cel of the bottom two layers is
 * filled with an image of its own ("1-1" … "2-3"), the top layer is empty. Layer ids `l1` (the
 * bottom) to `l3`, frame ids `f1` to `f3`; the active cel is l1 at f1.
 */
function openGrid(): OpenDocument {
    const session = createDocument({ name: "grid", width: 2, height: 2 });
    const { doc } = session;
    const base = doc.layers[0]!;
    doc.layers = ["l1", "l2", "l3"].map((id, index) => ({
        ...base,
        id,
        name: `Layer ${index + 1}`,
    }));
    doc.frames = ["f1", "f2", "f3"].map((id) => ({ id, durationMs: 100 }));
    doc.cels.clear();
    doc.images.clear();
    for (const [row, layerId] of ["l1", "l2"].entries()) {
        for (const [column, frameId] of ["f1", "f2", "f3"].entries()) {
            const imageId = `${row + 1}-${column + 1}`;
            doc.images.set(imageId, { width: 2, height: 2, data: new Uint8ClampedArray(16) });
            doc.cels.set(celKey(layerId, frameId), { imageId, opacity: 255 });
        }
    }
    session.activeLayerId = "l1";
    session.activeFrameId = "f1";
    return sessionsStore.getState().open(session);
}

/** The image of every cell, the top layer first: "1-1 1-2 1-3". */
function grid(document = active()): string[] {
    const { doc } = document.session;
    return ["l3", "l2", "l1"].map((layerId) =>
        ["f1", "f2", "f3"].map((frameId) => celAt(doc, layerId, frameId)?.imageId ?? ".").join(" "),
    );
}

function lock(layerId: string): void {
    const layer = active().session.doc.layers.find((entry) => entry.id === layerId);
    if (layer) layer.locked = true;
    sessionsStore.getState().touch(active().id);
}

const NONE = { shift: false, toggle: false };

describe("the registry", () => {
    it("Merge Down, Flatten and Reverse Frames take the menu items planned for them", () => {
        for (const id of [IDS.mergeDown, IDS.flatten, IDS.reverseFrames]) {
            const planned = plannedCommands.find((spec) => spec.id === id);
            expect(planned, id).toBeDefined();
            const found = command(id);
            expect(found.planned, id).toBe(false);
            expect(found.menuPath, id).toEqual(planned?.menuPath);
            expect(found.menuOrder, id).toBe(planned?.menuOrder);
        }
    });

    it("the drops of a drag are commands outside the menus and the context menus", () => {
        for (const id of [IDS.moveCels, IDS.copyCels, IDS.moveFrames, IDS.moveLayers]) {
            expect(command(id).menuPath, id).toBeNull();
            expect(command(id).contextMenus, id).toEqual([]);
        }
    });

    it("each context menu of the timeline holds this ticket's items, all of them registry commands", () => {
        const owned: Record<string, string[]> = {
            [TIMELINE_MENUS.layer]: [IDS.mergeDown, IDS.flatten, TIMELINE_COMMANDS.layerProperties],
            [TIMELINE_MENUS.frame]: [IDS.reverseFrames, TAGS.newTag],
            [TIMELINE_MENUS.cel]: [IDS.linkCels, IDS.unlinkCels, IDS.clearCels],
            [TIMELINE_MENUS.tag]: [TAGS.newTag, TAGS.tagProperties, TAGS.deleteTag],
        };
        const listed = appCommands.list();
        for (const menu of Object.values(TIMELINE_MENUS)) {
            const ids = menuCommands(buildContextMenu(listed, menu)).map((entry) => entry.id);
            expect(ids, menu).toEqual(expect.arrayContaining(owned[menu] ?? []));
            for (const id of ids) {
                expect(appCommands.get(id)?.planned, `${menu}: ${id}`).toBe(false);
            }
        }
    });
});

describe("cel commands", () => {
    it("act on the cel selection, or the active cel, in one undo step each", () => {
        const document = openGrid();
        expect(command(IDS.clearCels).enabled()).toBe(true);
        void command(IDS.clearCels).run();
        expect(grid()).toEqual([". . .", "2-1 2-2 2-3", ". 1-2 1-3"]);

        clickTimeline({ kind: "cels", cel: { layerId: "l2", frameId: "f1" } }, NONE);
        clickTimeline(
            { kind: "cels", cel: { layerId: "l2", frameId: "f3" } },
            {
                shift: true,
                toggle: false,
            },
        );
        expect(command(IDS.unlinkCels).enabled()).toBe(false);
        void command(IDS.linkCels).run();
        expect(grid()).toEqual([". . .", "2-1 2-1 2-1", ". 1-2 1-3"]);
        expect(command(IDS.unlinkCels).enabled()).toBe(true);
        void command(IDS.unlinkCels).run();
        const { doc } = document.session;
        const images = ["f1", "f2", "f3"].map((frameId) => celAt(doc, "l2", frameId)?.imageId);
        expect(new Set(images).size).toBe(3);
        expect(document.history.undoCount).toBe(3);
    });

    it("leave out the cels of locked layers: Clear on locked layers only is disabled and changes nothing", () => {
        const document = openGrid();
        lock("l1");
        lock("l2");
        clickTimeline({ kind: "layers", layerId: "l1" }, NONE);
        clickTimeline({ kind: "layers", layerId: "l2" }, { shift: false, toggle: true });
        const before = grid();
        for (const id of [IDS.clearCels, IDS.linkCels, IDS.unlinkCels]) {
            expect(command(id).enabled(), id).toBe(false);
            // Run anyway: no step.
            void command(id).run();
        }
        expect(grid()).toEqual(before);
        expect(document.history.undoCount).toBe(0);

        // With an unlocked layer in the selection, only its cels are cleared.
        clickTimeline({ kind: "layers", layerId: "l3" }, { shift: true, toggle: false });
        expect(command(IDS.clearCels).enabled()).toBe(false);
        active().session.doc.layers[1]!.locked = false;
        expect(command(IDS.clearCels).enabled()).toBe(true);
        void command(IDS.clearCels).run();
        expect(grid()).toEqual([". . .", ". . .", "1-1 1-2 1-3"]);
        expect(document.history.undoCount).toBe(1);
    });
});

describe("drops", () => {
    const drop = (argument: DropArgument, id: string) =>
        withDrop(argument, () => {
            const found = command(id);
            if (!found.enabled()) return false;
            void found.run();
            return true;
        });

    it("move and copy cels in one undo step each, and select them where they land", () => {
        const document = openGrid();
        const cels = [
            { layerId: "l1", frameId: "f1" },
            { layerId: "l1", frameId: "f2" },
        ];
        const anchor = cels[1]!;
        const base = { kind: "cels", documentId: document.id, cels, anchor } as const;
        expect(drop({ ...base, offset: { layers: 2, frames: 1 } }, IDS.moveCels)).toBe(true);
        expect(grid()).toEqual([". 1-1 1-2", "2-1 2-2 2-3", ". . 1-3"]);
        expect(document.history.undoCount).toBe(1);
        const { session } = active();
        expect([session.activeLayerId, session.activeFrameId]).toEqual(["l3", "f3"]);
        const selection = timelineStore.getState().selection;
        expect(selection?.kind === "cels" && selection.cels).toEqual([
            { layerId: "l3", frameId: "f2" },
            { layerId: "l3", frameId: "f3" },
        ]);

        const copied = [{ layerId: "l2", frameId: "f3" }];
        expect(
            drop(
                {
                    kind: "cels",
                    documentId: document.id,
                    cels: copied,
                    anchor: copied[0]!,
                    offset: { layers: -1, frames: -2 },
                },
                IDS.copyCels,
            ),
        ).toBe(true);
        const copy = celAt(active().session.doc, "l1", "f1")?.imageId;
        expect(copy).toBeDefined();
        expect(copy).not.toBe("2-3");
        expect(celAt(active().session.doc, "l2", "f3")?.imageId).toBe("2-3");
        expect(document.history.undoCount).toBe(2);
    });

    it("a cel dropped onto a locked layer changes nothing and adds no undo step", () => {
        const document = openGrid();
        lock("l3");
        const cels = [{ layerId: "l2", frameId: "f1" }];
        const before = grid();
        for (const id of [IDS.moveCels, IDS.copyCels]) {
            drop(
                {
                    kind: "cels",
                    documentId: document.id,
                    cels,
                    anchor: cels[0]!,
                    offset: { layers: 1, frames: 0 },
                },
                id,
            );
        }
        expect(grid()).toEqual(before);
        expect(document.history.undoCount).toBe(0);
    });

    it("move frames and layers in one undo step each", () => {
        const document = openGrid();
        drop(
            { kind: "frames", documentId: document.id, frameIds: ["f1"], before: 3 },
            IDS.moveFrames,
        );
        expect(active().session.doc.frames.map((frame) => frame.id)).toEqual(["f2", "f3", "f1"]);
        expect(document.history.undoCount).toBe(1);
        // l3 (listed first) dropped under l1: the bottom of the stack.
        drop({ kind: "layers", documentId: document.id, layerIds: ["l3"], gap: 3 }, IDS.moveLayers);
        expect(active().session.doc.layers.map((layer) => layer.id)).toEqual(["l3", "l1", "l2"]);
        expect(document.history.undoCount).toBe(2);
        // A drop where the frames are already changes nothing.
        drop(
            { kind: "frames", documentId: document.id, frameIds: ["f2"], before: 0 },
            IDS.moveFrames,
        );
        expect(document.history.undoCount).toBe(2);
    });

    it("are disabled without a drop of the active document", () => {
        openGrid();
        for (const id of [IDS.moveCels, IDS.copyCels, IDS.moveFrames, IDS.moveLayers]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        expect(
            withDrop({ kind: "frames", documentId: "other", frameIds: ["f1"], before: 3 }, () =>
                command(IDS.moveFrames).enabled(),
            ),
        ).toBe(false);
    });
});

describe("Merge Down, Flatten and Reverse Frames", () => {
    it("reverse the selected frames, merge the active layer down and flatten, one step each", () => {
        const document = openGrid();
        expect(command(IDS.reverseFrames).enabled()).toBe(false);
        clickTimeline({ kind: "frames", frameId: "f1" }, NONE);
        clickTimeline({ kind: "frames", frameId: "f3" }, { shift: true, toggle: false });
        void command(IDS.reverseFrames).run();
        expect(active().session.doc.frames.map((frame) => frame.id)).toEqual(["f3", "f2", "f1"]);

        // The bottom layer has nothing below it.
        expect(command(IDS.mergeDown).enabled()).toBe(false);
        clickTimeline({ kind: "layers", layerId: "l2" }, NONE);
        expect(command(IDS.mergeDown).enabled()).toBe(true);
        void command(IDS.mergeDown).run();
        expect(active().session.doc.layers.map((layer) => layer.id)).toEqual(["l1", "l3"]);

        void command(IDS.flatten).run();
        expect(active().session.doc.layers.map((layer) => layer.id)).toEqual(["l1"]);
        expect(document.history.undoCount).toBe(3);
    });

    it("Merge Down and Flatten are disabled while a layer they would write into is locked", () => {
        const document = openGrid();
        clickTimeline({ kind: "layers", layerId: "l2" }, NONE);
        lock("l1");
        expect(command(IDS.mergeDown).enabled()).toBe(false);
        expect(command(IDS.flatten).enabled()).toBe(false);
        // Run anyway: no step.
        void command(IDS.mergeDown).run();
        void command(IDS.flatten).run();
        expect(active().session.doc.layers.map((layer) => layer.id)).toEqual(["l1", "l2", "l3"]);
        expect(document.history.undoCount).toBe(0);
        // The layer merged down locked: disabled too.
        active().session.doc.layers[0]!.locked = false;
        lock("l2");
        expect(command(IDS.mergeDown).enabled()).toBe(false);
        clickTimeline({ kind: "layers", layerId: "l3" }, NONE);
        expect(command(IDS.mergeDown).enabled()).toBe(false);
    });
});

describe("context targets", () => {
    it("a right-click outside the selection selects its item; inside it keeps the selection", () => {
        openGrid();
        clickTimeline({ kind: "frames", frameId: "f1" }, NONE);
        clickTimeline({ kind: "frames", frameId: "f2" }, { shift: true, toggle: false });
        const frames = timelineStore.getState().selection;
        // A cel of a selected frame keeps the frame selection.
        expect(openContextTarget({ kind: "cel", cel: { layerId: "l2", frameId: "f2" } })).toBe(
            true,
        );
        expect(timelineStore.getState().selection).toBe(frames);
        expect(openContextTarget({ kind: "frame", frameId: "f1" })).toBe(true);
        expect(timelineStore.getState().selection).toBe(frames);
        // Another frame is selected alone.
        expect(openContextTarget({ kind: "frame", frameId: "f3" })).toBe(true);
        const selection = timelineStore.getState().selection;
        expect(selection?.kind === "frames" && selection.frameIds).toEqual(["f3"]);
        expect(openContextTarget({ kind: "layer", layerId: "l3" })).toBe(true);
        expect(active().session.activeLayerId).toBe("l3");
    });

    it("a tag's menu acts on that tag until it closes", () => {
        const document = openGrid();
        const { doc } = document.session;
        for (const [id, frameId] of [
            ["first", "f1"],
            ["last", "f3"],
        ] as const) {
            const create = createTagCommand(doc, {
                name: id,
                color: 0xff0000ff,
                fromFrameId: frameId,
                toFrameId: frameId,
                direction: "forward",
                repeat: 0,
            });
            document.history.execute(create!);
        }
        const last = doc.tags.find((tag) => tag.name === "last")!;
        expect(openContextTarget({ kind: "tag", tagId: last.id })).toBe(true);
        expect(tagStore.getState().target).toBe(last.id);
        void command(TAGS.deleteTag).run();
        expect(active().session.doc.tags.map((tag) => tag.name)).toEqual(["first"]);
        closeContextTarget();
        expect(tagStore.getState().target).toBeNull();
        expect(openContextTarget({ kind: "tag", tagId: "gone" })).toBe(false);
    });
});
