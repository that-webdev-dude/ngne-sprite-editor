import { describe, expect, it } from "vitest";
import { overlayLayers } from "../../src/app/overlay/overlayLayers";
import { createPreferenceStore } from "../../src/app/preferences/preferences";
import {
    createReferenceBoxLayer,
    REFERENCE_BOX_ORDER,
} from "../../src/app/references/referenceBox.overlay";
import { createReferenceImages } from "../../src/app/references/referenceImages";
import { createReferencePreview } from "../../src/app/references/referencePreview";
import { MOVE_TOOL_ID } from "../../src/app/selection/move/moveTool";
import { createActiveComposites } from "../../src/app/state/composites";
import { activeDocument, createSessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { createViewMapping } from "../../src/app/view/coordinates";
import { connectViewport } from "../../src/app/viewport/viewportController";
import { setLayerOpacityCommand } from "../../src/core/layers";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, ReferenceLayer } from "../../src/core/model";
import { encodePng } from "../../src/core/png";
import { addReferenceLayerCommand } from "../../src/core/references";
import type { ViewportReference } from "../../src/engine/viewport/types";
import { RecordingViewport } from "./se-011-support";

// SE-046 in `app`: what the viewport is given of a reference layer while the Move tool drags it
// (the preview, in place of the document's values, for that layer of that session only), and
// the reference box on the overlay: the outline and four corner handles of the active
// reference layer while the Move tool is active, following the drag.

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

describe("connectViewport: a reference layer during a drag", () => {
    it("draws the layer the preview names, of the shown session, where the preview has it", async () => {
        const sessions = createSessionsStore();
        const images = createReferenceImages();
        const preview = createReferencePreview();
        const viewport = new ReferenceViewport();
        connectViewport(viewport, {
            sessions,
            preferences: createPreferenceStore(null),
            composites: createActiveComposites(sessions),
            referenceImages: images,
            referencePreview: preview,
        });
        const session = sprite("a");
        const bytes = png(4, 4);
        const document = sessions.getState().open(session, {
            referenceSources: [
                ["s1", bytes],
                ["s2", bytes],
            ],
        });
        document.history.execute(addReference(session, "s1", "ref-1"));
        document.history.execute(addReference(session, "s2", "ref-2"));
        await images.decode(bytes);
        const at = () => viewport.references.map(({ id, x, y, scale }) => ({ id, x, y, scale }));
        expect(at()).toEqual([
            { id: "ref-1", x: 2, y: 0, scale: 1 },
            { id: "ref-2", x: 2, y: 0, scale: 1 },
        ]);

        // The Move tool drags the active layer.
        const pixelLayer = session.activeLayerId;
        session.activeLayerId = "ref-2";
        sessions.getState().touch(document.id);
        preview.setState({ session, layerId: "ref-2", x: 5.5, y: -1, scale: 0.5 });
        expect(at()).toEqual([
            { id: "ref-1", x: 2, y: 0, scale: 1 },
            { id: "ref-2", x: 5.5, y: -1, scale: 0.5 },
        ]);
        // The document itself is unchanged.
        expect(session.doc.layers.find((layer) => layer.id === "ref-2")).toMatchObject({
            x: 2,
            y: 0,
            scale: 1,
        });
        // A preview of another session changes nothing here.
        preview.setState({ session: sprite("b"), layerId: "ref-1", x: 9, y: 9, scale: 2 });
        expect(at()).toEqual([
            { id: "ref-1", x: 2, y: 0, scale: 1 },
            { id: "ref-2", x: 2, y: 0, scale: 1 },
        ]);
        session.activeLayerId = "ref-1";
        sessions.getState().touch(document.id);
        preview.setState({ session, layerId: "ref-1", x: 3, y: 1, scale: 2 });
        expect(at()[0]).toEqual({ id: "ref-1", x: 3, y: 1, scale: 2 });
        // Another layer made active cancels the drag: shown as the document has it at once,
        // before the tool hears of it (SE-046 review E).
        session.activeLayerId = pixelLayer;
        sessions.getState().touch(document.id);
        expect(at()[0]).toEqual({ id: "ref-1", x: 2, y: 0, scale: 1 });
        session.activeLayerId = "ref-1";
        sessions.getState().touch(document.id);
        expect(at()[0]).toEqual({ id: "ref-1", x: 3, y: 1, scale: 2 });
        preview.setState(null, true);
        expect(at()[0]).toEqual({ id: "ref-1", x: 2, y: 0, scale: 1 });
    });
});

