import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { celPropertiesStore, editCelOpacity } from "../../src/app/timeline/celProperties";
import { CEL_PROPERTIES_COMMANDS } from "../../src/app/timeline/celPropertiesIds";
import { TIMELINE_COMMANDS } from "../../src/app/timeline/timelineCommandIds";
import { TIMELINE_MENUS } from "../../src/app/timeline/timelineEditIds";
import {
    editProperties,
    initialTimelineState,
    timelineStore,
} from "../../src/app/timeline/timelineState";
import { linkCelsCommand } from "../../src/core/cels";
import { addFrameCommand } from "../../src/core/frames";
import { addLayerCommand, setLayerLockedCommand } from "../../src/core/layers";
import { addReferenceLayerCommand } from "../../src/core/references";
import { celAt, createDocument, sequentialIds } from "../../src/core/model";
import type { PixelLayer } from "../../src/core/model";

// SE-061: the blend mode in the layer properties popover and the cel properties popover,
// through the app's registry and stores (the popovers' UI is in se-061-*.spec.ts).

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    timelineStore.setState(initialTimelineState());
    celPropertiesStore.setState({ draft: null });
});

let opened = 0;
function open(): OpenDocument {
    opened++;
    const session = createDocument(
        { name: "doc", width: 2, height: 2 },
        sequentialIds(`d${opened}-`),
    );
    return sessionsStore.getState().open(session);
}

/** Paints the active cel through a transaction: one undo step. */
function paint(document: OpenDocument, value: number): void {
    const { session, history } = document;
    const transaction = history.begin({
        layerId: session.activeLayerId,
        frameId: session.activeFrameId,
    });
    transaction.image.data.fill(value);
    transaction.markDirty({ x: 0, y: 0, width: 2, height: 2 });
    transaction.commit("Paint");
}

