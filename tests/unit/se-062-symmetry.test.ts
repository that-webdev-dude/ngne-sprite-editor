import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import type { PixelBuffer } from "../../src/core/model";
import { clonePixelBuffer, createPixelBuffer } from "../../src/core/pixels";
import {
    ContourStroke,
    createBrush,
    floodMask,
    forEachSymmetricRun,
    FreehandStroke,
    paintInk,
    pixelPerfectPath,
    ShapeStroke,
    SprayStroke,
    StraightStroke,
    strokeSymmetry,
    symmetricFloodMask,
    symmetricPoints,
    symmetricRows,
} from "../../src/core/raster";
import type { Brush, BrushShape, PixelPoint, StrokeSymmetry } from "../../src/core/raster";
import { FRAME, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";

// SE-062: symmetry and tiled wrap in `core/raster`. Every pixel `Stamper` writes or puts back
// and every run `ShapeStroke` marks is mirrored about the axes (half-pixel units: the mirror of
// x is axisX - 1 - x) and wrapped around the canvas's edges in tiled mode; the bucket floods
// from every mirrored seed of the unpainted source and paints the union. The composite is
// never affected by either setting.

const BLACK = 0x000000ff;
const p = (x: number, y: number): PixelPoint => ({ x, y });
const NO_SYMMETRY: StrokeSymmetry = {
    mirrorX: false,
    mirrorY: false,
    axisX: 0,
    axisY: 0,
    wrapX: false,
    wrapY: false,
};
const sym = (fields: Partial<StrokeSymmetry>): StrokeSymmetry => ({ ...NO_SYMMETRY, ...fields });

function canvas(width: number, height: number, colour = 0): [PixelBuffer, PixelBuffer] {
    const image = createPixelBuffer(width, height, colour);
    return [image, clonePixelBuffer(image)];
}

/** The pixels of `image` that are opaque black: what a black stroke painted, sorted. */
function painted(image: PixelBuffer): string[] {
    const result: string[] = [];
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const at = (y * image.width + x) * 4;
            const [r, g, b, a] = image.data.subarray(at, at + 4);
            if (r === 0 && g === 0 && b === 0 && a === 255) result.push(`${x},${y}`);
        }
    }
    return result.sort();
}

function rgba(image: PixelBuffer, x: number, y: number): number[] {
    const at = (y * image.width + x) * 4;
    return Array.from(image.data.subarray(at, at + 4));
}

/** Whether `image` equals its mirror image left to right about its vertical centre line. */
function mirroredLeftRight(image: PixelBuffer): boolean {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const a = rgba(image, x, y);
            const b = rgba(image, image.width - 1 - x, y);
            if (a.some((value, index) => value !== b[index])) return false;
        }
    }
    return true;
}

function mirroredTopBottom(image: PixelBuffer): boolean {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const a = rgba(image, x, y);
            const b = rgba(image, x, image.height - 1 - y);
            if (a.some((value, index) => value !== b[index])) return false;
        }
    }
    return true;
}

/** The runs `forEachSymmetricRun` visits, as `y:from-to`. */
function runs(
    symmetry: StrokeSymmetry | null,
    width: number,
    height: number,
    y: number,
    from: number,
    to: number,
): string[] {
    const visited: string[] = [];
    forEachSymmetricRun(symmetry, width, height, y, from, to, (row, start, end) =>
        visited.push(`${row}:${start}-${end}`),
    );
    return visited;
}

