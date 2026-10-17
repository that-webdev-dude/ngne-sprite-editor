import { describe, expect, it } from "vitest";
import { axesOf } from "../../src/app/overlay/gridLines";
import type { OverlayFrame } from "../../src/app/overlay/types";
import { antsRing, isDarkDash } from "../../src/app/selection/antsGeometry";
import { SELECTION_ANTS_ORDER } from "../../src/app/selection/selectionAnts.overlay";
import {
    cornersRect,
    createPendingStore,
    pendingBoundary,
    pendingBounds,
    shapeMask,
} from "../../src/app/selection/tools/pendingShape";
import type { PendingShape } from "../../src/app/selection/tools/pendingShape";
import {
    createSelectionPreviewLayer,
    PREVIEW_PHASE,
    SELECTION_PREVIEW_ORDER,
} from "../../src/app/selection/tools/selectionPreview.overlay";
import type { OpenDocument } from "../../src/app/state/sessions";
import { BRUSH_CURSOR_ORDER } from "../../src/app/tools/brush/brushCursor.overlay";
import { createViewMapping } from "../../src/app/view/coordinates";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { BitMask } from "../../src/core/model";
import { createMask, selectionBoundary, setMaskPixel } from "../../src/core/selection";
import type { SelectionBoundary } from "../../src/core/selection";
import { maskOf, rowsOf, seeded } from "./se-030-support";
import { fakeOverlay, surfaceMaker } from "./se-031-support";
import type { CallLog } from "./se-031-support";

// SE-031: the live preview of a selection gesture (DESIGN §6). The pending shape's boundary is
// worked out over the shape's bounds only, and must be the boundary of the very pixels the
// gesture would select (`shapeMask`), checked here against the boundary of the whole mask; a
// path of fewer than 3 points shows its line. The draw layer is the ants' painter at phase 0,
// for the active document's gesture only: the ring as the ants' geometry places it, in the same
// few draw calls whatever the shape.

const W = 16;
const H = 12;

/** The boundary as plain data, to compare. */
function plain(boundary: SelectionBoundary) {
    return JSON.parse(JSON.stringify(boundary)) as unknown;
}

