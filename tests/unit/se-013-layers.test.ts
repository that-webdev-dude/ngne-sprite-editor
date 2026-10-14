import { afterEach, describe, expect, it, vi } from "vitest";
import { overlayLayers as gridLayers } from "../../src/app/overlay/grid.overlay";
import { PIXEL_GRID_ALPHA, TILE_GRID_ALPHA } from "../../src/app/overlay/grid.overlay";
import { cellsBetween, lineRects } from "../../src/app/overlay/gridLines";
import { overlayLayers as outlineLayers } from "../../src/app/overlay/outline.overlay";
import {
    collectOverlayLayers,
    OverlayLayerError,
    overlayLayers,
} from "../../src/app/overlay/overlayLayers";
import { DEFAULT_OVERLAY_THEME } from "../../src/app/overlay/types";
import type { OverlayFrame, OverlayLayer, OverlayTheme } from "../../src/app/overlay/types";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { createViewMapping } from "../../src/app/view/coordinates";
import { createDocument } from "../../src/core/model";
import type { DeviceRect } from "../../src/engine/viewport/geometry";

// SE-013: the draw-layer registry and the three layers of this ticket — the document outline,
// the pixel grid (from 8×) and the tile grid — as they draw on a recording 2D context.

const layer = (id: string, order: number): OverlayLayer => ({ id, order, draw() {} });

describe("draw-layer registry", () => {
    it("finds the layers of every *.overlay.ts module, bottom first", () => {
        // The layers of this ticket, from modules found by the glob and listed nowhere. Later
        // tickets add theirs; what this ticket owns is these three, in this order.
        const mine = [...outlineLayers, ...gridLayers];
        expect(mine.map((entry) => [entry.id, entry.order])).toEqual([
            ["document-outline", 100],
            ["pixel-grid", 200],
            ["tile-grid", 300],
        ]);
        expect(overlayLayers.filter((entry) => mine.includes(entry))).toEqual(mine);
        // The whole stack is in drawing order, each id once.
        const orders = overlayLayers.map((entry) => entry.order);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));
        const ids = overlayLayers.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("takes a layer from a module of its own without an edit to a shared file", () => {
        const added = layer("brush-cursor", 900);
        const axes = layer("symmetry-axes", 250);
        const layers = collectOverlayLayers({
            "./grid.overlay.ts": { overlayLayers: gridLayers },
            "../tools/brushCursor.overlay.ts": { overlayLayers: [added] },
            "./outline.overlay.ts": { overlayLayers: outlineLayers },
            "../symmetry/axes.overlay.ts": { overlayLayers: [axes] },
        });
        expect(layers.map((entry) => entry.id)).toEqual([
            "document-outline",
            "pixel-grid",
            "symmetry-axes",
            "tile-grid",
            "brush-cursor",
        ]);
    });

    it("draws equal orders by id, whatever the order of the modules", () => {
        const one = collectOverlayLayers({
            "./b.overlay.ts": { overlayLayers: [layer("b", 5)] },
            "./a.overlay.ts": { overlayLayers: [layer("a", 5)] },
        });
        const other = collectOverlayLayers({
            "./a.overlay.ts": { overlayLayers: [layer("a", 5)] },
            "./b.overlay.ts": { overlayLayers: [layer("b", 5)] },
        });
        expect(one.map((entry) => entry.id)).toEqual(["a", "b"]);
        expect(other.map((entry) => entry.id)).toEqual(["a", "b"]);
    });

    it("refuses a module without layers, a layer without id or order, and an id used twice", () => {
        expect(() => collectOverlayLayers({ "./empty.overlay.ts": {} })).toThrow(
            new OverlayLayerError('./empty.overlay.ts does not export "overlayLayers".'),
        );
        expect(() =>
            collectOverlayLayers({ "./x.overlay.ts": { overlayLayers: [layer(" ", 1)] } }),
        ).toThrow("A layer of ./x.overlay.ts has no id.");
        expect(() =>
            collectOverlayLayers({ "./x.overlay.ts": { overlayLayers: [layer("x", NaN)] } }),
        ).toThrow('Overlay layer "x" (./x.overlay.ts) has no order.');
        expect(() =>
            collectOverlayLayers({
                "./a.overlay.ts": { overlayLayers: [layer("grid", 1)] },
                "./b.overlay.ts": { overlayLayers: [layer("grid", 2)] },
            }),
        ).toThrow('Overlay layer id "grid" is used by ./a.overlay.ts and ./b.overlay.ts.');
    });
});

