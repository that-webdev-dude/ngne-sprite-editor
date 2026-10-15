import { describe, expect, it } from "vitest";
import { addFrameCommand, deleteFramesCommand } from "../../src/core/frames";
import { History } from "../../src/core/history";
import { addLayerCommand, deleteLayerCommand } from "../../src/core/layers";
import { assertInvariants, createDocument, sequentialIds } from "../../src/core/model";
import type { BitMask, DocSession, Selection } from "../../src/core/model";
import { createBrush } from "../../src/core/raster";
import {
    combineSelection,
    createMask,
    deselectCommand,
    ellipseMask,
    ellipseRows,
    fullMask,
    intersectMask,
    invertMask,
    invertSelection,
    invertSelectionCommand,
    maskBounds,
    maskHas,
    masksEqual,
    polygonMask,
    rectMask,
    selectAll,
    selectAllCommand,
    selectCommand,
    selectionBoundary,
    selectionOf,
    setSelectionCommand,
    subtractMask,
    unionMask,
} from "../../src/core/selection";
import { maskOf, randomMask, rowsOf, seeded } from "./se-030-support";

// SE-030: the selection model of SPEC §5.2 and §7.2 — 1-bit masks with bounds, the boolean
// operations against hand-built masks, the masks of the selection shapes, the boundary as edge
// segments, and the selection commands: undoable, exact on undo, untouched by frame and layer
// switches.

const A = maskOf([
    "......", //
    ".###..",
    ".###..",
    ".###..",
    "......",
]);
const B = maskOf([
    "......", //
    "......",
    "..####",
    "..####",
    "..####",
]);

function selection(mask: BitMask): Selection {
    const made = selectionOf(mask);
    if (!made) throw new Error("empty mask");
    return made;
}

describe("masks", () => {
    it("a new mask is empty, with the documented byte count and no bounds", () => {
        const mask = createMask(5, 3);
        expect(mask.data.length).toBe(2);
        expect(Array.from(mask.data)).toEqual([0, 0]);
        expect(maskBounds(mask)).toBeNull();
        expect(selectionOf(mask)).toBeNull();
        expect(() => createMask(0, 3)).toThrow(RangeError);
        expect(() => createMask(2.5, 3)).toThrow(RangeError);
    });

    it("reads its pixels in the layout of BitMask, and nothing outside", () => {
        const mask = maskOf(["#..", "..#"]);
        // Pixel (x, y) is bit y × width + x: bits 0 and 5.
        expect(Array.from(mask.data)).toEqual([0b100001]);
        expect(maskHas(mask, 0, 0)).toBe(true);
        expect(maskHas(mask, 2, 1)).toBe(true);
        expect(maskHas(mask, 1, 0)).toBe(false);
        expect(maskHas(mask, -1, 0)).toBe(false);
        expect(maskHas(mask, 3, 1)).toBe(false);
        expect(maskHas(mask, 0, 2)).toBe(false);
    });

    it("bounds are the rectangle of the set pixels", () => {
        expect(maskBounds(A)).toEqual({ x: 1, y: 1, width: 3, height: 3 });
        expect(maskBounds(B)).toEqual({ x: 2, y: 2, width: 4, height: 3 });
        expect(maskBounds(maskOf(["....", "...#", "#...", "...."]))).toEqual({
            x: 0,
            y: 1,
            width: 4,
            height: 2,
        });
        // Across byte boundaries and in the last, partly used byte.
        const wide = createMask(21, 3);
        wide.data[(2 * 21 + 20) >> 3] |= 1 << ((2 * 21 + 20) & 7);
        expect(maskBounds(wide)).toEqual({ x: 20, y: 2, width: 1, height: 1 });
    });

    it("equal masks compare equal; a different pixel or size does not", () => {
        expect(masksEqual(A, maskOf(rowsOf(A)))).toBe(true);
        expect(masksEqual(A, B)).toBe(false);
        expect(masksEqual(createMask(4, 2), createMask(2, 4))).toBe(false);
    });
});

