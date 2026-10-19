import { describe, expect, it } from "vitest";
import { History } from "../../src/core/history";
import {
    IMPORT_LABEL,
    ImportPlacementError,
    importIntoDocumentCommand,
    importedDocument,
    paletteAfterImport,
} from "../../src/core/import";
import { addFrameCommand } from "../../src/core/frames";
import { addLayerCommand } from "../../src/core/layers";
import {
    DEFAULT_FRAME_DURATION_MS,
    assertInvariants,
    celAt,
    createDocument,
    defaultPalette,
    sequentialIds,
} from "../../src/core/model";
import type { DocSession, Palette, PixelBuffer, SpriteDoc } from "../../src/core/model";
import { addReferenceLayerCommand } from "../../src/core/references";

// SE-044: step 9 of SPEC §8, where the frames of an import go, and the palette handling.

function flat(width: number, height: number, value: number): PixelBuffer {
    return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(value) };
}

function frames(count: number, width = 4, height = 4): PixelBuffer[] {
    return Array.from({ length: count }, (_, index) => flat(width, height, 10 + index));
}

/** A 4 × 4 document with `count` frames; each existing frame gets a cel of value 1. */
function documentWith(count: number): { session: DocSession; history: History } {
    const session = createDocument({ name: "doc", width: 4, height: 4 }, sequentialIds("d"));
    const history = new History(session);
    for (let index = 1; index < count; index++) {
        const last = session.doc.frames[session.doc.frames.length - 1]!.id;
        history.execute(addFrameCommand(session.doc, last, sequentialIds(`f${index}-`)));
    }
    session.activeFrameId = session.doc.frames[0]!.id;
    return { session, history };
}

/** A snapshot of what an undo must restore. */
function snapshot(doc: SpriteDoc) {
    return JSON.stringify({
        layers: doc.layers,
        frames: doc.frames,
        cels: [...doc.cels],
        images: [...doc.images].map(([id, image]) => [id, image.width, [...image.data]]),
        palette: doc.palette,
        tags: doc.tags,
    });
}

/** The value of the first byte of the cel of `layerId` at each frame, or null. */
function celValues(doc: SpriteDoc, layerId: string): (number | null)[] {
    return doc.frames.map((frame) => {
        const cel = celAt(doc, layerId, frame.id);
        return cel ? doc.images.get(cel.imageId)!.data[0]! : null;
    });
}

const imported: Palette = { name: "Imported", colors: [0x000000ff, 0x111111ff, 0x222222ff] };

describe("paletteAfterImport", () => {
    const current: Palette = { name: "Mine", colors: [0x111111ff, 0xffffffff] };

    it("replace takes the imported palette", () => {
        expect(paletteAfterImport(current, imported, "replace")).toEqual(imported);
    });

    it("append adds only the colours not already present, in their order", () => {
        expect(paletteAfterImport(current, imported, "append")).toEqual({
            name: "Mine",
            colors: [0x111111ff, 0xffffffff, 0x000000ff, 0x222222ff],
        });
    });

    it("append stops at 256 colours", () => {
        const full: Palette = {
            name: "Full",
            colors: Array.from({ length: 255 }, (_, index) => (index << 8) | 0xff),
        };
        const next = paletteAfterImport(full, { name: "I", colors: [1, 2, 3] }, "append");
        expect(next.colors).toHaveLength(256);
        expect(next.colors[255]).toBe(1);
    });

    it("keep leaves the document's palette", () => {
        const kept = paletteAfterImport(current, imported, "keep");
        expect(kept).toEqual(current);
        expect(kept).not.toBe(current);
    });
});

describe("importedDocument", () => {
    it("holds one cel per frame on one layer, at the frames' size, with the palette asked for", () => {
        const made = frames(3, 6, 2);
        const session = importedDocument(
            { name: "walk", frames: made, palette: imported, paletteMode: "replace" },
            sequentialIds("n"),
        );
        const { doc } = session;
        expect([doc.name, doc.width, doc.height]).toEqual(["walk", 6, 2]);
        expect(doc.layers).toHaveLength(1);
        expect(doc.frames.map((frame) => frame.durationMs)).toEqual([
            DEFAULT_FRAME_DURATION_MS,
            DEFAULT_FRAME_DURATION_MS,
            DEFAULT_FRAME_DURATION_MS,
        ]);
        expect(celValues(doc, doc.layers[0]!.id)).toEqual([10, 11, 12]);
        expect(doc.palette).toEqual(imported);
        assertInvariants(session);
        // The pixels are copies.
        made[0]!.data.fill(99);
        expect(celValues(doc, doc.layers[0]!.id)[0]).toBe(10);
    });

    it("appends to or keeps the default palette", () => {
        const keep = importedDocument({
            name: "a",
            frames: frames(1),
            palette: imported,
            paletteMode: "keep",
        });
        expect(keep.doc.palette).toEqual(defaultPalette());
        const append = importedDocument({
            name: "a",
            frames: frames(1),
            palette: imported,
            paletteMode: "append",
        });
        expect(append.doc.palette.colors.slice(0, defaultPalette().colors.length)).toEqual(
            defaultPalette().colors,
        );
    });

    it("refuses frames of different sizes", () => {
        expect(() =>
            importedDocument({
                name: "a",
                frames: [flat(2, 2, 1), flat(3, 2, 1)],
                palette: imported,
                paletteMode: "keep",
            }),
        ).toThrow(ImportPlacementError);
    });
});