describe("strokeSymmetry", () => {
    const settings = (mode: "none" | "x" | "y" | "both", tiled: "none" | "x" | "y" | "both") => ({
        symmetry: { mode, axisX: 7, axisY: 9 },
        tiled,
    });

    it("is null when the settings mirror and wrap nothing", () => {
        expect(strokeSymmetry(settings("none", "none"))).toBeNull();
    });

    it("maps each mode and tiled mode to its axes", () => {
        expect(strokeSymmetry(settings("x", "none"))).toEqual(
            sym({ mirrorX: true, axisX: 7, axisY: 9 }),
        );
        expect(strokeSymmetry(settings("y", "none"))).toEqual(
            sym({ mirrorY: true, axisX: 7, axisY: 9 }),
        );
        expect(strokeSymmetry(settings("both", "x"))).toEqual(
            sym({ mirrorX: true, mirrorY: true, wrapX: true, axisX: 7, axisY: 9 }),
        );
        expect(strokeSymmetry(settings("none", "both"))).toEqual(
            sym({ wrapX: true, wrapY: true, axisX: 7, axisY: 9 }),
        );
        expect(strokeSymmetry(settings("none", "y"))).toEqual(
            sym({ wrapY: true, axisX: 7, axisY: 9 }),
        );
    });
});

describe("forEachSymmetricRun", () => {
    it("without symmetry clips the run to the canvas", () => {
        expect(runs(null, 8, 4, 1, -3, 2)).toEqual(["1:0-2"]);
        expect(runs(null, 8, 4, 1, 6, 12)).toEqual(["1:6-8"]);
        expect(runs(null, 8, 4, 4, 0, 2)).toEqual([]);
        expect(runs(null, 8, 4, 1, 9, 12)).toEqual([]);
    });

    it("mirrors a run about a vertical axis on a pixel boundary", () => {
        // Axis at x = 4 (8 half pixels): pixel x mirrors to 7 - x.
        expect(runs(sym({ mirrorX: true, axisX: 8 }), 8, 4, 1, 1, 3)).toEqual(["1:1-3", "1:5-7"]);
    });

    it("visits a run that is its own mirror image once: the column an axis runs through", () => {
        // Axis through the middle of column 2 of a 5-wide canvas (5 half pixels).
        expect(runs(sym({ mirrorX: true, axisX: 5 }), 5, 3, 0, 2, 3)).toEqual(["0:2-3"]);
        expect(runs(sym({ mirrorX: true, axisX: 5 }), 5, 3, 0, 1, 4)).toEqual(["0:1-4"]);
    });

    it("mirrors rows about a horizontal axis, and both ways at once", () => {
        expect(runs(sym({ mirrorY: true, axisY: 8 }), 6, 8, 1, 0, 2)).toEqual(["1:0-2", "6:0-2"]);
        expect(
            runs(sym({ mirrorX: true, mirrorY: true, axisX: 6, axisY: 8 }), 6, 8, 1, 0, 2),
        ).toEqual(["1:0-2", "1:4-6", "6:0-2", "6:4-6"]);
        // The row an odd axis runs through is its own mirror image.
        expect(runs(sym({ mirrorY: true, axisY: 7 }), 6, 7, 3, 0, 2)).toEqual(["3:0-2"]);
    });

    it("clips mirror images that leave the canvas, and keeps those an off-centre axis brings in", () => {
        // Axis at x = 1: pixels 5..6 mirror to -4..-5, off the canvas.
        expect(runs(sym({ mirrorX: true, axisX: 2 }), 8, 4, 0, 5, 7)).toEqual(["0:5-7"]);
        // A run left of the canvas mirrors onto it: pixels -4..-3 to 5..4.
        expect(runs(sym({ mirrorX: true, axisX: 2 }), 8, 4, 0, -4, -2)).toEqual(["0:4-6"]);
    });

    it("wraps a run around the edges in tiled mode, splitting it where it crosses one", () => {
        const tiled = sym({ wrapX: true, wrapY: true });
        expect(runs(tiled, 8, 4, 1, 6, 10)).toEqual(["1:6-8", "1:0-2"]);
        expect(runs(tiled, 8, 4, 1, -2, 1)).toEqual(["1:6-8", "1:0-1"]);
        expect(runs(tiled, 8, 4, -1, 9, 11)).toEqual(["3:1-3"]);
        expect(runs(tiled, 8, 4, 5, 0, 2)).toEqual(["1:0-2"]);
        // A run as long as the row or longer covers the row once.
        expect(runs(tiled, 8, 4, 0, -3, 9)).toEqual(["0:0-8"]);
        // Wrap on one axis only: the other clips.
        expect(runs(sym({ wrapX: true }), 8, 4, 4, 0, 2)).toEqual([]);
        expect(runs(sym({ wrapY: true }), 8, 4, 4, 6, 10)).toEqual(["0:6-8"]);
    });

    it("wraps mirror images too", () => {
        // Axis at x = 1 on an 8-wide canvas, tiled: pixel 5 mirrors to -4, which wraps to 4.
        expect(runs(sym({ mirrorX: true, axisX: 2, wrapX: true }), 8, 4, 0, 5, 6)).toEqual([
            "0:5-6",
            "0:4-5",
        ]);
    });
});