describe("boolean operations against hand-built masks", () => {
    it("add is the union, with its bounds", () => {
        const result = combineSelection(selection(A), B, "add");
        expect(rowsOf(result!.mask)).toEqual([
            "......", //
            ".###..",
            ".#####",
            ".#####",
            "..####",
        ]);
        expect(result!.bounds).toEqual({ x: 1, y: 1, width: 5, height: 4 });
        expect(rowsOf(unionMask(A, B))).toEqual(rowsOf(result!.mask));
    });

    it("subtract keeps what the selection has outside the shape, with its bounds", () => {
        const result = combineSelection(selection(A), B, "subtract");
        expect(rowsOf(result!.mask)).toEqual([
            "......", //
            ".###..",
            ".#....",
            ".#....",
            "......",
        ]);
        expect(result!.bounds).toEqual({ x: 1, y: 1, width: 3, height: 3 });
        const other = combineSelection(selection(B), A, "subtract");
        expect(rowsOf(other!.mask)).toEqual([
            "......", //
            "......",
            "....##",
            "....##",
            "..####",
        ]);
        expect(other!.bounds).toEqual({ x: 2, y: 2, width: 4, height: 3 });
        expect(rowsOf(subtractMask(A, B))).toEqual(rowsOf(result!.mask));
    });

    it("intersect keeps what both select, with its bounds", () => {
        const result = combineSelection(selection(A), B, "intersect");
        expect(rowsOf(result!.mask)).toEqual([
            "......", //
            "......",
            "..##..",
            "..##..",
            "......",
        ]);
        expect(result!.bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
        expect(rowsOf(intersectMask(A, B))).toEqual(rowsOf(result!.mask));
    });

    it("replace (set) is the shape alone, in memory of its own", () => {
        const result = combineSelection(selection(A), B, "replace");
        expect(rowsOf(result!.mask)).toEqual(rowsOf(B));
        expect(result!.bounds).toEqual({ x: 2, y: 2, width: 4, height: 3 });
        expect(result!.mask.data).not.toBe(B.data);
    });

    it("without a selection, add is the shape and subtract and intersect select nothing", () => {
        expect(rowsOf(combineSelection(null, A, "add")!.mask)).toEqual(rowsOf(A));
        expect(combineSelection(null, A, "subtract")).toBeNull();
        expect(combineSelection(null, A, "intersect")).toBeNull();
    });

    it("a result with no pixel is no selection (null), not an empty mask", () => {
        const disjoint = maskOf(["#.....", "......", "......", "......", "......"]);
        expect(combineSelection(selection(A), disjoint, "intersect")).toBeNull();
        expect(combineSelection(selection(A), A, "subtract")).toBeNull();
        expect(combineSelection(selection(A), createMask(6, 5), "replace")).toBeNull();
    });

    it("invert selects the rest, keeps the unused bits 0, and all and none are its ends", () => {
        const inverted = invertSelection(selection(A), 6, 5);
        expect(rowsOf(inverted!.mask)).toEqual([
            "######", //
            "#...##",
            "#...##",
            "#...##",
            "######",
        ]);
        expect(inverted!.bounds).toEqual({ x: 0, y: 0, width: 6, height: 5 });
        // 5 × 3 = 15 bits: the 16th bit of the last byte stays 0.
        const odd = invertMask(createMask(5, 3));
        expect(Array.from(odd.data)).toEqual([0xff, 0x7f]);
        expect(masksEqual(fullMask(5, 3), odd)).toBe(true);

        const all = selectAll(6, 5);
        expect(rowsOf(all.mask)).toEqual(["######", "######", "######", "######", "######"]);
        expect(all.bounds).toEqual({ x: 0, y: 0, width: 6, height: 5 });
        expect(maskBounds(all.mask)).toEqual(all.bounds);
        // Inverting everything leaves nothing; inverting nothing selects everything (Aseprite).
        expect(invertSelection(all, 6, 5)).toBeNull();
        expect(rowsOf(invertSelection(null, 6, 5)!.mask)).toEqual(rowsOf(all.mask));
        // Twice is the identity.
        expect(rowsOf(invertSelection(inverted, 6, 5)!.mask)).toEqual(rowsOf(A));
    });

    it("changes neither operand", () => {
        const a = maskOf(rowsOf(A));
        const b = maskOf(rowsOf(B));
        const current = selection(a);
        for (const mode of ["replace", "add", "subtract", "intersect"] as const) {
            combineSelection(current, b, mode);
        }
        invertSelection(current, 6, 5);
        expect(rowsOf(a)).toEqual(rowsOf(A));
        expect(rowsOf(b)).toEqual(rowsOf(B));
        expect(current.bounds).toEqual({ x: 1, y: 1, width: 3, height: 3 });
    });

    it("bounds always equal those of the mask, for random masks and every mode", () => {
        const random = seeded(30);
        for (let round = 0; round < 40; round++) {
            const width = 1 + Math.floor(random() * 19);
            const height = 1 + Math.floor(random() * 11);
            const current = selectionOf(randomMask(width, height, random() * 0.6, random));
            const shape = randomMask(width, height, random() * 0.6, random);
            for (const mode of ["replace", "add", "subtract", "intersect"] as const) {
                const result = combineSelection(current, shape, mode);
                if (result) expect(result.bounds).toEqual(maskBounds(result.mask));
                else expect(result).toBeNull();
            }
            const inverted = invertSelection(current, width, height);
            if (inverted) expect(inverted.bounds).toEqual(maskBounds(inverted.mask));
        }
    });

    it("refuses masks of different sizes", () => {
        expect(() => unionMask(A, createMask(5, 5))).toThrow(RangeError);
        expect(() => combineSelection(selection(A), createMask(6, 6), "add")).toThrow(RangeError);
        expect(() => invertSelection(selection(A), 5, 5)).toThrow(RangeError);
    });
});

describe("masks of the selection shapes", () => {
    it("a rectangle, clipped to the canvas", () => {
        expect(rowsOf(rectMask(6, 4, { x: 1, y: 1, width: 3, height: 2 }))).toEqual([
            "......",
            ".###..",
            ".###..",
            "......",
        ]);
        expect(rowsOf(rectMask(4, 3, { x: -2, y: 1, width: 4, height: 9 }))).toEqual([
            "....",
            "##..",
            "##..",
        ]);
        expect(maskBounds(rectMask(4, 3, { x: 5, y: 0, width: 2, height: 2 }))).toBeNull();
        expect(() => rectMask(4, 3, { x: 0.5, y: 0, width: 1, height: 1 })).toThrow(RangeError);
    });

    it("an ellipse in a square is the circle brush of that size (SE-015)", () => {
        for (let size = 1; size <= 24; size++) {
            const brush = createBrush("circle", size);
            const rows = ellipseRows(size, size);
            expect(Array.from(rows.starts), `size ${size}`).toEqual(Array.from(brush.starts));
            expect(Array.from(rows.ends), `size ${size}`).toEqual(Array.from(brush.ends));
        }
    });

    it("an ellipse fills its rectangle symmetrically, one run per row, touching every side", () => {
        for (let w = 1; w <= 14; w++) {
            for (let h = 1; h <= 14; h++) {
                const { starts, ends } = ellipseRows(w, h);
                const label = `${w} × ${h}`;
                let left = w;
                let right = 0;
                for (let row = 0; row < h; row++) {
                    expect(starts[row], label).toBeLessThan(ends[row]);
                    expect(starts[row], label).toBeGreaterThanOrEqual(0);
                    expect(ends[row], label).toBeLessThanOrEqual(w);
                    // Mirrored left to right and top to bottom.
                    expect(starts[row], label).toBe(w - ends[row]);
                    expect(starts[row], label).toBe(starts[h - 1 - row]);
                    left = Math.min(left, starts[row]);
                    right = Math.max(right, ends[row]);
                }
                expect([left, right], label).toEqual([0, w]);
            }
        }
    });

    it("an ellipse mask is the rows at the rectangle's place, clipped to the canvas", () => {
        expect(rowsOf(ellipseMask(9, 5, { x: 1, y: 0, width: 7, height: 5 }))).toEqual([
            "...###...",
            "..#####..",
            ".#######.",
            "..#####..",
            "...###...",
        ]);
        // Its right half beyond the canvas.
        expect(rowsOf(ellipseMask(4, 5, { x: 1, y: 0, width: 7, height: 5 }))).toEqual([
            "...#",
            "..##",
            ".###",
            "..##",
            "...#",
        ]);
        expect(() => ellipseMask(4, 4, { x: 0, y: 0, width: 70000, height: 2 })).toThrow(
            RangeError,
        );
    });

    it("a polygon is its outline and the pixels whose centres lie inside", () => {
        const triangle = [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 0, y: 6 },
        ];
        expect(rowsOf(polygonMask(8, 8, triangle))).toEqual([
            "#######.",
            "######..",
            "#####...",
            "####....",
            "###.....",
            "##......",
            "#.......",
            "........",
        ]);
        // Concave: the even-odd rule leaves the notch between the legs out.
        const u = [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 6 },
            { x: 4, y: 6 },
            { x: 4, y: 2 },
            { x: 2, y: 2 },
            { x: 2, y: 6 },
            { x: 0, y: 6 },
        ];
        expect(rowsOf(polygonMask(8, 8, u))).toEqual([
            "#######.",
            "#######.",
            "#######.",
            "###.###.",
            "###.###.",
            "###.###.",
            "###.###.",
            "........",
        ]);
    });

    it("a polygon is clipped to the canvas; fewer than 3 points enclose nothing", () => {
        const square = [
            { x: -2, y: -2 },
            { x: 2, y: -2 },
            { x: 2, y: 2 },
            { x: -2, y: 2 },
        ];
        expect(rowsOf(polygonMask(4, 4, square))).toEqual(["###.", "###.", "###.", "...."]);
        expect(maskBounds(polygonMask(4, 4, square.slice(0, 2)))).toBeNull();
        expect(maskBounds(polygonMask(4, 4, []))).toBeNull();
        expect(() =>
            polygonMask(4, 4, [
                { x: 0.5, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
            ]),
        ).toThrow(RangeError);
    });

    it("a flood mask, or any mask of the canvas, becomes a selection with its bounds", () => {
        const flood = maskOf(["..#..", ".###.", "..#.."]);
        const made = selectionOf(flood);
        expect(made).toEqual({ mask: flood, bounds: { x: 1, y: 0, width: 3, height: 3 } });
    });
});

