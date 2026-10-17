import { describe, expect, it } from "vitest";
import type { PixelBuffer, Rect } from "../../src/core/model";
import { clonePixelBuffer, createPixelBuffer } from "../../src/core/pixels";
import {
    brushRuns,
    ContourStroke,
    createBrush,
    createRandom,
    CURVE_MAX_POINTS,
    CURVE_MIN_POINTS,
    curveSampleCount,
    curveSamples,
    forEachCurvePixel,
    forEachOutlinePixel,
    forEachPolygonOutlinePixel,
    forEachPolygonRun,
    FreehandStroke,
    paintInk,
    sameShape,
    ShapeStroke,
    sprayDiskArea,
    SprayStroke,
    Stamper,
} from "../../src/core/raster";
import type { Brush, Ink, PixelPoint } from "../../src/core/raster";
import { polygonMask } from "../../src/core/selection";
import { Changes } from "../../src/core/raster/changes";
import { rowsOf, seeded } from "./se-030-support";

// SE-065: the raster side of the curve, polygon, contour and spray tools in `core/raster`.
// Golden rasters for fixed inputs: the curve through fixed control points (whose samples are
// those of Aseprite's `algo_spline`, ported here from its source), a concave polygon and a
// self-intersecting one filled by the even-odd rule (the polygon lasso's mask, SE-030); the
// contour closed equals the polygon filled through the same points; the spray with a fixed
// seed is reproducible, its dots inside the disk and as many as the density asks.

const RED = 0xff0000ff;
const p = (x: number, y: number): PixelPoint => ({ x, y });

/** The pixels `visit` is called with, as rows of `#` on a `width` × `height` grid. */
function grid(width: number, height: number, fill: (set: (x: number, y: number) => void) => void) {
    const rows = Array.from({ length: height }, () => new Array<string>(width).fill("."));
    fill((x, y) => {
        if (x >= 0 && y >= 0 && x < width && y < height) rows[y][x] = "#";
    });
    return rows.map((row) => row.join(""));
}

/** The pixels of `image` that differ from `before`, as rows of `#`. */
function changedRows(before: PixelBuffer, image: PixelBuffer): string[] {
    return grid(image.width, image.height, (set) => {
        for (let index = 0; index < image.width * image.height; index++) {
            const at = index * 4;
            for (let channel = 0; channel < 4; channel++) {
                if (image.data[at + channel] !== before.data[at + channel]) {
                    set(index % image.width, Math.floor(index / image.width));
                    break;
                }
            }
        }
    });
}

/** The bounding rectangle of the pixels that differ between two images, or null. */
function difference(a: PixelBuffer, b: PixelBuffer): Rect | null {
    const changes = new Changes();
    for (let index = 0; index < a.width * a.height; index++) {
        const at = index * 4;
        for (let channel = 0; channel < 4; channel++) {
            if (a.data[at + channel] !== b.data[at + channel]) {
                changes.add(index % a.width, Math.floor(index / a.width));
                break;
            }
        }
    }
    return changes.rect();
}

/** The union of two rectangles, either of them null. */
function union(a: Rect | null, b: Rect | null): Rect | null {
    if (!a) return b;
    if (!b) return a;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
    };
}

/** An image whose every pixel differs from its neighbours, opaque, with a copy as its original. */
function patterned(width: number, height: number): [PixelBuffer, PixelBuffer] {
    const image = createPixelBuffer(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            image.data.set([x * 11, y * 13, (x + y) * 3, 255], (y * width + x) * 4);
        }
    }
    return [image, clonePixelBuffer(image)];
}

/** A transparent image and a copy as its original. */
function transparent(width: number, height: number): [PixelBuffer, PixelBuffer] {
    const image = createPixelBuffer(width, height);
    return [image, clonePixelBuffer(image)];
}

/**
 * Aseprite's `algo_spline` (src/doc/algo.cpp, after Allegro's `calc_spline`), ported line by
 * line: the samples it joins with lines. A reference to compare with, not the editor's code.
 */