describe("symmetricRows", () => {
    it("names the rows whose pixels or mirror images reach the canvas", () => {
        expect(symmetricRows(null, 10)).toEqual({ first: 0, last: 9 });
        expect(symmetricRows(sym({ mirrorX: true, axisX: 3 }), 10)).toEqual({ first: 0, last: 9 });
        // Axis at y = 2: rows -6..-1 mirror to 9..4.
        expect(symmetricRows(sym({ mirrorY: true, axisY: 4 }), 10)).toEqual({ first: -6, last: 9 });
        // Axis at y = 8: rows 10..15 mirror to 5..0.
        expect(symmetricRows(sym({ mirrorY: true, axisY: 16 }), 10)).toEqual({
            first: 0,
            last: 15,
        });
        expect(symmetricRows(sym({ wrapY: true }), 10)).toEqual({
            first: undefined,
            last: undefined,
        });
    });
});

const brushes: fc.Arbitrary<Brush> = fc
    .record({
        size: fc.integer({ min: 1, max: 5 }),
        shape: fc.constantFrom<BrushShape>("square", "circle"),
    })
    .map(({ size, shape }) => createBrush(shape, size));

describe("freehand strokes with symmetry (Stamper)", () => {
    const WIDTH = 16;
    const HEIGHT = 12;
    const paths = fc.array(
        fc.record({ x: fc.integer({ min: -3, max: 18 }), y: fc.integer({ min: -3, max: 14 }) }),
        { minLength: 1, maxLength: 8 },
    );

    /** The painted pixels of a stroke along `path` with `options`, from a transparent canvas. */
    function strokeOf(
        path: readonly PixelPoint[],
        brush: Brush,
        pixelPerfect: boolean,
        symmetry: StrokeSymmetry | null,
        width = WIDTH,
        height = HEIGHT,
    ): PixelBuffer {
        const [image, original] = canvas(width, height);
        const stroke = new FreehandStroke(image, original, {
            brush,
            ink: paintInk("simple", BLACK, 255),
            pixelPerfect,
            symmetry,
        });
        const [first, ...rest] = path;
        stroke.start(first!);
        for (const point of rest) stroke.to(point);
        return image;
    }

    const mirrorKeys = (keys: readonly string[], width: number) =>
        keys.map((key) => {
            const [x, y] = key.split(",").map(Number);
            return `${width - 1 - x!},${y}`;
        });

    it("with horizontal symmetry on an even-width canvas, a stroke is a pixel-exact mirror", () => {
        fc.assert(
            fc.property(paths, brushes, fc.boolean(), (path, brush, pixelPerfect) => {
                const symmetry = sym({ mirrorX: true, axisX: WIDTH });
                const image = strokeOf(path, brush, pixelPerfect, symmetry);
                expect(mirroredLeftRight(image)).toBe(true);
                // Exactly the stroke and its mirror image: the pixel-perfect filter works on
                // the pointer's path before it is mirrored.
                const plain = painted(strokeOf(path, brush, pixelPerfect, null));
                const expected = [...new Set([...plain, ...mirrorKeys(plain, WIDTH)])].sort();
                expect(painted(image)).toEqual(expected);
            }),
        );
    });

    it("pixel-perfect takes back a corner and its mirror image", () => {
        const symmetry = sym({ mirrorX: true, axisX: WIDTH });
        const brush = createBrush("square", 1);
        const path = [p(2, 2), p(3, 2), p(3, 3)];
        const image = strokeOf(path, brush, true, symmetry);
        const filtered = pixelPerfectPath(path).map(({ x, y }) => `${x},${y}`);
        expect(filtered).not.toContain("3,2");
        expect(painted(image)).toEqual([...filtered, ...mirrorKeys(filtered, WIDTH)].sort());
    });

    it("with vertical symmetry and both, the stroke is mirrored top to bottom as well", () => {
        fc.assert(
            fc.property(paths, brushes, (path, brush) => {
                const image = strokeOf(
                    path,
                    brush,
                    false,
                    sym({ mirrorX: true, mirrorY: true, axisX: WIDTH, axisY: HEIGHT }),
                );
                expect(mirroredLeftRight(image)).toBe(true);
                expect(mirroredTopBottom(image)).toBe(true);
            }),
        );
    });

    it("an axis through the middle of a column on an odd-width canvas paints that column once", () => {
        // A translucent colour composited over an opaque background: inked twice it would
        // build up, inked once it is the blend of the colour over the background.
        const width = 9;
        const background = 0x2080c0ff;
        const ink = paintInk("alpha", 0xff000080, 200);
        const [once] = canvas(1, 1, background);
        ink.apply(once.data, clonePixelBuffer(once).data, 0);
        for (let size = 1; size <= 4; size++) {
            const [image, original] = canvas(width, 6, background);
            const stroke = new FreehandStroke(image, original, {
                brush: createBrush("square", size),
                ink,
                symmetry: sym({ mirrorX: true, axisX: width }),
            });
            stroke.start(p(4, 0));
            stroke.to(p(4, 5));
            for (let y = 0; y < 6; y++) expect(rgba(image, 4, y)).toEqual(rgba(once, 0, 0));
            expect(mirroredLeftRight(image)).toBe(true);
        }
    });

    it("reports one rectangle covering the stroke and its mirror image", () => {
        const [image, original] = canvas(WIDTH, HEIGHT);
        const stroke = new FreehandStroke(image, original, {
            brush: createBrush("square", 1),
            ink: paintInk("simple", BLACK, 255),
            symmetry: sym({ mirrorX: true, axisX: WIDTH }),
        });
        expect(stroke.start(p(2, 3))).toEqual({ x: 2, y: 3, width: 12, height: 1 });
    });

    it("in tiled mode a stroke crossing the right edge continues from the left edge", () => {
        const image = strokeOf(
            [p(WIDTH - 2, 5), p(WIDTH + 2, 5)],
            createBrush("square", 1),
            false,
            sym({ wrapX: true }),
        );
        expect(painted(image)).toEqual(
            [`${WIDTH - 2},5`, `${WIDTH - 1},5`, "0,5", "1,5", "2,5"].sort(),
        );
        const down = strokeOf(
            [p(3, HEIGHT - 1), p(3, HEIGHT + 1)],
            createBrush("square", 1),
            false,
            sym({ wrapY: true }),
        );
        expect(painted(down)).toEqual([`3,${HEIGHT - 1}`, "3,0", "3,1"].sort());
        // Without tiled mode the same stroke stops at the edge.
        expect(
            painted(
                strokeOf([p(WIDTH - 2, 5), p(WIDTH + 2, 5)], createBrush("square", 1), false, null),
            ),
        ).toEqual([`${WIDTH - 2},5`, `${WIDTH - 1},5`].sort());
    });

    it("a brush wider than the edge wraps its part beyond it", () => {
        const image = strokeOf(
            [p(0, 0)],
            createBrush("square", 3),
            false,
            sym({ wrapX: true, wrapY: true }),
        );
        // The 3×3 square around (0, 0) lands on rows H-1, 0, 1 and columns W-1, 0, 1.
        const expected: string[] = [];
        for (const y of [HEIGHT - 1, 0, 1])
            for (const x of [WIDTH - 1, 0, 1]) expected.push(`${x},${y}`);
        expect(painted(image)).toEqual(expected.sort());
    });
});