describe("the pending shape's boundary", () => {
    it("is the boundary of the mask the gesture selects, for shapes on and across the canvas's edge", () => {
        const random = seeded(31);
        const int = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
        for (let run = 0; run < 300; run++) {
            const a = { x: int(-6, W + 5), y: int(-6, H + 5) };
            const b = { x: int(-6, W + 5), y: int(-6, H + 5) };
            const points = Array.from({ length: int(3, 7) }, () => ({
                x: int(-4, W + 3),
                y: int(-4, H + 3),
            }));
            const shapes: PendingShape[] = [
                { kind: "rectangle", rect: cornersRect(a, b) },
                { kind: "ellipse", rect: cornersRect(a, b) },
                { kind: "polygon", points },
            ];
            for (const shape of shapes) {
                expect(plain(pendingBoundary(shape, W, H)), `${JSON.stringify(shape)}`).toEqual(
                    plain(selectionBoundary(shapeMask(shape, W, H))),
                );
            }
        }
    });

    it("of a mask is the mask's own", () => {
        const mask = maskOf(["#..#", ".##.", "#..#"]);
        expect(pendingBoundary({ kind: "mask", mask }, 4, 3)).toEqual(selectionBoundary(mask));
    });

    it("of a path of 1 or 2 points is its pixel or its line, which select nothing", () => {
        const line: PendingShape = {
            kind: "polygon",
            points: [
                { x: 1, y: 1 },
                { x: 6, y: 3 },
            ],
        };
        const expected = createMask(W, H);
        for (const [x, y] of [
            [1, 1],
            [2, 1],
            [3, 2],
            [4, 2],
            [5, 3],
            [6, 3],
        ] as const) {
            setMaskPixel(expected, x, y);
        }
        expect(plain(pendingBoundary(line, W, H))).toEqual(plain(selectionBoundary(expected)));
        expect(rowsOf(shapeMask(line, W, H)).join("")).not.toContain("#");
        const dot: PendingShape = { kind: "polygon", points: [{ x: 4, y: 5 }] };
        const one = createMask(W, H);
        setMaskPixel(one, 4, 5);
        expect(plain(pendingBoundary(dot, W, H))).toEqual(plain(selectionBoundary(one)));
        expect(pendingBoundary({ kind: "polygon", points: [] }, W, H)).toEqual({
            horizontal: [],
            vertical: [],
            corners: [],
        });
    });

    it("looks at the shape's bounds only: a canvas too large to allocate is no matter", () => {
        // 2^20 × 2^20 pixels: a mask of the whole canvas cannot be made.
        const side = 2 ** 20;
        const ellipse: PendingShape = {
            kind: "ellipse",
            rect: { x: 4000, y: 3000, width: 5, height: 3 },
        };
        expect(() => shapeMask(ellipse, side, side)).toThrow(RangeError);
        // The same ellipse on a canvas of its own size.
        const local = shapeMask({ ...ellipse, rect: { ...ellipse.rect, x: 0, y: 0 } }, 5, 3);
        const shifted = (boundary: SelectionBoundary) =>
            plain({
                horizontal: boundary.horizontal.map((edge) => ({
                    ...edge,
                    y: edge.y - 3000,
                    x0: edge.x0 - 4000,
                    x1: edge.x1 - 4000,
                })),
                vertical: boundary.vertical.map((edge) => ({
                    ...edge,
                    x: edge.x - 4000,
                    y0: edge.y0 - 3000,
                    y1: edge.y1 - 3000,
                })),
                corners: boundary.corners.map((corner) => ({
                    ...corner,
                    x: corner.x - 4000,
                    y: corner.y - 3000,
                })),
            });
        expect(rowsOf(local).join("")).toContain("#");
        expect(shifted(pendingBoundary(ellipse, side, side))).toEqual(
            plain(selectionBoundary(local)),
        );
        for (const shape of [
            { kind: "rectangle", rect: { x: side - 3, y: 9, width: 10, height: 2 } },
            {
                kind: "polygon",
                points: [
                    { x: 70_000, y: 70_000 },
                    { x: 70_006, y: 70_000 },
                    { x: 70_000, y: 70_004 },
                ],
            },
        ] as PendingShape[]) {
            expect(() => pendingBoundary(shape, side, side)).not.toThrow();
            expect(pendingBoundary(shape, side, side).horizontal.length).toBeGreaterThan(0);
        }
    });

    it("lies in the shape's bounds on the canvas (`pendingBounds`)", () => {
        expect(
            pendingBounds({ kind: "rectangle", rect: { x: -3, y: 2, width: 6, height: 20 } }, W, H),
        ).toEqual({ x: 0, y: 2, width: 3, height: H - 2 });
        expect(
            pendingBounds({ kind: "ellipse", rect: { x: 30, y: 2, width: 6, height: 2 } }, W, H),
        ).toBeNull();
        expect(
            pendingBounds(
                {
                    kind: "polygon",
                    points: [
                        { x: 3, y: 4 },
                        { x: 9, y: -2 },
                    ],
                },
                W,
                H,
            ),
        ).toEqual({ x: 3, y: 0, width: 7, height: 5 });
        expect(pendingBounds({ kind: "polygon", points: [] }, W, H)).toBeNull();
        expect(
            pendingBounds({ kind: "mask", mask: maskOf(["....", ".#..", "..#."]) }, 4, 3),
        ).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    });
});