describe("importIntoDocumentCommand", () => {
    it("a 4-cell import as a new layer into a 2-frame document yields 4 frames and one new layer", () => {
        const { session, history } = documentWith(2);
        const before = snapshot(session.doc);
        const layersBefore = session.doc.layers.length;
        history.execute(
            importIntoDocumentCommand(session, frames(4), {
                destination: "layer",
                palette: imported,
                paletteMode: "keep",
                newId: sequentialIds("i"),
            }),
        );
        const { doc } = session;
        expect(doc.frames).toHaveLength(4);
        expect(doc.layers).toHaveLength(layersBefore + 1);
        // The new layer sits above the active one and is the active layer; its cels start at
        // the active frame (the first).
        expect(session.activeLayerId).toBe(doc.layers[1]!.id);
        expect(celValues(doc, doc.layers[1]!.id)).toEqual([10, 11, 12, 13]);
        // The added frames take the duration of the last frame.
        expect(doc.frames[3]!.durationMs).toBe(doc.frames[1]!.durationMs);
        assertInvariants(session);

        // One undo step, which restores the document exactly; redo makes it again.
        expect(history.undoCount).toBe(2);
        expect(history.undo()).toBe(true);
        expect(snapshot(doc)).toBe(before);
        expect(history.redo()).toBe(true);
        expect(celValues(doc, doc.layers[1]!.id)).toEqual([10, 11, 12, 13]);
        assertInvariants(session);
    });

    it("a new layer starts at the active frame and adds frames only where needed", () => {
        const { session, history } = documentWith(3);
        session.activeFrameId = session.doc.frames[1]!.id;
        history.execute(
            importIntoDocumentCommand(session, frames(2), {
                destination: "layer",
                palette: imported,
                paletteMode: "keep",
                layerName: "Imported",
            }),
        );
        const layer = session.doc.layers.find((entry) => entry.name === "Imported")!;
        expect(session.doc.frames).toHaveLength(3);
        expect(celValues(session.doc, layer.id)).toEqual([null, 10, 11]);
    });

    it("new frames go at the end, in the active layer, the first of them active", () => {
        const { session, history } = documentWith(2);
        const layerId = session.activeLayerId;
        const before = snapshot(session.doc);
        const activeBefore = session.activeFrameId;
        history.execute(
            importIntoDocumentCommand(session, frames(3), {
                destination: "frames",
                palette: imported,
                paletteMode: "keep",
            }),
        );
        const { doc } = session;
        expect(doc.layers).toHaveLength(1);
        expect(celValues(doc, layerId)).toEqual([null, null, 10, 11, 12]);
        expect(session.activeFrameId).toBe(doc.frames[2]!.id);
        assertInvariants(session);
        history.undo();
        expect(snapshot(doc)).toBe(before);
        expect(session.activeFrameId).toBe(activeBefore);
    });

    it("new frames go into the top pixel layer while a reference layer is active", () => {
        const { session, history } = documentWith(1);
        history.execute(addLayerCommand(session, { newId: () => "top" }));
        history.execute(
            addReferenceLayerCommand(session, {
                sourceId: "s",
                sourceWidth: 4,
                sourceHeight: 4,
                newId: () => "ref",
            }),
        );
        session.activeLayerId = "ref";
        history.execute(
            importIntoDocumentCommand(session, frames(1), {
                destination: "frames",
                palette: imported,
                paletteMode: "keep",
            }),
        );
        expect(celValues(session.doc, "top")).toEqual([null, 10]);
    });

    it("palette append adds only colours not already present, in the same step", () => {
        const { session, history } = documentWith(1);
        const present = session.doc.palette.colors[0]!;
        const palette: Palette = { name: "Imported", colors: [present, 0x01020304] };
        const count = session.doc.palette.colors.length;
        history.execute(
            importIntoDocumentCommand(session, frames(1), {
                destination: "frames",
                palette,
                paletteMode: "append",
            }),
        );
        expect(session.doc.palette.colors).toHaveLength(count + 1);
        expect(session.doc.palette.colors[count]).toBe(0x01020304);
        history.undo();
        expect(session.doc.palette.colors).toHaveLength(count);
    });

    it("a command done first, as the reference layer, is part of the same step", () => {
        const { session, history } = documentWith(1);
        const before = snapshot(session.doc);
        const undo = history.undoCount;
        const reference = addReferenceLayerCommand(session, {
            sourceId: "s",
            sourceWidth: 8,
            sourceHeight: 8,
            newId: () => "ref",
        });
        const command = importIntoDocumentCommand(session, frames(2), {
            destination: "frames",
            palette: imported,
            paletteMode: "replace",
            first: reference,
        });
        expect(command.label).toBe(IMPORT_LABEL);
        history.execute(command);
        expect(session.doc.layers.map((layer) => layer.kind)).toEqual(["reference", "pixel"]);
        expect(session.doc.palette).toEqual(imported);
        expect(history.undoCount).toBe(undo + 1);
        history.undo();
        expect(snapshot(session.doc)).toBe(before);
    });

    it("refuses frames of another size than the document's", () => {
        const { session } = documentWith(1);
        expect(() =>
            importIntoDocumentCommand(session, frames(1, 5, 4), {
                destination: "frames",
                palette: imported,
                paletteMode: "keep",
            }),
        ).toThrow(/target size must equal the sprite size/);
    });
});