/** A 2D context that records the rectangles of each fill and clip, with the fill style. */
function recordingContext() {
    const operations: { kind: "fill" | "clip"; style: string; rects: DeviceRect[] }[] = [];
    let path: DeviceRect[] = [];
    const context = {
        operations,
        fillStyle: "",
        beginPath: () => void (path = []),
        rect: (x: number, y: number, width: number, height: number) =>
            void path.push({ x, y, width, height }),
        fill() {
            operations.push({ kind: "fill", style: context.fillStyle, rects: path });
        },
        clip() {
            operations.push({ kind: "clip", style: "", rects: path });
        },
    };
    return context;
}

const SIZE = { width: 640, height: 400 };

function frameFor(
    document: OpenDocument,
    context: ReturnType<typeof recordingContext>,
    theme: OverlayTheme = DEFAULT_OVERLAY_THEME,
): OverlayFrame {
    const { width, height } = document.session.doc;
    return {
        context: context as unknown as CanvasRenderingContext2D,
        size: SIZE,
        document,
        mapping: createViewMapping({
            view: document.view,
            docWidth: width,
            docHeight: height,
            ratio: 1,
            left: 0,
            top: 0,
        }),
        cursor: null,
        theme,
    };
}

function open(view: { scale: number; originX: number; originY: number }) {
    return sessionsStore
        .getState()
        .open(createDocument({ name: "grid", width: 12, height: 8 }), { view });
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document");
    return document;
}

function draw(id: string, document: OpenDocument, theme?: OverlayTheme) {
    const context = recordingContext();
    const found = overlayLayers.find((entry) => entry.id === id);
    if (!found) throw new Error(`no layer ${id}`);
    found.draw(frameFor(document, context, theme));
    return context.operations;
}

function settings(update: (settings: OpenDocument["session"]["doc"]["settings"]) => void) {
    const state = sessionsStore.getState();
    state.updateDocSettings(state.activeId ?? "", update);
}

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
});