describe("the reference box on the overlay", () => {
    /** A 2D context that records the rectangles and lines it is given. */
    function recorder() {
        const calls: string[] = [];
        const context = {
            beginPath: () => calls.push("beginPath"),
            moveTo: (x: number, y: number) => calls.push(`moveTo ${x} ${y}`),
            lineTo: (x: number, y: number) => calls.push(`lineTo ${x} ${y}`),
            closePath: () => calls.push("closePath"),
            stroke: () => calls.push("stroke"),
            rect: (x: number, y: number, w: number, h: number) =>
                calls.push(`rect ${x} ${y} ${w} ${h}`),
            fill: () => calls.push("fill"),
        } as unknown as CanvasRenderingContext2D;
        return { context, calls };
    }

    it("is registered over the ants and the pending shape, under a float's transform box", () => {
        const layer = overlayLayers.find((entry) => entry.id === "reference-box");
        expect(layer?.order).toBe(REFERENCE_BOX_ORDER);
        const order = (id: string) => overlayLayers.find((entry) => entry.id === id)?.order ?? NaN;
        expect(REFERENCE_BOX_ORDER).toBeGreaterThan(order("selection-preview"));
        expect(REFERENCE_BOX_ORDER).toBeLessThan(order("transform-box"));
    });

    it("draws the active reference layer's outline and four corner handles while the Move tool is active", () => {
        const sessions = createSessionsStore();
        const session = sprite("o", 16, 12);
        const document = sessions
            .getState()
            .open(session, { view: { scale: 4, originX: 0, originY: 0 } });
        document.history.execute(addReference(session, "s", "ref", 32, 16));
        session.activeLayerId = "ref";
        const preview = createReferencePreview();
        let tool: string | null = MOVE_TOOL_ID;
        let size: { width: number; height: number } | null = { width: 32, height: 16 };
        const layer = createReferenceBoxLayer({
            preview,
            activeTool: () => tool,
            sourceSize: () => size,
            document: () => activeDocument(sessions.getState()),
            subscribe(listener) {
                const stops = [sessions.subscribe(listener), preview.subscribe(listener)];
                return () => stops.forEach((stop) => stop());
            },
        });
        const reference = session.doc.layers.find((entry) => entry.id === "ref") as ReferenceLayer;
        const frame = (shown: OpenDocument = document) => {
            const { context, calls } = recorder();
            layer.draw({
                context,
                size: { width: 200, height: 200 },
                document: shown,
                mapping: createViewMapping({
                    view: shown.view,
                    docWidth: 16,
                    docHeight: 12,
                    ratio: 1,
                    left: 0,
                    top: 0,
                }),
                cursor: null,
                theme: { outline: 0, ink: 0xffffff },
            });
            return calls;
        };
        const outline = (calls: string[]) => calls.filter((call) => /^(moveTo|lineTo)/.test(call));

        // Fitted: 16 × 8 from (0, 2), at 4×: half a device pixel in.
        expect(reference).toMatchObject({ x: 0, y: 2, scale: 0.5 });
        const calls = frame();
        expect(outline(calls)).toEqual([
            "moveTo -0.5 7.5",
            "lineTo 63.5 7.5",
            "lineTo 63.5 39.5",
            "lineTo -0.5 39.5",
        ]);
        // Four handles, each a dark square and a light one inside it, on the corners; none on
        // the middles of the sides. Their sizes are the transform box's (SE-033), not pinned.
        const centres = calls
            .filter((call) => call.startsWith("rect"))
            .map((call) => {
                const [x, y, w, h] = call.split(" ").slice(1).map(Number) as [
                    number,
                    number,
                    number,
                    number,
                ];
                return { x: x + w / 2, y: y + h / 2 };
            });
        expect(centres).toHaveLength(8);
        const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
            Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
        for (const corner of [
            { x: 0, y: 8 },
            { x: 64, y: 8 },
            { x: 64, y: 40 },
            { x: 0, y: 40 },
        ]) {
            expect(centres.filter((centre) => near(centre, corner))).toHaveLength(2);
        }
        for (const middle of [
            { x: 32, y: 8 },
            { x: 64, y: 24 },
            { x: 32, y: 40 },
            { x: 0, y: 24 },
        ]) {
            expect(centres.filter((centre) => near(centre, middle))).toHaveLength(0);
        }

        // A drag shows where it takes the layer: one redraw per change of the box, none for
        // a change of the document that leaves it as it is (SE-013: NGNE draws pixels).
        let redraws = 0;
        const stop = layer.watch!(() => void redraws++);
        document.history.execute(setLayerOpacityCommand(session, "ref", 40)!);
        sessions.getState().touch(document.id);
        expect(redraws).toBe(0);
        preview.setState({ session, layerId: "ref", x: 2, y: 3, scale: 0.25 });
        expect(redraws).toBe(1);
        preview.setState({ session, layerId: "ref", x: 2, y: 3, scale: 0.25 });
        expect(redraws).toBe(1);
        expect(outline(frame())).toEqual([
            "moveTo 7.5 11.5",
            "lineTo 39.5 11.5",
            "lineTo 39.5 27.5",
            "lineTo 7.5 27.5",
        ]);
        // Space (the hand) or a tool key during the drag: the box stays while it lasts
        // (SE-046 review D).
        tool = "hand";
        expect(outline(frame())).toEqual([
            "moveTo 7.5 11.5",
            "lineTo 39.5 11.5",
            "lineTo 39.5 27.5",
            "lineTo 7.5 27.5",
        ]);
        tool = MOVE_TOOL_ID;
        stop();
        preview.setState(null, true);

        // Nothing for another tool, a locked or hidden layer, a pixel layer, an undecoded source.
        tool = "pencil";
        expect(frame()).toEqual([]);
        tool = MOVE_TOOL_ID;
        reference.locked = true;
        expect(frame()).toEqual([]);
        reference.locked = false;
        reference.visible = false;
        expect(frame()).toEqual([]);
        reference.visible = true;
        size = null;
        expect(frame()).toEqual([]);
        size = { width: 32, height: 16 };
        session.activeLayerId = session.doc.layers.find((entry) => entry.kind === "pixel")!.id;
        expect(frame()).toEqual([]);
        session.activeLayerId = "ref";
        expect(frame()).not.toEqual([]);
    });
});