describe("boundary segments", () => {
    it("of an L-shape: five outer corners, one inner corner, maximal runs", () => {
        const boundary = selectionBoundary(
            maskOf([
                ".....", //
                ".#...",
                ".#...",
                ".###.",
                ".....",
            ]),
        );
        expect(boundary.horizontal).toEqual([
            { y: 1, x0: 1, x1: 2, inside: "below" },
            { y: 3, x0: 2, x1: 4, inside: "below" },
            { y: 4, x0: 1, x1: 4, inside: "above" },
        ]);
        expect(boundary.vertical).toEqual([
            { x: 1, y0: 1, y1: 4, inside: "right" },
            { x: 2, y0: 1, y1: 3, inside: "left" },
            { x: 4, y0: 3, y1: 4, inside: "left" },
        ]);
        expect(boundary.corners).toEqual([
            { x: 1, y: 1, selected: "bottom-right" },
            { x: 2, y: 1, selected: "bottom-left" },
            { x: 4, y: 3, selected: "bottom-left" },
            { x: 1, y: 4, selected: "top-right" },
            { x: 4, y: 4, selected: "top-left" },
        ]);
    });

    it("of a mask with a hole: the outer ring and the hole's own four edges", () => {
        const boundary = selectionBoundary(
            maskOf([
                ".....", //
                ".###.",
                ".#.#.",
                ".###.",
                ".....",
            ]),
        );
        expect(boundary.horizontal).toEqual([
            { y: 1, x0: 1, x1: 4, inside: "below" },
            { y: 2, x0: 2, x1: 3, inside: "above" },
            { y: 3, x0: 2, x1: 3, inside: "below" },
            { y: 4, x0: 1, x1: 4, inside: "above" },
        ]);
        expect(boundary.vertical).toEqual([
            { x: 1, y0: 1, y1: 4, inside: "right" },
            { x: 2, y0: 2, y1: 3, inside: "left" },
            { x: 3, y0: 2, y1: 3, inside: "right" },
            { x: 4, y0: 1, y1: 4, inside: "left" },
        ]);
        // The hole's corners have three selected pixels around them: inner corners.
        expect(boundary.corners).toEqual([
            { x: 1, y: 1, selected: "bottom-right" },
            { x: 4, y: 1, selected: "bottom-left" },
            { x: 1, y: 4, selected: "top-right" },
            { x: 4, y: 4, selected: "top-left" },
        ]);
    });

    it("splits a run where the selected side changes hands, as at two pixels touching diagonally", () => {
        const boundary = selectionBoundary(maskOf(["#.", ".#"]));
        expect(boundary.horizontal).toEqual([
            { y: 0, x0: 0, x1: 1, inside: "below" },
            { y: 1, x0: 0, x1: 1, inside: "above" },
            { y: 1, x0: 1, x1: 2, inside: "below" },
            { y: 2, x0: 1, x1: 2, inside: "above" },
        ]);
        expect(boundary.vertical).toEqual([
            { x: 0, y0: 0, y1: 1, inside: "right" },
            { x: 1, y0: 0, y1: 1, inside: "left" },
            { x: 1, y0: 1, y1: 2, inside: "right" },
            { x: 2, y0: 1, y1: 2, inside: "left" },
        ]);
        // The shared point has two selected pixels: no outer corner there.
        expect(boundary.corners.map(({ x, y }) => `${x},${y}`)).toEqual([
            "0,0",
            "1,0",
            "0,1",
            "2,1",
            "1,2",
            "2,2",
        ]);
    });

    it("runs along the canvas edge, and is empty for an empty mask", () => {
        const boundary = selectionBoundary(maskOf(["##", "##"]));
        expect(boundary.horizontal).toEqual([
            { y: 0, x0: 0, x1: 2, inside: "below" },
            { y: 2, x0: 0, x1: 2, inside: "above" },
        ]);
        expect(boundary.vertical).toEqual([
            { x: 0, y0: 0, y1: 2, inside: "right" },
            { x: 2, y0: 0, y1: 2, inside: "left" },
        ]);
        expect(selectionBoundary(createMask(3, 3))).toEqual({
            horizontal: [],
            vertical: [],
            corners: [],
        });
    });

    it("has a unit edge exactly where a pixel and its neighbour differ, for random masks", () => {
        const random = seeded(7);
        for (let round = 0; round < 30; round++) {
            const width = 1 + Math.floor(random() * 15);
            const height = 1 + Math.floor(random() * 12);
            const mask = randomMask(width, height, random(), random);
            const { horizontal, vertical, corners } = selectionBoundary(mask);
            const edges = new Set<string>();
            for (const edge of horizontal) {
                for (let x = edge.x0; x < edge.x1; x++) {
                    edges.add(`h${x},${edge.y},${edge.inside === "above"}`);
                }
            }
            for (const edge of vertical) {
                for (let y = edge.y0; y < edge.y1; y++) {
                    edges.add(`v${edge.x},${y},${edge.inside === "left"}`);
                }
            }
            const expected = new Set<string>();
            for (let y = 0; y <= height; y++) {
                for (let x = 0; x < width; x++) {
                    const above = maskHas(mask, x, y - 1);
                    if (above !== maskHas(mask, x, y)) expected.add(`h${x},${y},${above}`);
                }
            }
            for (let x = 0; x <= width; x++) {
                for (let y = 0; y < height; y++) {
                    const left = maskHas(mask, x - 1, y);
                    if (left !== maskHas(mask, x, y)) expected.add(`v${x},${y},${left}`);
                }
            }
            expect([...edges].sort()).toEqual([...expected].sort());
            for (const { x, y } of corners) {
                const around = [
                    maskHas(mask, x - 1, y - 1),
                    maskHas(mask, x, y - 1),
                    maskHas(mask, x - 1, y),
                    maskHas(mask, x, y),
                ];
                expect(around.filter(Boolean)).toHaveLength(1);
            }
        }
    });
});