function asepriteSpline(points: readonly PixelPoint[]): PixelPoint[] {
    const [{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }] = points;
    const dist = (x: number, y: number) => Math.sqrt(x * x + y * y);
    let npts = Math.trunc(
        Math.sqrt(dist(x1 - x0, y1 - y0) + dist(x2 - x1, y2 - y1) + dist(x3 - x2, y3 - y2)) * 1.2,
    );
    if (npts > 64) npts = 64;
    else if (npts < 4) npts = 4;
    const dt = 1 / (npts - 1);
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const xdt2 = dt2 * (3 * (x2 - 2 * x1 + x0));
    const ydt2 = dt2 * (3 * (y2 - 2 * y1 + y0));
    const xdt3 = dt3 * (x3 + 3 * (-x2 + x1) - x0);
    const ydt3 = dt3 * (y3 + 3 * (-y2 + y1) - y0);
    const dddx = 6 * xdt3;
    const dddy = 6 * ydt3;
    let ddx = -6 * xdt3 + 2 * xdt2;
    let ddy = -6 * ydt3 + 2 * ydt2;
    let dx = xdt3 - xdt2 + 3 * dt * (x1 - x0);
    let dy = ydt3 - ydt2 + 3 * dt * (y1 - y0);
    let x = x0 + 0.5;
    let y = y0 + 0.5;
    const samples = [p(Math.trunc(x0), Math.trunc(y0))];
    for (let i = 1; i < npts; i++) {
        ddx += dddx;
        ddy += dddy;
        dx += ddx;
        dy += ddy;
        x += dx;
        y += dy;
        samples.push(p(Math.trunc(x), Math.trunc(y)));
    }
    return samples;
}

/** The fixed control points of the golden curve: start, controls, end. */
const GOLDEN_CURVE = [p(1, 12), p(3, 0), p(19, 1), p(22, 12)];

describe("curve", () => {
    it("is sampled as Aseprite samples it: ⌊1.2 √(control polygon)⌋ points, held to 4..64", () => {
        // A curve of one pixel: the fewest samples.
        expect(curveSampleCount([p(5, 5), p(5, 5), p(5, 5), p(5, 5)])).toBe(CURVE_MIN_POINTS);
        // A control polygon 50 long: √50 · 1.2 = 8.48…
        expect(curveSampleCount([p(0, 0), p(30, 40), p(30, 40), p(30, 40)])).toBe(8);
        // 3 × 1000 long: √3000 · 1.2 = 65.7…, held to 64.
        expect(curveSampleCount([p(0, 0), p(1000, 0), p(1000, 1000), p(0, 1000)])).toBe(
            CURVE_MAX_POINTS,
        );
        expect(CURVE_MAX_POINTS).toBe(64);
        expect(CURVE_MIN_POINTS).toBe(4);
    });

    it("takes the samples of Aseprite's algo_spline: exactly for the golden curve, within a pixel for any", () => {
        expect(curveSamples(GOLDEN_CURVE)).toEqual(asepriteSpline(GOLDEN_CURVE));
        const random = seeded(65);
        for (let run = 0; run < 500; run++) {
            const points = Array.from({ length: 4 }, () =>
                p(Math.floor(random() * 200), Math.floor(random() * 200)),
            );
            const ours = curveSamples(points);
            const theirs = asepriteSpline(points);
            expect(ours.length).toBe(theirs.length);
            for (let index = 0; index < ours.length; index++) {
                expect(Math.abs(ours[index].x - theirs[index].x)).toBeLessThanOrEqual(1);
                expect(Math.abs(ours[index].y - theirs[index].y)).toBeLessThanOrEqual(1);
            }
            // The ends are the curve's own.
            expect(ours[0]).toEqual(points[0]);
            expect(ours[ours.length - 1]).toEqual(points[3]);
        }
    });

    it("golden: the curve through fixed control points, its samples joined by lines", () => {
        expect(grid(24, 14, (set) => forEachCurvePixel(GOLDEN_CURVE, set))).toEqual([
            "........................",
            "........................",
            "........................",
            ".........#####..........",
            ".......##.....###.......",
            ".....##..........#......",
            "....#.............##....",
            "...#................#...",
            "...#................#...",
            "..#..................#..",
            "..#..................#..",
            ".#....................#.",
            ".#....................#.",
            "........................",
        ]);
    });

    it("visits each pixel of the curve once, each a neighbour of the one before, from start to end", () => {
        const random = seeded(7);
        for (let run = 0; run < 200; run++) {
            const points = Array.from({ length: 4 }, () =>
                p(Math.floor(random() * 60) - 10, Math.floor(random() * 60) - 10),
            );
            const visited: PixelPoint[] = [];
            forEachCurvePixel(points, (x, y) => void visited.push(p(x, y)));
            expect(visited[0]).toEqual(points[0]);
            expect(visited[visited.length - 1]).toEqual(points[3]);
            for (let index = 1; index < visited.length; index++) {
                const step = [
                    Math.abs(visited[index].x - visited[index - 1].x),
                    Math.abs(visited[index].y - visited[index - 1].y),
                ];
                expect(Math.max(...step)).toBe(1);
            }
        }
    });

    it("refuses a curve that is not 4 whole points", () => {
        expect(() => curveSamples([p(0, 0), p(1, 1), p(2, 2)])).toThrow(RangeError);
        expect(() => curveSamples([p(0, 0), p(1, 1), p(2, 2.5), p(3, 3)])).toThrow(RangeError);
        expect(() => curveSamples([p(0, 0), p(1, 1), p(2, 2), p(2 ** 25, 3)])).toThrow(RangeError);
    });

    it("is a shape of ShapeStroke: the brush stamped along it, drawn in place of the curve before", () => {
        const [image, original] = patterned(26, 16);
        const brush = createBrush("circle", 3);
        const stroke = new ShapeStroke(image, original, {
            brush,
            ink: paintInk("simple", RED, 255),
        });
        stroke.draw({ kind: "curve", points: [p(1, 12), p(1, 12), p(1, 12), p(20, 3)] });
        const last = stroke.draw({ kind: "curve", points: GOLDEN_CURVE });
        const expected = new Set<string>();
        forEachCurvePixel(GOLDEN_CURVE, (x, y) => {
            for (const run of brushRuns(brush, x, y)) {
                for (let px = run.x; px < run.end; px++) expected.add(`${px},${run.y}`);
            }
        });
        expect(changedRows(original, image)).toEqual(
            grid(26, 16, (set) => {
                for (const key of expected)
                    set(...(key.split(",").map(Number) as [number, number]));
            }),
        );
        expect(last).not.toBeNull();
        expect(
            stroke.draw({ kind: "curve", points: GOLDEN_CURVE.map((q) => ({ ...q })) }),
        ).toBeNull();
        expect(sameShape(stroke.shape!, { kind: "curve", points: GOLDEN_CURVE })).toBe(true);
    });
});