describe("straight strokes with symmetry", () => {
    it("take back the previous line with its mirror image at each move", () => {
        const [image, original] = canvas(10, 6);
        const stroke = new StraightStroke(
            image,
            original,
            {
                brush: createBrush("square", 1),
                ink: paintInk("simple", BLACK, 255),
                symmetry: sym({ mirrorX: true, axisX: 10 }),
            },
            p(1, 1),
        );
        stroke.to(p(3, 1));
        expect(painted(image)).toEqual(["1,1", "2,1", "3,1", "6,1", "7,1", "8,1"].sort());
        stroke.to(p(1, 4));
        expect(painted(image)).toEqual(
            ["1,1", "1,2", "1,3", "1,4", "8,1", "8,2", "8,3", "8,4"].sort(),
        );
        expect(mirroredLeftRight(image)).toBe(true);
    });

    it("in tiled mode take back the wrapped part too", () => {
        const [image, original] = canvas(8, 4);
        const stroke = new StraightStroke(
            image,
            original,
            {
                brush: createBrush("square", 1),
                ink: paintInk("simple", BLACK, 255),
                symmetry: sym({ wrapX: true }),
            },
            p(6, 1),
        );
        stroke.to(p(9, 1));
        expect(painted(image)).toEqual(["6,1", "7,1", "0,1", "1,1"].sort());
        stroke.to(p(6, 2));
        expect(painted(image)).toEqual(["6,1", "6,2"].sort());
    });
});