describe("selection commands", () => {
    function session(): DocSession {
        return createDocument({ name: "sel", width: 6, height: 5 }, sequentialIds("sel-"));
    }

    it("a selection change is one undoable step; undo restores the previous mask exactly", () => {
        const doc = session();
        const history = new History(doc);
        history.execute(selectCommand(doc, A, "replace", "Select")!);
        const first = doc.selection!;
        const firstBytes = Array.from(first.mask.data);
        history.execute(selectCommand(doc, B, "add", "Select")!);
        expect(rowsOf(doc.selection!.mask)).toEqual(rowsOf(unionMask(A, B)));
        expect(history.undoLabel).toBe("Select");

        expect(history.undo()).toBe(true);
        // The very selection that was there, its bytes and bounds unchanged.
        expect(doc.selection).toBe(first);
        expect(Array.from(doc.selection!.mask.data)).toEqual(firstBytes);
        expect(doc.selection!.bounds).toEqual({ x: 1, y: 1, width: 3, height: 3 });
        expect(history.redo()).toBe(true);
        expect(rowsOf(doc.selection!.mask)).toEqual(rowsOf(unionMask(A, B)));
        history.undo();
        history.undo();
        expect(doc.selection).toBeNull();
        assertInvariants(doc);
    });

    it("Select All, Deselect and Invert Selection, each undone exactly", () => {
        const doc = session();
        const history = new History(doc);
        // Invert with no selection selects everything.
        history.execute(invertSelectionCommand(doc)!);
        expect(history.undoLabel).toBe("Invert Selection");
        expect(doc.selection!.bounds).toEqual({ x: 0, y: 0, width: 6, height: 5 });
        history.undo();
        expect(doc.selection).toBeNull();

        history.execute(selectCommand(doc, A, "replace", "Select")!);
        const before = doc.selection;
        history.execute(invertSelectionCommand(doc)!);
        expect(rowsOf(doc.selection!.mask)).toEqual(rowsOf(invertMask(A)));
        history.undo();
        expect(doc.selection).toBe(before);

        history.execute(selectAllCommand(doc)!);
        expect(history.undoLabel).toBe("Select All");
        expect(rowsOf(doc.selection!.mask)).toEqual(rowsOf(fullMask(6, 5)));
        history.execute(deselectCommand(doc)!);
        expect(history.undoLabel).toBe("Deselect");
        expect(doc.selection).toBeNull();
        history.undo();
        expect(rowsOf(doc.selection!.mask)).toEqual(rowsOf(fullMask(6, 5)));
        history.undo();
        expect(doc.selection).toBe(before);
    });

    it("a change that leaves the same pixels selected makes no command", () => {
        const doc = session();
        expect(deselectCommand(doc)).toBeNull();
        const history = new History(doc);
        history.execute(selectAllCommand(doc)!);
        expect(selectAllCommand(doc)).toBeNull();
        expect(selectCommand(doc, fullMask(6, 5), "replace", "Select")).toBeNull();
        expect(selectCommand(doc, A, "add", "Select")).toBeNull();
        expect(setSelectionCommand(doc, selectAll(6, 5), "Select")).toBeNull();
    });

    it("touches no composite, retains its masks, and refuses a mask of another size", () => {
        const doc = session();
        const command = selectAllCommand(doc)!;
        expect(command.touched).toEqual({ frameIds: [], layerIds: [], structure: false });
        expect(command.bytes).toBe(4);
        expect(() => setSelectionCommand(doc, selectAll(5, 5), "Select")).toThrow(RangeError);
    });

    it("switching the active frame or layer keeps the mask unchanged", () => {
        const doc = session();
        const history = new History(doc);
        history.execute(selectCommand(doc, A, "replace", "Select")!);
        const kept = doc.selection;
        const bytes = Array.from(kept!.mask.data);
        const unchanged = () => {
            expect(doc.selection).toBe(kept);
            expect(Array.from(doc.selection!.mask.data)).toEqual(bytes);
            expect(doc.selection!.bounds).toEqual({ x: 1, y: 1, width: 3, height: 3 });
        };
        const firstFrame = doc.activeFrameId;
        const firstLayer = doc.activeLayerId;

        // Commands that make another frame or layer the active one.
        history.execute(addFrameCommand(doc.doc, firstFrame, sequentialIds("frame-")));
        expect(doc.activeFrameId).not.toBe(firstFrame);
        unchanged();
        history.execute(addLayerCommand(doc, { newId: sequentialIds("layer-") }));
        expect(doc.activeLayerId).not.toBe(firstLayer);
        unchanged();
        // A switch by session state, as the timeline makes it.
        doc.activeFrameId = firstFrame;
        doc.activeLayerId = firstLayer;
        unchanged();
        // Deleting the active frame and layer moves the active ones.
        history.execute(deleteLayerCommand(doc, firstLayer));
        history.execute(deleteFramesCommand(doc.doc, [firstFrame]));
        unchanged();
        // And their undo.
        while (history.undoCount > 1) history.undo();
        unchanged();
        assertInvariants(doc);
    });
});