describe("the layers of SE-013", () => {
    it("outlines the document 1 device pixel outside its bounds in the outline colour", () => {
        const document = open({ scale: 8, originX: 37, originY: 23 });
        expect(draw("document-outline", document)).toEqual([
            {
                kind: "fill",
                style: "rgb(58 58 64 / 1)",
                rects: [
                    { x: 36, y: 22, width: 98, height: 1 },
                    { x: 36, y: 87, width: 98, height: 1 },
                    { x: 36, y: 23, width: 1, height: 64 },
                    { x: 133, y: 23, width: 1, height: 64 },
                ],
            },
        ]);
        expect(draw("document-outline", document, { outline: 0xb4b4ba, ink: 0 })[0]?.style).toBe(
            "rgb(180 180 186 / 1)",
        );
    });

    it("draws the pixel grid from 8× up, in 12% of the ink, on the first device pixel of each texel", () => {
        for (const scale of [8, 12, 16]) {
            const document = open({ scale, originX: 37, originY: 23 });
            const columns = Array.from({ length: 11 }, (_, index) => 37 + (index + 1) * scale);
            const rows = Array.from({ length: 7 }, (_, index) => 23 + (index + 1) * scale);
            const area = { x: 37, y: 23, width: 12 * scale, height: 8 * scale };
            expect(draw("pixel-grid", document), `${scale}×`).toEqual([
                {
                    kind: "fill",
                    style: `rgb(255 255 255 / ${PIXEL_GRID_ALPHA})`,
                    rects: lineRects({ columns, rows }, area),
                },
            ]);
            expect(draw("pixel-grid", document, { outline: 0, ink: 0x000000 })[0]?.style).toBe(
                `rgb(0 0 0 / ${PIXEL_GRID_ALPHA})`,
            );
            sessionsStore.getState().close(document.id);
        }
        expect(PIXEL_GRID_ALPHA).toBe(0.12);
        for (const scale of [1, 4, 6]) {
            const document = open({ scale, originX: 37, originY: 23 });
            expect(draw("pixel-grid", document), `${scale}×`).toEqual([]);
            sessionsStore.getState().close(document.id);
        }
        // Off: nothing at any zoom.
        const document = open({ scale: 16, originX: 0, originY: 0 });
        settings((value) => {
            value.pixelGrid = false;
        });
        expect(draw("pixel-grid", document)).toEqual([]);
    });

    it("draws the tile grid at 25% of the ink while it is visible, and leaves its lines to it", () => {
        const document = open({ scale: 8, originX: 37, originY: 23 });
        expect(draw("tile-grid", document)).toEqual([]);
        settings((value) => {
            Object.assign(value.grid, { width: 5, height: 3, offsetX: 2, offsetY: -1 });
            value.grid.visible = true;
        });
        const area = { x: 37, y: 23, width: 96, height: 64 };
        const tiles = {
            columns: [2, 7].map((x) => 37 + x * 8),
            rows: [2, 5].map((y) => 23 + y * 8),
        };
        expect(draw("tile-grid", active())).toEqual([
            {
                kind: "fill",
                style: `rgb(255 255 255 / ${TILE_GRID_ALPHA})`,
                rects: lineRects(tiles, area),
            },
        ]);
        expect(TILE_GRID_ALPHA).toBe(0.25);
        // The pixel grid is drawn outside the tile grid's lines only: each pixel has one ink.
        const columns = Array.from({ length: 11 }, (_, index) => 37 + (index + 1) * 8);
        const rows = Array.from({ length: 7 }, (_, index) => 23 + (index + 1) * 8);
        expect(draw("pixel-grid", active())).toEqual([
            { kind: "clip", style: "", rects: cellsBetween(tiles, area) },
            {
                kind: "fill",
                style: `rgb(255 255 255 / ${PIXEL_GRID_ALPHA})`,
                rects: lineRects({ columns, rows }, area),
            },
        ]);
    });

    it("asks for a redraw when its settings change, and not for pixels or other settings", () => {
        open({ scale: 8, originX: 0, originY: 0 });
        const requests = { "pixel-grid": vi.fn(), "tile-grid": vi.fn() };
        const stops = gridLayers.map((entry) =>
            entry.watch?.(requests[entry.id as keyof typeof requests]),
        );
        const counts = () => [
            requests["pixel-grid"].mock.calls.length,
            requests["tile-grid"].mock.calls.length,
        ];
        try {
            // A pixel edit, a setting the grids do not read, the view.
            const { session, history, id } = active();
            const transaction = history.begin({
                layerId: session.activeLayerId,
                frameId: session.activeFrameId,
            });
            transaction.image.data.fill(200);
            transaction.markDirty({ x: 0, y: 0, width: 12, height: 8 });
            transaction.commit("Paint");
            settings((value) => {
                value.onion.enabled = true;
            });
            sessionsStore.getState().setView(id, { scale: 12 });
            expect(counts()).toEqual([0, 0]);

            settings((value) => {
                value.pixelGrid = false;
            });
            expect(counts()).toEqual([1, 0]);
            settings((value) => {
                value.grid.visible = true;
            });
            expect(counts()).toEqual([2, 1]);
            settings((value) => {
                value.grid.offsetX = 3;
            });
            expect(counts()).toEqual([3, 2]);
            settings(() => {});
            expect(counts()).toEqual([3, 2]);
        } finally {
            for (const stop of stops) stop?.();
        }
        // Stopped: no more requests.
        settings((value) => {
            value.pixelGrid = true;
        });
        expect(counts()).toEqual([3, 2]);
    });
});
