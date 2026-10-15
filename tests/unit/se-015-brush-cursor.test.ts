import { afterEach, describe, expect, it } from "vitest";
import { overlayLayers } from "../../src/app/overlay/overlayLayers";
import { DEFAULT_OVERLAY_THEME } from "../../src/app/overlay/types";
import type { OverlayCursor, OverlayFrame } from "../../src/app/overlay/types";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import { toolState } from "../../src/app/tools/activeTool";
import { BRUSH_SHAPE, BRUSH_SIZE, hasBrush } from "../../src/app/tools/brush/brushOptions";
import { BRUSH_CURSOR_ORDER, footprintRects } from "../../src/app/tools/brush/brushCursor.overlay";
import { createViewMapping } from "../../src/app/view/coordinates";
import { createDocument } from "../../src/core/model";
import { brushCovers, createBrush } from "../../src/core/raster";
import type { BrushShape } from "../../src/core/raster";

// SE-015: the brush cursor, a draw layer of the overlay (SE-013). Under the pointer it
// outlines the footprint of the active tool's brush: a black ring of 1 device pixel just
// outside the footprint, a white ring outside that, the footprint itself left clear. The
// layer's drawing is replayed here pixel by pixel on a stand-in context.

const SIZE = { width: 200, height: 160 };

type Colour = "black" | "white";

/** A 2D context that records paths, clips and fills and can tell each pixel's colour after. */
function rasterContext() {
    type Rect = { x: number; y: number; width: number; height: number };
    let path: Rect[] = [];
    const clips: { rects: Rect[]; evenOdd: boolean }[] = [];
    const fills: { rects: Rect[]; style: string; clips: typeof clips }[] = [];
    const inside = (rect: Rect, x: number, y: number) =>
        x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    const context = {
        fillStyle: "",
        beginPath: () => void (path = []),
        rect: (x: number, y: number, width: number, height: number) =>
            void path.push({ x, y, width, height }),
        clip: (rule?: string) => void clips.push({ rects: path, evenOdd: rule === "evenodd" }),
        fill: () => void fills.push({ rects: path, style: context.fillStyle, clips: [...clips] }),
        /** The colour last filled at device pixel `x, y` within the clips of that fill. */
        colourAt(x: number, y: number): Colour | null {
            let colour: Colour | null = null;
            for (const fill of fills) {
                if (!fill.rects.some((rect) => inside(rect, x, y))) continue;
                const clipped = fill.clips.every(({ rects, evenOdd }) => {
                    const count = rects.filter((rect) => inside(rect, x, y)).length;
                    return evenOdd ? count % 2 === 1 : count > 0;
                });
                if (!clipped) continue;
                if (fill.style === "rgb(0 0 0 / 1)") colour = "black";
                else if (fill.style === "rgb(255 255 255 / 1)") colour = "white";
                else throw new Error(`unexpected fill ${fill.style}`);
            }
            return colour;
        },
    };
    return context;
}

const layer = () => {
    const found = overlayLayers.find((entry) => entry.id === "brush-cursor");
    if (!found) throw new Error("no brush-cursor layer");
    return found;
};

function open(view: { scale: number; originX: number; originY: number }) {
    sessionsStore.getState().open(createDocument({ name: "cursor", width: 16, height: 12 }), {
        view,
    });
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document");
    return document;
}

/** Draws the layer with the pointer over texel `pixel`; returns the stand-in context. */
function drawAt(
    view: { scale: number; originX: number; originY: number },
    pixel: OverlayCursor["pixel"],
) {
    const document = open(view);
    const mapping = createViewMapping({
        view,
        docWidth: 16,
        docHeight: 12,
        ratio: 1,
        left: 0,
        top: 0,
    });
    const device = mapping.docToDevice(pixel.x + 0.5, pixel.y + 0.5);
    const context = rasterContext();
    const frame: OverlayFrame = {
        context: context as unknown as CanvasRenderingContext2D,
        size: SIZE,
        document,
        mapping,
        cursor: { client: device, device, pixel },
        theme: DEFAULT_OVERLAY_THEME,
    };
    layer().draw(frame);
    return context;
}

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    editorStore.getState().setTool(DEFAULT_TOOL);
    editorStore.setState({ toolOptions: {} });
});