function command(id: string) {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

function run(id: string): void {
    void command(id).run();
}

function pixelLayer(document: OpenDocument, index: number): PixelLayer {
    const layer = document.session.doc.layers[index];
    if (layer?.kind !== "pixel") throw new Error("not a pixel layer");
    return layer;
}

describe("the blend mode in the layer properties popover", () => {
    it("is applied when the popover closes, alone as the step Blend Mode, with name and opacity as one Layer Properties step", () => {
        const document = open();
        const steps = document.history.undoCount;

        run(TIMELINE_COMMANDS.layerProperties);
        expect(timelineStore.getState().properties).toMatchObject({ blend: "normal" });
        editProperties({ blend: "multiply" });
        // Nothing changes while the popover is open.
        expect(pixelLayer(document, 0).blend).toBe("normal");
        run(TIMELINE_COMMANDS.applyLayerProperties);
        expect(pixelLayer(document, 0).blend).toBe("multiply");
        expect(document.history.undoCount).toBe(steps + 1);
        expect(document.history.undoLabel).toBe("Blend Mode");

        run(TIMELINE_COMMANDS.layerProperties);
        expect(timelineStore.getState().properties).toMatchObject({ blend: "multiply" });
        editProperties({ blend: "screen", opacity: 90, name: "Glow" });
        run(TIMELINE_COMMANDS.applyLayerProperties);
        expect(pixelLayer(document, 0)).toMatchObject({
            blend: "screen",
            opacity: 90,
            name: "Glow",
        });
        expect(document.history.undoLabel).toBe("Layer Properties");

        // One undo returns all three; the next the mode alone.
        expect(document.history.undo()).toBe(true);
        expect(pixelLayer(document, 0)).toMatchObject({ blend: "multiply", opacity: 255 });
        expect(document.history.undo()).toBe(true);
        expect(pixelLayer(document, 0).blend).toBe("normal");
        expect(document.history.undoCount).toBe(steps);
    });

    it("a mode left as it was records nothing", () => {
        const document = open();
        const steps = document.history.undoCount;
        run(TIMELINE_COMMANDS.layerProperties);
        editProperties({ blend: "normal" });
        run(TIMELINE_COMMANDS.applyLayerProperties);
        expect(document.history.undoCount).toBe(steps);
    });
});

describe("Cel Properties", () => {
    it("takes the item planned in the Frame menu and is in the cel context menu", () => {
        const planned = plannedCommands.find((plan) => plan.id === CEL_PROPERTIES_COMMANDS.open);
        const open = command(CEL_PROPERTIES_COMMANDS.open);
        expect(open.planned).toBeFalsy();
        expect(open.menuPath).toEqual(planned?.menuPath);
        expect(open.menuOrder).toBe(planned?.menuOrder);
        expect(open.title()).toBe("Cel Properties…");
        expect(open.contextMenus.map((placement) => placement.menu)).toContain(TIMELINE_MENUS.cel);
    });

    it("is enabled for a filled active cel of a pixel layer only", () => {
        expect(command(CEL_PROPERTIES_COMMANDS.open).enabled()).toBe(false);
        const document = open();
        // The new document's cel is empty.
        expect(command(CEL_PROPERTIES_COMMANDS.open).enabled()).toBe(false);
        paint(document, 200);
        sessionsStore.getState().touch(document.id);
        expect(command(CEL_PROPERTIES_COMMANDS.open).enabled()).toBe(true);
    });

    it("is disabled while the active layer is a reference layer, which has no cels", () => {
        const document = open();
        paint(document, 200);
        const { session, history } = document;
        const pixel = session.activeLayerId;
        history.execute(
            addReferenceLayerCommand(session, {
                sourceId: "source-1",
                sourceWidth: 2,
                sourceHeight: 2,
                newId: sequentialIds("ref"),
            }),
        );
        const reference = session.doc.layers.find((layer) => layer.kind === "reference")!;
        session.activeLayerId = reference.id;
        sessionsStore.getState().touch(document.id);
        expect(command(CEL_PROPERTIES_COMMANDS.open).enabled()).toBe(false);
        run(CEL_PROPERTIES_COMMANDS.open);
        expect(celPropertiesStore.getState().draft).toBeNull();

        session.activeLayerId = pixel;
        sessionsStore.getState().touch(document.id);
        expect(command(CEL_PROPERTIES_COMMANDS.open).enabled()).toBe(true);
    });

    it("applies the cel's opacity when it closes, in one undo step; the cel only, not a cel linked to it", () => {
        const document = open();
        paint(document, 200);
        const { session, history } = document;
        const first = session.activeFrameId;
        history.execute(addFrameCommand(session.doc, first, sequentialIds("f")));
        const second = session.activeFrameId;
        history.execute(
            linkCelsCommand(session.doc, {
                layerIds: [session.activeLayerId],
                frameIds: [first, second],
            })!,
        );
        const layerId = session.activeLayerId;
        expect(celAt(session.doc, layerId, second)?.imageId).toBe(
            celAt(session.doc, layerId, first)?.imageId,
        );
        const steps = history.undoCount;

        run(CEL_PROPERTIES_COMMANDS.open);
        expect(celPropertiesStore.getState().draft).toMatchObject({
            documentId: document.id,
            layerId,
            frameId: second,
            opacity: 255,
        });
        expect(command(CEL_PROPERTIES_COMMANDS.unlink).enabled()).toBe(true);
        editCelOpacity(100);
        expect(celAt(session.doc, layerId, second)?.opacity).toBe(255);
        run(CEL_PROPERTIES_COMMANDS.apply);
        expect(celPropertiesStore.getState().draft).toBeNull();
        expect(celAt(session.doc, layerId, second)?.opacity).toBe(100);
        expect(celAt(session.doc, layerId, first)?.opacity).toBe(255);
        expect(history.undoCount).toBe(steps + 1);
        expect(history.undoLabel).toBe("Cel Opacity");

        // Unchanged, nothing is recorded.
        run(CEL_PROPERTIES_COMMANDS.open);
        run(CEL_PROPERTIES_COMMANDS.apply);
        expect(history.undoCount).toBe(steps + 1);

        expect(history.undo()).toBe(true);
        expect(celAt(session.doc, layerId, second)?.opacity).toBe(255);
    });

    it("Unlink gives the popover's cel an image of its own at once and leaves the popover open", () => {
        const document = open();
        paint(document, 200);
        const { session, history } = document;
        const first = session.activeFrameId;
        history.execute(addFrameCommand(session.doc, first, sequentialIds("f")));
        const second = session.activeFrameId;
        const layerId = session.activeLayerId;
        history.execute(
            linkCelsCommand(session.doc, { layerIds: [layerId], frameIds: [first, second] })!,
        );
        const steps = history.undoCount;

        run(CEL_PROPERTIES_COMMANDS.open);
        run(CEL_PROPERTIES_COMMANDS.unlink);
        expect(celAt(session.doc, layerId, second)?.imageId).not.toBe(
            celAt(session.doc, layerId, first)?.imageId,
        );
        expect(history.undoCount).toBe(steps + 1);
        expect(celPropertiesStore.getState().draft).not.toBeNull();
        expect(command(CEL_PROPERTIES_COMMANDS.unlink).enabled()).toBe(false);
    });

    it("on a locked layer the popover opens but changes nothing", () => {
        const document = open();
        paint(document, 200);
        const { session, history } = document;
        history.execute(setLayerLockedCommand(session, session.activeLayerId, true)!);
        const steps = history.undoCount;

        run(CEL_PROPERTIES_COMMANDS.open);
        expect(celPropertiesStore.getState().draft).not.toBeNull();
        editCelOpacity(10);
        run(CEL_PROPERTIES_COMMANDS.apply);
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)?.opacity).toBe(255);
        expect(history.undoCount).toBe(steps);
    });

    it("acts on the cel it was opened for, and is dropped with its document", () => {
        const document = open();
        paint(document, 200);
        const { session, history } = document;
        const painted = session.activeLayerId;
        run(CEL_PROPERTIES_COMMANDS.open);
        // Another layer becomes active meanwhile: the popover's cel stays the one it showed.
        history.execute(addLayerCommand(session, { newId: sequentialIds("l") }));
        expect(session.activeLayerId).not.toBe(painted);
        editCelOpacity(40);
        run(CEL_PROPERTIES_COMMANDS.apply);
        expect(celAt(session.doc, painted, session.activeFrameId)?.opacity).toBe(40);

        run(CEL_PROPERTIES_COMMANDS.open);
        expect(celPropertiesStore.getState().draft).toBeNull();
        session.activeLayerId = painted;
        sessionsStore.getState().touch(document.id);
        run(CEL_PROPERTIES_COMMANDS.open);
        expect(celPropertiesStore.getState().draft).not.toBeNull();
        sessionsStore.getState().close(document.id);
        expect(activeDocument(sessionsStore.getState())).toBeNull();
        expect(celPropertiesStore.getState().draft).toBeNull();
    });
});