describe("shapes with symmetry (ShapeStroke's mark pass)", () => {
    const options = (symmetry: StrokeSymmetry | null, size = 1) => ({
        brush: createBrush("square", size),
        ink: paintInk("simple", BLACK, 255),
        symmetry,
    });

    it("mirror the outline and the inside, and each redraw puts the old copies back", () => {
        fc.assert(
            fc.property(
                fc.constantFrom("line", "rectangle", "ellipse" as const),
                fc.boolean(),
                fc.integer({ min: 1, max: 3 }),
                fc.array(
                    fc.record({
                        from: fc.record({
                            x: fc.integer({ min: -2, max: 13 }),
                            y: fc.integer({ min: -2, max: 11 }),
                        }),
                        to: fc.record({
                            x: fc.integer({ min: -2, max: 13 }),
                            y: fc.integer({ min: -2, max: 11 }),
                        }),
                    }),
                    { minLength: 1, maxLength: 4 },
                ),
                (kind, filled, size, drags) => {
                    const symmetry = sym({ mirrorX: true, mirrorY: true, axisX: 12, axisY: 10 });
                    const [image, original] = canvas(12, 10);
                    const stroke = new ShapeStroke(image, original, options(symmetry, size));
                    let last = drags[0]!;
                    for (const drag of drags) {
                        stroke.draw({
                            kind,
                            from: drag.from,
                            to: drag.to,
                            filled: kind !== "line" && filled,
                        });
                        last = drag;
                    }
                    expect(mirroredLeftRight(image)).toBe(true);
                    expect(mirroredTopBottom(image)).toBe(true);
                    // The same as drawing the last shape alone: nothing of the earlier ones stays.
                    const [alone, aloneOriginal] = canvas(12, 10);
                    new ShapeStroke(alone, aloneOriginal, options(symmetry, size)).draw({
                        kind,
                        from: last.from,
                        to: last.to,
                        filled: kind !== "line" && filled,
                    });
                    expect(painted(image)).toEqual(painted(alone));
                },
            ),
        );
    });

    it("a line along the column an odd axis runs through is inked once", () => {
        const background = 0x2080c0ff;
        const ink = paintInk("alpha", 0xff000080, 200);
        const [once] = canvas(1, 1, background);
        ink.apply(once.data, clonePixelBuffer(once).data, 0);
        const [image, original] = canvas(7, 5, background);
        new ShapeStroke(image, original, {
            brush: createBrush("square", 2),
            ink,
            symmetry: sym({ mirrorX: true, axisX: 7 }),
        }).draw({ kind: "line", from: p(3, 0), to: p(3, 4), filled: false });
        for (let y = 0; y < 5; y++) expect(rgba(image, 3, y)).toEqual(rgba(once, 0, 0));
    });

    it("an off-centre axis brings the mirror image of rows above the canvas onto it", () => {
        // Axis at y = 2 (4 half pixels): rows -3..-1 mirror to rows 6..4.
        const [image, original] = canvas(6, 10);
        new ShapeStroke(image, original, options(sym({ mirrorY: true, axisY: 4 }))).draw({
            kind: "rectangle",
            from: p(1, -3),
            to: p(4, -1),
            filled: true,
        });
        const expected: string[] = [];
        for (let y = 4; y <= 6; y++) for (let x = 1; x <= 4; x++) expected.push(`${x},${y}`);
        expect(painted(image)).toEqual(expected.sort());
    });

    it("in tiled mode a filled rectangle over the corner wraps to the other three corners", () => {
        const [image, original] = canvas(8, 6);
        new ShapeStroke(image, original, options(sym({ wrapX: true, wrapY: true }))).draw({
            kind: "rectangle",
            from: p(7, 5),
            to: p(8, 6),
            filled: true,
        });
        expect(painted(image)).toEqual(["7,5", "0,5", "7,0", "0,0"].sort());
    });

    it("a polygon (SE-065) is mirrored through the same pass", () => {
        const [image, original] = canvas(10, 8);
        new ShapeStroke(image, original, options(sym({ mirrorX: true, axisX: 10 }))).draw({
            kind: "polygon",
            points: [p(1, 1), p(3, 1), p(1, 5)],
            filled: true,
        });
        expect(mirroredLeftRight(image)).toBe(true);
        expect(painted(image)).toContain("8,1");
    });
});

