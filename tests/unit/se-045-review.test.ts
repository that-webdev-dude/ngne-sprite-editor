import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { notices } from "../../src/app/notices/notices";
import { referenceImages } from "../../src/app/references/referenceImages";
import {
    addReferenceLayerFromPng,
    changeReference,
    REFERENCE_LOCKED,
    referenceFit,
    referenceLayerCommandFromPng,
    resetReferenceFit,
} from "../../src/app/references/references";
import { sourcesFreedBy, withReferenceSources } from "../../src/app/references/referenceSources";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { TIMELINE_COMMANDS } from "../../src/app/timeline/timelineCommandIds";
import {
    editReferenceProperties,
    initialTimelineState,
    timelineStore,
} from "../../src/app/timeline/timelineState";
import { compositeCommand } from "../../src/core/history";
import {
    deleteLayerCommand,
    renameLayerCommand,
    setLayerLockedCommand,
    setLayerVisibleCommand,
} from "../../src/core/layers";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { ReferenceLayer } from "../../src/core/model";
import { encodePng } from "../../src/core/png";
import { MAX_REFERENCE_SOURCE_BYTES } from "../../src/core/project/format";
import { serialize } from "../../src/core/project";
import { fitToCanvas } from "../../src/core/references";

// SE-045 review: who holds the source bytes (C), the step SE-044 chains (H), a document opened
// again meanwhile (I), the failure toasts (M), Reset to Fit of an undecoded source (J) and the
// lock of a reference layer's geometry (L), through the app's own stores and registry.

let errors: string[] = [];
let stopSink: () => void = () => {};

beforeEach(() => {
    errors = [];
    stopSink = notices.attachSink((kind, message) => {
        if (kind === "error") errors.push(message);
    });
});

afterEach(() => {
    stopSink();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    timelineStore.setState(initialTimelineState());
    vi.restoreAllMocks();
});

function png(width: number, height: number, value = 200): Uint8Array {
    return encodePng({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4).fill(value),
    });
}

let opened = 0;
function open(): OpenDocument {
    opened++;
    const session = createDocument(
        { name: "doc", width: 8, height: 4 },
        sequentialIds(`d${opened}-`),
    );
    return sessionsStore.getState().open(session);
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no active document");
    return document;
}

function reference(id: string): ReferenceLayer {
    const layer = active().session.doc.layers.find((entry) => entry.id === id);
    if (layer?.kind !== "reference") throw new Error(`no reference ${id}`);
    return layer;
}

describe("C: the store holds only the sources a layer names", () => {
    it("add, undo and redo: the source goes out of the store and comes back with identical bytes", async () => {
        open();
        const bytes = png(4, 4);
        const id = await addReferenceLayerFromPng(bytes);
        expect(id).not.toBeNull();
        const { sourceId } = reference(id!);
        const stored = active().referenceSources.get(sourceId)!;
        expect(Array.from(stored)).toEqual(Array.from(bytes));
        expect(referenceImages.get(stored)).not.toBeNull();

        active().history.undo();
        expect([...active().referenceSources.keys()]).toEqual([]);
        // Its decoded image went with it: asked again, it is decoded anew.
        expect(referenceImages.get(stored)).toBeNull();

        active().history.redo();
        expect(active().referenceSources.get(sourceId)).toBe(stored);
        // Saved: the file has the source again.
        expect(() => serialize(active().session.doc, active().referenceSources)).not.toThrow();
    });

    it("delete and undo through Delete Layer: the source goes and comes back", async () => {
        open();
        const id = (await addReferenceLayerFromPng(png(2, 2)))!;
        const { sourceId } = reference(id);
        const bytes = active().referenceSources.get(sourceId)!;
        active().session.activeLayerId = id;
        sessionsStore.getState().touch(active().id);
        const remove = appCommands.get(TIMELINE_COMMANDS.deleteLayer)!;
        expect(remove.enabled()).toBe(true);
        void remove.run();
        expect(active().session.doc.layers.some((layer) => layer.id === id)).toBe(false);
        expect(active().referenceSources.size).toBe(0);
        active().history.undo();
        expect(active().referenceSources.get(sourceId)).toBe(bytes);
        expect(reference(id).sourceId).toBe(sourceId);
    });

    it("the steps' bytes include the source size", async () => {
        const document = open();
        const bytes = png(16, 16, 77);
        const step = (await referenceLayerCommandFromPng(bytes))!;
        expect(step.command.bytes).toBe(bytes.byteLength);
        document.history.execute(step.command);
        const freed = sourcesFreedBy(
            document.session.doc,
            [step.layerId],
            active().referenceSources,
        );
        expect([...freed.values()].map((entry) => entry.byteLength)).toEqual([bytes.byteLength]);
        const removal = withReferenceSources(deleteLayerCommand(document.session, step.layerId), {
            sessions: sessionsStore,
            documentId: document.id,
            owned: freed,
        });
        expect(removal.bytes).toBe(bytes.byteLength);
    });
});

describe("H: the step SE-044 chains", () => {
    it("composed with another command in one step, one undo removes both, the source included", async () => {
        const document = open();
        const pixel = document.session.doc.layers[0]!.id;
        const step = (await referenceLayerCommandFromPng(png(4, 4), { name: "Sheet" }))!;
        expect(document.session.doc.layers).toHaveLength(1);
        expect(document.referenceSources.size).toBe(0);
        const rename = renameLayerCommand(document.session, pixel, "Imported")!;
        document.history.execute(compositeCommand("Import", [rename, step.command]));
        expect(reference(step.layerId).name).toBe("Sheet");
        expect(active().referenceSources.size).toBe(1);
        expect(document.history.undoCount).toBe(1);
        document.history.undo();
        expect(document.session.doc.layers.map((layer) => layer.name)).toEqual(["Layer 1"]);
        expect(active().referenceSources.size).toBe(0);
    });
});