describe("the preview layer", () => {
    function setUp(
        doc: { width: number; height: number },
        view = { scale: 4, originX: 10, originY: 6 },
    ) {
        const log: CallLog = [];
        const surfaces = surfaceMaker(log);
        const store = createPendingStore();
        const layer = createSelectionPreviewLayer(store, surfaces.make);
        const redraws: number[] = [];
        const stop = layer.watch!(() => redraws.push(redraws.length));
        const session = createDocument({ name: "p", ...doc }, sequentialIds("p-"));
        const mapping = createViewMapping({
            view,
            docWidth: doc.width,
            docHeight: doc.height,
            ratio: 1,
            left: 0,
            top: 0,
        });
        const draw = (size: { width: number; height: number }, of = session) => {
            const overlay = fakeOverlay(size, log);
            const from = log.length;
            layer.draw({
                context: overlay.context,
                size,
                document: { session: of, view } as unknown as OpenDocument,
                mapping,
                cursor: null,
                theme: { outline: 0, ink: 0 },
            } satisfies OverlayFrame);
            return { pixels: overlay.pixels, calls: log.slice(from) };
        };
        return { store, layer, redraws, stop, session, mapping, draw };
    }

    it("lies over the ants and under the brush cursor", () => {
        expect(SELECTION_PREVIEW_ORDER).toBeGreaterThan(SELECTION_ANTS_ORDER);
        expect(SELECTION_PREVIEW_ORDER).toBeLessThan(BRUSH_CURSOR_ORDER);
    });

    it("draws the ring of the active document's pending shape at phase 0, and nothing else", () => {
        const doc = { width: W, height: H };
        const t = setUp(doc);
        const size = { width: 120, height: 90 };
        expect(t.draw(size).calls).toEqual([]);
        const mask: BitMask = maskOf([
            "................",
            "..####..........",
            "..#..#..........",
            "..####......##..",
            ...Array.from({ length: 8 }, () => "................"),
        ]);
        t.store.set(t.session, { kind: "mask", mask });
        expect(t.redraws).toHaveLength(1);
        const { pixels } = t.draw(size);
        const expected = new Uint8ClampedArray(size.width * size.height * 4);
        for (const run of antsRing(
            selectionBoundary(mask),
            axesOf(t.mapping.rect, doc, size),
            size,
        )) {
            for (let y = run.y; y < run.y + run.height; y++) {
                for (let x = run.x; x < run.x + run.width; x++) {
                    const value = isDarkDash(x, y, PREVIEW_PHASE) ? 0 : 255;
                    expected.set([value, value, value, 255], (y * size.width + x) * 4);
                }
            }
        }
        expect(Array.from(pixels).join() === Array.from(expected).join()).toBe(true);

        // Another document's gesture is not drawn here; none after it ends.
        const other = createDocument({ name: "q", ...doc }, sequentialIds("q-"));
        t.store.set(other, { kind: "mask", mask });
        expect(t.draw(size).calls).toEqual([]);
        t.store.clear();
        expect(t.draw(size).calls).toEqual([]);
        expect(t.redraws).toHaveLength(3);
        t.stop();
        t.store.set(t.session, { kind: "mask", mask });
        expect(t.redraws).toHaveLength(3);
    });

    it("redraws in the same few draw calls for a rectangle and a 256² checkerboard pick", () => {
        const doc = { width: 256, height: 256 };
        const size = { width: 300, height: 290 };
        const calls = (shape: PendingShape) => {
            const t = setUp(doc, { scale: 1, originX: 10, originY: 10 });
            t.store.set(t.session, shape);
            const build = t.draw(size).calls;
            const same = t.draw(size).calls;
            t.stop();
            return { build, same };
        };
        const rows: string[] = [];
        for (let y = 0; y < 256; y++) {
            let row = "";
            for (let x = 0; x < 256; x++) row += (x + y) % 2 === 0 ? "#" : ".";
            rows.push(row);
        }
        const rectangle = calls({
            kind: "rectangle",
            rect: { x: 20, y: 30, width: 100, height: 60 },
        });
        const board = calls({ kind: "mask", mask: maskOf(rows) });
        expect(board).toEqual(rectangle);
        // A redraw of the same shape and view is one drawImage.
        expect(rectangle.same).toEqual(["drawImage"]);
        expect(rectangle.build.length).toBeLessThanOrEqual(12);
    });
});