/** A concave polygon: an arrowhead pointing right, its notch on the left. */
const ARROWHEAD = [p(1, 1), p(16, 6), p(1, 11), p(6, 6)];
/** A five-pointed star drawn in one line: its sides cross. */
const STAR = [p(8, 0), p(13, 15), p(0, 5), p(16, 5), p(3, 15)];

function filledPolygon(
    points: readonly PixelPoint[],
    width: number,
    height: number,
    outline = true,
): string[] {
    return grid(width, height, (set) => {
        if (outline) forEachPolygonOutlinePixel(points, set);
        forEachPolygonRun(points, (y, x, end) => {
            for (let px = x; px < end; px++) set(px, y);
        });
    });
}

describe("polygon", () => {
    it("golden: a concave polygon filled — its sides and the pixels inside by the even-odd rule", () => {
        expect(filledPolygon(ARROWHEAD, 18, 13)).toEqual([
            "..................",
            ".##...............",
            "..####............",
            "...######.........",
            "....########......",
            ".....##########...",
            "......###########.",
            ".....##########...",
            "....########......",
            "...######.........",
            "..####............",
            ".##...............",
            "..................",
        ]);
    });

    it("golden: a star whose sides cross leaves its centre out by the even-odd rule", () => {
        // The inside alone: the pentagon in the middle lies inside two windings, so outside.
        expect(filledPolygon(STAR, 17, 16, false)).toEqual([
            "........#........",
            "........#........",
            "........#........",
            ".......###.......",
            ".......###.......",
            "#######...#######",
            "..#####...#####..",
            "...###.....###...",
            "....##.....##....",
            ".....#.....#.....",
            ".....##...##.....",
            ".....###.###.....",
            "....###...###....",
            "....##.....##....",
            "....#.......#....",
            ".................",
        ]);
    });

    it("covers, outline with inside, exactly the polygon lasso's mask (SE-030) of the same points", () => {
        const random = seeded(1965);
        for (let run = 0; run < 300; run++) {
            const count = 3 + Math.floor(random() * 6);
            const points = Array.from({ length: count }, () =>
                p(Math.floor(random() * 30) - 5, Math.floor(random() * 24) - 4),
            );
            expect(filledPolygon(points, 20, 16), JSON.stringify(points)).toEqual(
                rowsOf(polygonMask(20, 16, points)),
            );
        }
    });

    it("of fewer than 3 points is their line or their pixel, with no inside", () => {
        expect(filledPolygon([p(1, 1), p(5, 3)], 7, 5)).toEqual([
            ".......",
            ".#.....",
            "..##...",
            "....##.",
            ".......",
        ]);
        expect(filledPolygon([p(2, 2)], 4, 4)).toEqual(["....", "....", "..#.", "...."]);
        expect(filledPolygon([], 3, 3)).toEqual(["...", "...", "..."]);
    });

    it("joins the last point to the first, and draws the sides in the order of the points", () => {
        const visited: PixelPoint[] = [];
        forEachPolygonOutlinePixel([p(0, 0), p(4, 1), p(2, 5)], (x, y) => visited.push(p(x, y)));
        const expected: PixelPoint[] = [];
        for (const [from, to] of [
            [p(0, 0), p(4, 1)],
            [p(4, 1), p(2, 5)],
            [p(2, 5), p(0, 0)],
        ]) {
            forEachOutlinePixel({ kind: "line", from, to, filled: false }, (x, y) =>
                expected.push(p(x, y)),
            );
        }
        expect(visited).toEqual(expected);
    });

    it("looks only at the rows it is given", () => {
        const rows: number[] = [];
        forEachPolygonRun(ARROWHEAD, (y) => rows.push(y), 3, 5);
        expect([...new Set(rows)]).toEqual([3, 4, 5]);
        expect(() => forEachPolygonRun([p(0, 0), p(1, 0.5), p(2, 2)], () => {})).toThrow(
            RangeError,
        );
    });

    it("is a shape of ShapeStroke, outline or filled; the filled one draws over the outline's previous draw", () => {
        const [image, original] = patterned(18, 13);
        const brush = createBrush("square", 1);
        const stroke = new ShapeStroke(image, original, {
            brush,
            ink: paintInk("simple", RED, 255),
        });
        stroke.draw({ kind: "polygon", points: ARROWHEAD, filled: false });
        expect(changedRows(original, image)).toEqual(
            grid(18, 13, (set) => forEachPolygonOutlinePixel(ARROWHEAD, set)),
        );
        const before = clonePixelBuffer(image);
        const changed = stroke.draw({ kind: "polygon", points: ARROWHEAD, filled: true });
        expect(changedRows(original, image)).toEqual(filledPolygon(ARROWHEAD, 18, 13));
        expect(changed).toEqual(difference(before, image));
    });
});