describe("the contour and the spray with symmetry (Stamper, SE-065)", () => {
    it("the contour's inside (inkRun) is mirrored and wrapped", () => {
        const [image, original] = canvas(10, 8);
        const stroke = new ContourStroke(image, original, {
            brush: createBrush("square", 1),
            ink: paintInk("simple", BLACK, 255),
            symmetry: sym({ mirrorX: true, axisX: 10 }),
        });
        for (const point of [p(1, 1), p(4, 1), p(4, 4), p(1, 4)]) stroke.to(point);
        stroke.close();
        const expected: string[] = [];
        for (let y = 1; y <= 4; y++) {
            for (let x = 1; x <= 4; x++) expected.push(`${x},${y}`, `${9 - x},${y}`);
        }
        expect(painted(image)).toEqual(expected.sort());

        const [tiled, tiledOriginal] = canvas(8, 8);
        const wrapped = new ContourStroke(tiled, tiledOriginal, {
            brush: createBrush("square", 1),
            ink: paintInk("simple", BLACK, 255),
            symmetry: sym({ wrapY: true }),
        });
        for (const point of [p(2, 6), p(4, 6), p(4, 9), p(2, 9)]) wrapped.to(point);
        wrapped.close();
        const below: string[] = [];
        for (const y of [6, 7, 0, 1]) for (let x = 2; x <= 4; x++) below.push(`${x},${y}`);
        expect(painted(tiled)).toEqual(below.sort());
    });

    it("the contour's inside reaches the canvas from rows an off-centre axis mirrors onto it", () => {
        const [image, original] = canvas(6, 10);
        const stroke = new ContourStroke(image, original, {
            brush: createBrush("square", 1),
            ink: paintInk("simple", BLACK, 255),
            symmetry: sym({ mirrorY: true, axisY: 4 }),
        });
        for (const point of [p(1, -3), p(4, -3), p(4, -1), p(1, -1)]) stroke.to(point);
        stroke.close();
        const expected: string[] = [];
        for (let y = 4; y <= 6; y++) for (let x = 1; x <= 4; x++) expected.push(`${x},${y}`);
        expect(painted(image)).toEqual(expected.sort());
    });

    it("the spray's dots are mirrored", () => {
        const [image, original] = canvas(20, 20);
        const stroke = new SprayStroke(image, original, {
            brush: createBrush("square", 1),
            ink: paintInk("simple", BLACK, 255),
            radius: 4,
            density: 50,
            seed: 7,
            symmetry: sym({ mirrorX: true, mirrorY: true, axisX: 20, axisY: 20 }),
        });
        stroke.start(p(5, 5));
        stroke.to(p(8, 6));
        expect(painted(image).length).toBeGreaterThan(0);
        expect(mirroredLeftRight(image)).toBe(true);
        expect(mirroredTopBottom(image)).toBe(true);
    });
});