describe("I and M: failures are toasts, and the document is unchanged", () => {
    it("a file that is not a PNG", async () => {
        const document = open();
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await addReferenceLayerFromPng(new Uint8Array([1, 2, 3, 4]))).toBeNull();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/^Could not add the reference layer\. /);
        expect(document.history.undoCount).toBe(0);
        // The caller reported it: nothing on the console.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(logged).not.toHaveBeenCalled();
    });

    it("a file larger than 64 MiB", async () => {
        const document = open();
        const big = new Uint8Array(MAX_REFERENCE_SOURCE_BYTES + 1);
        big.set(png(1, 1));
        expect(await addReferenceLayerFromPng(big)).toBeNull();
        expect(errors).toEqual([
            "Could not add the reference layer. The file is larger than 64 MiB.",
        ]);
        expect(document.session.doc.layers).toHaveLength(1);
    });

    const BUSY = "Could not add the reference layer. The sprite is busy or was closed.";

    it("the document closed while the file was decoded", async () => {
        const document = open();
        const adding = addReferenceLayerFromPng(png(4, 4));
        sessionsStore.getState().close(document.id);
        expect(await adding).toBeNull();
        expect(errors).toEqual([BUSY]);
    });

    it("the document opened again (same id, another session) while the file was decoded", async () => {
        const document = open();
        const adding = addReferenceLayerFromPng(png(4, 4));
        const again = createDocument(
            { name: "doc", width: 8, height: 4 },
            sequentialIds(`d${opened}-`),
        );
        expect(again.doc.id).toBe(document.id);
        const reopened = sessionsStore.getState().replaceActive(again);
        expect(await adding).toBeNull();
        expect(errors).toEqual([BUSY]);
        expect(reopened.session.doc.layers).toHaveLength(1);
        expect(reopened.history.undoCount).toBe(0);
    });

    it("a stroke began while the file was decoded", async () => {
        const document = open();
        const adding = addReferenceLayerFromPng(png(4, 4));
        const { activeLayerId: layerId, activeFrameId: frameId } = document.session;
        const transaction = document.history.begin({ layerId, frameId });
        expect(await adding).toBeNull();
        expect(errors).toEqual([BUSY]);
        transaction.abort();
        expect(document.session.doc.layers).toHaveLength(1);
    });
});

describe("J: Reset to Fit computes the fit when asked, decoding first", () => {
    it("fits a hidden reference whose source was never decoded", async () => {
        const document = open();
        const id = (await addReferenceLayerFromPng(png(2, 4)))!;
        document.history.execute(setLayerVisibleCommand(document.session, id, false)!);
        // Its decoded image gone (as after an undo and a redo), nothing asks for it while hidden.
        const bytes = active().referenceSources.get(reference(id).sourceId)!;
        referenceImages.forget(bytes);
        expect(changeReference(id, { x: 3, scale: 0.5 })).toEqual({ changed: true });
        expect(await referenceFit(document.id, id)).toEqual(
            fitToCanvas(document.session.doc, 2, 4),
        );
        expect(await resetReferenceFit(id)).toEqual({ changed: true });
        expect(reference(id)).toMatchObject(fitToCanvas(document.session.doc, 2, 4));
        expect(document.history.undoLabel).toBe("Reset Reference to Fit");
    });
});

describe("L: a locked reference keeps its geometry", () => {
    it("changeReference and Reset to Fit refuse with the lock reason; the menu commands are disabled; opacity, visibility, name and delete still work", async () => {
        const document = open();
        const id = (await addReferenceLayerFromPng(png(4, 4)))!;
        document.history.execute(setLayerLockedCommand(document.session, id, true)!);
        const before = { ...reference(id) };
        const steps = document.history.undoCount;
        expect(changeReference(id, { x: 5 })).toEqual({
            changed: false,
            refused: REFERENCE_LOCKED,
        });
        expect(REFERENCE_LOCKED).toBe("Layer is locked");
        expect(await resetReferenceFit(id)).toEqual({ changed: false, refused: REFERENCE_LOCKED });
        expect(reference(id)).toEqual(before);
        expect(document.history.undoCount).toBe(steps);

        document.session.activeLayerId = id;
        sessionsStore.getState().touch(document.id);
        expect(appCommands.get("layer.resetReferenceFit")!.enabled()).toBe(false);
        expect(appCommands.get("layer.referencePlacement")!.enabled()).toBe(false);
        expect(appCommands.get(TIMELINE_COMMANDS.toggleVisible)!.enabled()).toBe(true);
        expect(appCommands.get(TIMELINE_COMMANDS.deleteLayer)!.enabled()).toBe(true);

        // The popover's geometry is read-only; its name and opacity still apply.
        void appCommands.get(TIMELINE_COMMANDS.layerProperties)!.run();
        expect(timelineStore.getState().properties?.reference).toMatchObject({ locked: true });
        editReferenceProperties({ x: 9, placement: "front" });
        timelineStore.setState({
            properties: { ...timelineStore.getState().properties!, opacity: 20, name: "Locked" },
        });
        void appCommands.get(TIMELINE_COMMANDS.applyLayerProperties)!.run();
        expect(reference(id)).toMatchObject({ x: before.x, placement: "behind", opacity: 20 });
        expect(reference(id).name).toBe("Locked");
        expect(document.history.undoCount).toBe(steps + 1);

        // Unlocked, the same change goes through.
        document.history.execute(setLayerLockedCommand(document.session, id, false)!);
        expect(changeReference(id, { x: 5 })).toEqual({ changed: true });
        expect(appCommands.get("layer.referencePlacement")!.enabled()).toBe(true);
    });
});