/** A path through the points of `path` as a contour's samples, then closed. */
function contour(
    image: PixelBuffer,
    original: PixelBuffer,
    brush: Brush,
    ink: Ink,
    path: readonly PixelPoint[],
): { stroke: ContourStroke; reported: Rect | null } {
    const stroke = new ContourStroke(image, original, { brush, ink });
    let reported: Rect | null = null;
    for (const point of path) reported = union(reported, stroke.to(point));
    reported = union(reported, stroke.close());
    return { stroke, reported };
}

describe("contour", () => {
    const PATH = [p(2, 2), p(9, 1), p(14, 4), p(8, 6), p(13, 11), p(4, 12), p(6, 7)];

    for (const [shape, size] of [
        ["square", 1],
        ["circle", 3],
        ["square", 2],
    ] as const) {
        it(`closed, covers what the filled polygon through its points covers (${shape} ${size}, alpha ink at 128)`, () => {
            const brush = createBrush(shape, size);
            const ink = paintInk("alpha", 0x2040c0ff, 128);
            const [image, original] = patterned(18, 15);
            const { reported } = contour(image, original, brush, ink, PATH);
            const [expected, start] = patterned(18, 15);
            new ShapeStroke(expected, start, { brush, ink }).draw({
                kind: "polygon",
                points: PATH,
                filled: true,
            });
            expect(Array.from(image.data)).toEqual(Array.from(expected.data));
            expect(reported).toEqual(difference(original, image));
        });
    }

    it("before the release is the path the pencil draws through its points; fewer than 3 points stay a path", () => {
        const brush = createBrush("circle", 2);
        const ink = paintInk("simple", RED, 255);
        const [image, original] = patterned(18, 15);
        const stroke = new ContourStroke(image, original, { brush, ink });
        const [pencil, start] = patterned(18, 15);
        const freehand = new FreehandStroke(pencil, start, { brush, ink });
        for (const point of PATH) {
            stroke.to(point);
            freehand.to(point);
        }
        expect(Array.from(image.data)).toEqual(Array.from(pencil.data));
        // The same pixel twice adds no point.
        expect(stroke.to(PATH[PATH.length - 1])).toBeNull();
        expect(stroke.points).toEqual(PATH);

        const [line, lineStart] = patterned(18, 15);
        const two = new ContourStroke(line, lineStart, { brush, ink });
        two.to(p(1, 1));
        two.to(p(10, 8));
        const drawn = clonePixelBuffer(line);
        expect(two.close()).toBeNull();
        expect(two.closed).toBe(true);
        expect(Array.from(line.data)).toEqual(Array.from(drawn.data));
        expect(() => two.to(p(3, 3))).toThrow();
    });

    it("is clipped to the image, its inside too", () => {
        const [image, original] = transparent(8, 6);
        const { reported } = contour(
            image,
            original,
            createBrush("square", 1),
            paintInk("simple", RED, 255),
            [p(-4, -3), p(12, -3), p(12, 9), p(-4, 9)],
        );
        expect(changedRows(original, image)).toEqual(Array(6).fill("########"));
        expect(reported).toEqual({ x: 0, y: 0, width: 8, height: 6 });
    });

    it("inks a run of the inside once from the stroke's start, clipped to the image", () => {
        const [image, original] = patterned(6, 3);
        const stamper = new Stamper(image, original, {
            brush: createBrush("square", 1),
            ink: paintInk("alpha", RED, 100),
        });
        const changes = new Changes();
        stamper.inkRun(1, -2, 4, changes);
        stamper.inkRun(1, 2, 9, changes);
        stamper.inkRun(-1, 0, 6, changes);
        stamper.inkRun(3, 0, 6, changes);
        expect(changes.rect()).toEqual({ x: 0, y: 1, width: 6, height: 1 });
        const once = clonePixelBuffer(original);
        for (let x = 0; x < 6; x++)
            paintInk("alpha", RED, 100).apply(once.data, original.data, (6 + x) * 4);
        expect(Array.from(image.data)).toEqual(Array.from(once.data));
    });
});