describe("the bucket's symmetric seeds", () => {
    it("symmetricPoints: the press, wrapped in tiled mode, and its mirror images on the canvas, each once", () => {
        expect(symmetricPoints(null, 8, 6, p(2, 3))).toEqual([p(2, 3)]);
        expect(symmetricPoints(null, 8, 6, p(8, 3))).toEqual([]);
        expect(
            symmetricPoints(
                sym({ mirrorX: true, mirrorY: true, axisX: 8, axisY: 6 }),
                8,
                6,
                p(1, 1),
            ),
        ).toEqual([p(1, 1), p(6, 1), p(1, 4), p(6, 4)]);
        // The column an odd axis runs through is its own mirror image.
        expect(symmetricPoints(sym({ mirrorX: true, axisX: 5 }), 5, 3, p(2, 1))).toEqual([p(2, 1)]);
        // A mirror image off the canvas is left out; tiled mode wraps it back.
        expect(symmetricPoints(sym({ mirrorX: true, axisX: 2 }), 8, 3, p(5, 1))).toEqual([p(5, 1)]);
        expect(
            symmetricPoints(sym({ mirrorX: true, axisX: 2, wrapX: true }), 8, 3, p(5, 1)),
        ).toEqual([p(5, 1), p(4, 1)]);
        expect(symmetricPoints(sym({ wrapX: true, wrapY: true }), 8, 6, p(9, -1))).toEqual([
            p(1, 5),
        ]);
    });

    it("floods every seed in the source before any paint and returns the union", () => {
        // Left half white, right half red, a black column between them.
        const width = 9;
        const pixels: Rgba[] = [];
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < width; x++) {
                pixels.push(
                    x < 4 ? [255, 255, 255, 255] : x === 4 ? [0, 0, 0, 255] : [255, 0, 0, 255],
                );
            }
        }
        const source = sprite(width, 4, [{ pixels }]);
        const image = source.images.values().next().value as PixelBuffer;
        const options = { tolerance: 0, contiguous: true };
        const symmetry = sym({ mirrorX: true, axisX: width });
        const union = symmetricFloodMask(image, p(1, 1), options, symmetry);
        const left = floodMask(image, p(1, 1), options);
        const right = floodMask(image, p(7, 1), options);
        expect(Array.from(union.data)).toEqual(
            Array.from(left.data, (byte, index) => byte | right.data[index]!),
        );
        // Off the canvas, no seed: an empty mask.
        expect(
            Array.from(symmetricFloodMask(image, p(-1, 1), options, symmetry).data).every(
                (byte) => byte === 0,
            ),
        ).toBe(true);
    });
});

describe("the composite", () => {
    it("compositeFrame is unaffected by tiled mode and by the axes", () => {
        const pixels: Rgba[] = [];
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 7; x++) pixels.push([x * 30, y * 50, 99, x === y ? 128 : 255]);
        }
        const doc = sprite(7, 5, [
            { pixels },
            { pixels: pixels.map(([r, g, b]) => [b, g, r, 64]) },
        ]);
        const before = compositeFrame(doc, FRAME);
        for (const tiled of ["x", "y", "both"] as const) {
            for (const mode of ["x", "y", "both"] as const) {
                doc.settings.tiled = tiled;
                doc.settings.symmetry = { mode, axisX: 3, axisY: 8 };
                const after = compositeFrame(doc, FRAME);
                expect(after.width).toBe(7);
                expect(after.height).toBe(5);
                expect(Array.from(after.data)).toEqual(Array.from(before.data));
            }
        }
    });
});
