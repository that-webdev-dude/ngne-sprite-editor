import { describe, expect, it } from "vitest";
import { createPreferenceStore } from "../../src/app/preferences/preferences";
import { createReferenceImages } from "../../src/app/references/referenceImages";
import { createActiveComposites } from "../../src/app/state/composites";
import { createSessionsStore } from "../../src/app/state/sessions";
import { rowOrder } from "../../src/app/timeline/selection";
import { timelineModel } from "../../src/app/timeline/timelineModel";
import { echoPixels } from "../../src/app/tools/strokeEcho.overlay";
import { connectViewport } from "../../src/app/viewport/viewportController";
import { setLayerOpacityCommand, setLayerVisibleCommand } from "../../src/core/layers";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { encodePng } from "../../src/core/png";
import { addReferenceLayerCommand, setReferenceCommand } from "../../src/core/references";
import type { ViewportReference } from "../../src/engine/viewport/types";
import { RecordingViewport } from "./se-011-support";

// SE-045 in `app`: what the viewport is given of the reference layers, what the timeline lists
// of them, and how the stroke echo gives way to them.

function sprite(name: string, width = 8, height = 4): DocSession {
    return createDocument({ name, width, height }, sequentialIds(`${name}-`));
}

function addReference(session: DocSession, sourceId: string, id: string, width = 4, height = 4) {
    return addReferenceLayerCommand(session, {
        sourceId,
        sourceWidth: width,
        sourceHeight: height,
        newId: () => id,
    });
}

class ReferenceViewport extends RecordingViewport {
    references: readonly ViewportReference[] = [];
    setReferences(references: readonly ViewportReference[]): void {
        this.references = references;
    }
}

function png(width: number, height: number): Uint8Array {
    return encodePng({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(200) });
}

describe("connectViewport: reference layers", () => {
    it("gives the viewport the visible reference layers of the shown document whose source is decoded", async () => {
        const sessions = createSessionsStore();
        const images = createReferenceImages();
        const viewport = new ReferenceViewport();
        connectViewport(viewport, {
            sessions,
            preferences: createPreferenceStore(null),
            composites: createActiveComposites(sessions),
            referenceImages: images,
        });
        const session = sprite("a");
        const bytes = png(4, 4);
        const document = sessions.getState().open(session, { referenceSources: [["s1", bytes]] });
        document.history.execute(addReference(session, "s1", "ref-1"));
        // Not decoded yet: nothing is drawn, and the decode has started.
        expect(viewport.references).toEqual([]);
        const image: PixelBuffer = await images.decode(bytes);
        expect(viewport.references).toEqual([
            {
                id: "ref-1",
                image,
                x: 2,
                y: 0,
                scale: 1,
                opacity: 128,
                placement: "behind",
            },
        ]);
        document.history.execute(
            setReferenceCommand(session, "ref-1", { placement: "front", x: 1 })!,
        );
        expect(viewport.references[0]).toMatchObject({ placement: "front", x: 1 });
        document.history.execute(setLayerOpacityCommand(session, "ref-1", 30)!);
        expect(viewport.references[0]?.opacity).toBe(30);
        // At opacity 0 it is given no more than a hidden one (SE-045 review K).
        document.history.execute(setLayerOpacityCommand(session, "ref-1", 0)!);
        expect(viewport.references).toEqual([]);
        document.history.undo();
        document.history.execute(setLayerVisibleCommand(session, "ref-1", false)!);
        expect(viewport.references).toEqual([]);
        document.history.undo();
        expect(viewport.references).toHaveLength(1);

        // Another document shows its own, none here; closing every document shows none.
        sessions.getState().open(sprite("b"));
        expect(viewport.references).toEqual([]);
        sessions.getState().activate(document.id);
        expect(viewport.references).toHaveLength(1);
        for (const { id } of sessions.getState().documents) sessions.getState().close(id);
        expect(viewport.references).toEqual([]);
    });
});

describe("timeline: the Reference group", () => {
    it("lists reference layers apart from the pixel layers, top of the stack first; ↑ ↓ walk the pixel rows, then the group", () => {
        const session = sprite("t");
        const pixel = session.doc.layers[0]!.id;
        addReference(session, "s1", "ref-low").do(session);
        addReference(session, "s2", "ref-high").do(session);
        const model = timelineModel("doc", session);
        expect(model.layers.map((layer) => layer.id)).toEqual([pixel]);
        expect(model.references.map((layer) => layer.id)).toEqual(["ref-high", "ref-low"]);
        expect(model.references[0]).toMatchObject({ opacity: 128, placement: "behind" });
        // Bottom up: the group's rows under the pixel layers' rows.
        expect(rowOrder(session.doc)).toEqual(["ref-low", "ref-high", pixel]);
        // A change of a reference changes its row's key, so the row is drawn again.
        const before = model.references[0]!.key;
        setReferenceCommand(session, "ref-high", { placement: "front" })!.do(session);
        expect(timelineModel("doc", session).references[0]!.key).not.toBe(before);
    });
});

describe("stroke echo: giving way to references", () => {
    const checker = { a: 0x101010, b: 0x202020, size: 8 };
    /** A 4 × 1 composite: opaque, transparent, half, opaque. */
    const buffer: PixelBuffer = {
        width: 4,
        height: 1,
        data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255]),
    };
    const rect = { x: 0, y: 0, width: 4, height: 1 };
    const alphas = (pixels: Uint8ClampedArray) =>
        Array.from({ length: pixels.length / 4 }, (_, index) => pixels[index * 4 + 3]);

    it("draws every pixel opaque without references", () => {
        expect(alphas(echoPixels(buffer, rect, checker))).toEqual([255, 255, 255, 255]);
    });

    it("over a reference behind draws only the opaque pixels, which hide it in NGNE too", () => {
        const cover = { behind: [{ x: 0, y: 0, width: 4, height: 1 }], front: [] };
        expect(alphas(echoPixels(buffer, rect, checker, cover))).toEqual([255, 0, 0, 255]);
    });

    it("over a reference in front draws nothing, also where it covers part of a texel", () => {
        const cover = { behind: [], front: [{ x: 2.5, y: 0.25, width: 0.75, height: 0.5 }] };
        expect(alphas(echoPixels(buffer, rect, checker, cover))).toEqual([255, 255, 0, 0]);
    });
});