/** An ink that counts the pixels it is applied to, and marks them opaque white. */
function countingInk(): Ink & { applied: number } {
    const ink = {
        applied: 0,
        apply(target: Uint8ClampedArray, _original: Uint8ClampedArray, at: number) {
            ink.applied++;
            target.set([255, 255, 255, 255], at);
            return true;
        },
    };
    return ink;
}

describe("spray", () => {
    it("counts the disk's offsets: dx² + dy² ≤ r² (the Gauss circle numbers)", () => {
        expect([1, 2, 3, 4, 5, 8, 10].map(sprayDiskArea)).toEqual([5, 13, 29, 49, 81, 197, 317]);
    });

    it("draws from mulberry32: numbers in [0, 1), the same for the same seed", () => {
        const ours = createRandom(42);
        const reference = seeded(42);
        for (let i = 0; i < 1000; i++) {
            const value = ours();
            expect(value).toBe(reference());
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
        expect(createRandom(1)()).not.toBe(createRandom(2)());
    });

    const SAMPLES = [p(20, 20), p(26, 21), p(31, 27), p(31, 27), p(24, 33)];

    function sprayed(seed: number, samples = SAMPLES, ink: Ink = paintInk("simple", RED, 255)) {
        const [image, original] = patterned(52, 52);
        const stroke = new SprayStroke(image, original, {
            brush: createBrush("circle", 2),
            ink,
            radius: 6,
            density: 30,
            seed,
        });
        let reported: Rect | null = stroke.start(samples[0]);
        for (const sample of samples.slice(1)) reported = union(reported, stroke.to(sample));
        return { image, original, reported, stroke };
    }

    it("with a fixed seed is reproducible; another seed sprays other dots", () => {
        const first = sprayed(123);
        const again = sprayed(123);
        expect(Array.from(again.image.data)).toEqual(Array.from(first.image.data));
        expect(first.reported).toEqual(difference(first.original, first.image));
        expect(first.stroke.last).toEqual(SAMPLES[SAMPLES.length - 1]);
        const other = sprayed(124);
        expect(Array.from(other.image.data)).not.toEqual(Array.from(first.image.data));
    });

    it("golden: a press with seed 2026, radius 3, density 50, a 1 px brush", () => {
        const [image, original] = transparent(9, 9);
        new SprayStroke(image, original, {
            brush: createBrush("square", 1),
            ink: paintInk("simple", RED, 255),
            radius: 3,
            density: 50,
            seed: 2026,
        }).start(p(4, 4));
        // 50 % of the 29 offsets of the disk: 14 dots, three of them on a pixel taken already.
        expect(changedRows(original, image)).toEqual([
            ".........",
            "....#....",
            "..#...#..",
            "..#####..",
            ".........",
            ".....#...",
            "...#.#...",
            ".........",
            ".........",
        ]);
        const ink = countingInk();
        new SprayStroke(...transparent(9, 9), {
            brush: createBrush("square", 1),
            ink,
            radius: 3,
            density: 50,
            seed: 2026,
        }).start(p(4, 4));
        expect(ink.applied).toBe(14);
    });

    it("sprays density % of the disk at the press and of 2r + 1 for each pixel the path moves on, inside the disk", () => {
        for (const [radius, density] of [
            [1, 100],
            [4, 30],
            [9, 7],
        ]) {
            const [image, original] = transparent(80, 80);
            const ink = countingInk();
            const stroke = new SprayStroke(image, original, {
                brush: createBrush("square", 1),
                ink,
                radius,
                density,
                seed: radius * 31 + density,
            });
            stroke.start(p(40, 40));
            const area = sprayDiskArea(radius);
            expect(ink.applied).toBe(Math.floor((density * area) / 100));
            // Along a row: 17 pixels after the press.
            stroke.to(p(57, 40));
            expect(ink.applied).toBe(Math.floor((density * (area + 17 * (2 * radius + 1))) / 100));
            // Every dot lies within the radius of a pixel of the path.
            const rows = changedRows(original, image);
            rows.forEach((row, y) => {
                for (let x = 0; x < row.length; x++) {
                    if (row[x] !== "#") continue;
                    const near = Math.max(40, Math.min(57, x));
                    expect((x - near) ** 2 + (y - 40) ** 2).toBeLessThanOrEqual(radius * radius);
                }
            });
        }
    });

    it("sprays along a straight run the same, sampled once or pixel by pixel", () => {
        const once = sprayed(9, [p(10, 30), p(40, 30)]);
        const often = sprayed(9, [p(10, 30), p(13, 30), p(14, 30), p(29, 30), p(40, 30)]);
        expect(Array.from(often.image.data)).toEqual(Array.from(once.image.data));
    });

    it("inks each pixel from the stroke's start: overlapping dots do not build up", () => {
        const ink = paintInk("alpha", 0x00ff0080, 200);
        const { image, original } = sprayed(77, SAMPLES, ink);
        const single = clonePixelBuffer(original);
        for (let index = 0; index < image.width * image.height; index++) {
            const at = index * 4;
            const changed = [0, 1, 2, 3].some((c) => image.data[at + c] !== original.data[at + c]);
            if (changed) ink.apply(single.data, original.data, at);
        }
        expect(Array.from(image.data)).toEqual(Array.from(single.data));
    });

    it("refuses a radius or a density out of range", () => {
        const [image, original] = transparent(4, 4);
        const options = {
            brush: createBrush("square", 1),
            ink: paintInk("simple", RED, 255),
            seed: 1,
        };
        expect(
            () => new SprayStroke(image, original, { ...options, radius: 0, density: 10 }),
        ).toThrow(RangeError);
        expect(
            () => new SprayStroke(image, original, { ...options, radius: 65, density: 10 }),
        ).toThrow(RangeError);
        expect(
            () => new SprayStroke(image, original, { ...options, radius: 2, density: 101 }),
        ).toThrow(RangeError);
        expect(
            () => new SprayStroke(image, original, { ...options, radius: 2, density: 1.5 }),
        ).toThrow(RangeError);
    });
});