describe("the brush cursor layer", () => {
    it("is drawn over the grids of SE-013", () => {
        expect(layer().order).toBe(BRUSH_CURSOR_ORDER);
        const below = overlayLayers.filter((entry) =>
            ["document-outline", "pixel-grid", "tile-grid"].includes(entry.id),
        );
        expect(below).toHaveLength(3);
        for (const entry of below) expect(entry.order).toBeLessThan(BRUSH_CURSOR_ORDER);
    });

    for (const scale of [1, 3, 8]) {
        for (const shape of ["square", "circle"] as BrushShape[]) {
            for (const size of [1, 2, 3, 8]) {
                it(`outlines the footprint of a ${shape} brush of ${size} at ${scale}×`, () => {
                    const tool = toolState.active();
                    expect(tool && hasBrush(tool)).toBe(true);
                    toolState.setOption(tool!, BRUSH_SIZE.key, size);
                    toolState.setOption(tool!, BRUSH_SHAPE.key, shape);
                    const view = { scale, originX: 13, originY: 7 };
                    const pixel = { x: 7, y: 5 };
                    const context = drawAt(view, pixel);
                    // The footprint in device pixels, from the brush's own mask.
                    const brush = createBrush(shape, size);
                    const footprint = Array.from({ length: SIZE.height }, (_, dy) =>
                        Array.from({ length: SIZE.width }, (_, dx) =>
                            brushCovers(
                                brush,
                                Math.floor((dx - view.originX) / scale) - pixel.x - brush.origin,
                                Math.floor((dy - view.originY) / scale) - pixel.y - brush.origin,
                            ),
                        ),
                    );
                    const covered = (x: number, y: number) => footprint[y]?.[x] === true;
                    /** Chebyshev distance from a device pixel to the footprint, up to 3. */
                    const distance = (x: number, y: number) => {
                        for (let d = 0; d <= 2; d++) {
                            for (let dy = -d; dy <= d; dy++) {
                                for (let dx = -d; dx <= d; dx++) {
                                    if (covered(x + dx, y + dy)) return d;
                                }
                            }
                        }
                        return 3;
                    };
                    for (let y = 0; y < SIZE.height; y++) {
                        for (let x = 0; x < SIZE.width; x++) {
                            const d = distance(x, y);
                            const expected = d === 1 ? "black" : d === 2 ? "white" : null;
                            expect(context.colourAt(x, y), `${x}, ${y}`).toBe(expected);
                        }
                    }
                });
            }
        }
    }

    it("draws nothing for a tool without a brush, or with the pointer off the viewport", () => {
        editorStore.getState().setTool("hand");
        expect(toolState.active()?.id).toBe("hand");
        const context = drawAt({ scale: 8, originX: 0, originY: 0 }, { x: 3, y: 3 });
        expect(context.colourAt(3 * 8 - 1, 3 * 8)).toBeNull();
        editorStore.getState().setTool(DEFAULT_TOOL);
        const document = open({ scale: 8, originX: 0, originY: 0 });
        const empty = rasterContext();
        layer().draw({
            context: empty as unknown as CanvasRenderingContext2D,
            size: SIZE,
            document,
            mapping: createViewMapping({
                view: document.view,
                docWidth: 16,
                docHeight: 12,
                ratio: 1,
                left: 0,
                top: 0,
            }),
            cursor: null,
            theme: DEFAULT_OVERLAY_THEME,
        });
        expect(empty.colourAt(0, 0)).toBeNull();
    });

    it("asks for a redraw when the active tool or its brush changes", () => {
        let redraws = 0;
        const stop = layer().watch?.(() => redraws++);
        try {
            const tool = toolState.active()!;
            toolState.setOption(tool, BRUSH_SIZE.key, 5);
            expect(redraws).toBeGreaterThan(0);
            const before = redraws;
            editorStore.getState().setTool("eraser");
            expect(redraws).toBeGreaterThan(before);
        } finally {
            stop?.();
        }
    });

    it("places one rectangle per brush row on whole device pixels", () => {
        const mapping = createViewMapping({
            view: { scale: 4, originX: 10, originY: 20 },
            docWidth: 16,
            docHeight: 12,
            ratio: 1,
            left: 0,
            top: 0,
        });
        expect(footprintRects(createBrush("circle", 3), { x: 2, y: 1 }, mapping)).toEqual([
            { x: 18, y: 20, width: 4, height: 4 },
            { x: 14, y: 24, width: 12, height: 4 },
            { x: 18, y: 28, width: 4, height: 4 },
        ]);
    });
});
