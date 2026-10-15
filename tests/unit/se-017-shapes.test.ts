import { describe, expect, it } from "vitest";
import type { PixelBuffer, Rect } from "../../src/core/model";
import { clonePixelBuffer, createPixelBuffer } from "../../src/core/pixels";
import {
    brushRuns,
    createBrush,
    ellipsePixels,
    forEachFilledRun,
    forEachOutlinePixel,
    linePixels,
    paintInk,
    ShapeStroke,
} from "../../src/core/raster";
import type { Brush, PixelPoint, Shape } from "../../src/core/raster";
import { seeded } from "./se-030-support";

// SE-017: the shapes of the shape tools in `core/raster` and their rubber-band stroke. The
// outline of a line, a rectangle and an ellipse; the inside of a filled one; `ShapeStroke`
// draws a shape in place of the one before, so the image always holds the stroke's start with
// the last shape alone over it, the brush stamped along the outline, inked from the start;
// each draw reports exactly the rectangle of the pixels it changed, the pixels of the previous
// shape it put back included.

const BLACK = 0x000000ff;
const p = (x: number, y: number): PixelPoint => ({ x, y });
const shape = (kind: Shape["kind"], from: PixelPoint, to: PixelPoint, filled = false): Shape => ({
    kind,
    from,
    to,
    filled,
});

/** The pixels `visit` is called with, each once, as rows of `#` on a `width` × `height` grid. */
function grid(width: number, height: number, fill: (set: (x: number, y: number) => void) => void) {
    const rows = Array.from({ length: height }, () => new Array<string>(width).fill("."));
    fill((x, y) => {
        if (x >= 0 && y >= 0 && x < width && y < height) rows[y]![x] = "#";
    });
    return rows.map((row) => row.join(""));
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

/** `original` with the pixels `covered` (x,y keys) set to `rgba`. */
function withPixels(
    original: PixelBuffer,
    covered: Iterable<string>,
    rgba: number[],
): Uint8ClampedArray {
    const data = original.data.slice();
    for (const key of covered) {
        const [x, y] = key.split(",").map(Number) as [number, number];
        if (x < 0 || y < 0 || x >= original.width || y >= original.height) continue;
        data.set(rgba, (y * original.width + x) * 4);
    }
    return data;
}

/** The pixels `brush` covers stamped at each pixel of `path`, as x,y keys. */
function stamped(path: readonly PixelPoint[], brush: Brush): Set<string> {
    const keys = new Set<string>();
    for (const { x, y } of path) {
        for (const run of brushRuns(brush, x, y)) {
            for (let px = run.x; px < run.end; px++) keys.add(`${px},${run.y}`);
        }
    }
    return keys;
}

/** The bounding rectangle of the pixels that differ between two images, or null. */
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number): Rect | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < a.length / 4; index++) {
        const at = index * 4;
        if (
            a[at] === b[at] &&
            a[at + 1] === b[at + 1] &&
            a[at + 2] === b[at + 2] &&
            a[at + 3] === b[at + 3]
        ) {
            continue;
        }
        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe("outlines", () => {
    it("of a rectangle: its four sides, both corners included, in either order", () => {
        const expected = ["........", ".######.", ".#....#.", ".#....#.", ".######.", "........"];
        expect(
            grid(8, 6, (set) => forEachOutlinePixel(shape("rectangle", p(1, 1), p(6, 4)), set)),
        ).toEqual(expected);
        expect(
            grid(8, 6, (set) => forEachOutlinePixel(shape("rectangle", p(6, 4), p(1, 1)), set)),
        ).toEqual(expected);
    });

    it("of a rectangle one pixel high or wide, and of one pixel", () => {
        expect(
            grid(5, 3, (set) => forEachOutlinePixel(shape("rectangle", p(0, 1), p(4, 1)), set)),
        ).toEqual([".....", "#####", "....."]);
        expect(
            grid(3, 4, (set) => forEachOutlinePixel(shape("rectangle", p(1, 3), p(1, 0)), set)),
        ).toEqual([".#.", ".#.", ".#.", ".#."]);
        expect(
            grid(3, 3, (set) => forEachOutlinePixel(shape("rectangle", p(1, 1), p(1, 1)), set)),
        ).toEqual(["...", ".#.", "..."]);
    });

    it("of a line: the Bresenham line, in order", () => {
        const visited: PixelPoint[] = [];
        forEachOutlinePixel(shape("line", p(2, 9), p(13, 3)), (x, y) => void visited.push(p(x, y)));
        expect(visited).toEqual(linePixels(p(2, 9), p(13, 3)));
    });

    it("of an ellipse: the ellipse that fits the corners' rectangle", () => {
        const visited = new Set<string>();
        forEachOutlinePixel(
            shape("ellipse", p(12, 2), p(3, 8)),
            (x, y) => void visited.add(`${x},${y}`),
        );
        expect([...visited].sort()).toEqual(
            ellipsePixels(p(3, 2), p(12, 8))
                .map(({ x, y }) => `${x},${y}`)
                .sort(),
        );
    });

    it("refuses points that are not whole numbers", () => {
        expect(() => forEachOutlinePixel(shape("rectangle", p(0, 0), p(2.5, 1)), () => {})).toThrow(
            RangeError,
        );
    });
});

describe("insides", () => {
    it("of a filled rectangle: every pixel of it; of an outline or a line: none", () => {
        const runs: [number, number, number][] = [];
        forEachFilledRun(
            shape("rectangle", p(5, 3), p(2, 1), true),
            (y, x, end) => void runs.push([y, x, end]),
        );
        expect(runs).toEqual([
            [1, 2, 6],
            [2, 2, 6],
            [3, 2, 6],
        ]);
        runs.length = 0;
        forEachFilledRun(
            shape("rectangle", p(5, 3), p(2, 1), false),
            (y, x, end) => void runs.push([y, x, end]),
        );
        forEachFilledRun(
            shape("line", p(5, 3), p(2, 1), true),
            (y, x, end) => void runs.push([y, x, end]),
        );
        expect(runs).toEqual([]);
    });

    it("of a filled ellipse: the rows between its outline pixels", () => {
        expect(
            grid(9, 4, (set) =>
                forEachFilledRun(shape("ellipse", p(0, 0), p(8, 3), true), (y, x, end) => {
                    for (let column = x; column < end; column++) set(column, y);
                }),
            ),
        ).toEqual(["..#####..", "#########", "#########", "..#####.."]);
    });
});

describe("the rubber-band stroke", () => {
    const simpleBlack = () => paintInk("simple", BLACK, 255);
    const one = createBrush("square", 1);

    it("draws a shape, then another in its place: the image is the start with the last shape alone", () => {
        const [image, original] = patterned(16, 12);
        const stroke = new ShapeStroke(image, original, { brush: one, ink: simpleBlack() });
        const big = shape("rectangle", p(1, 1), p(14, 10));
        expect(stroke.draw(big)).toEqual({ x: 1, y: 1, width: 14, height: 10 });
        const outline = (s: Shape) => {
            const keys = new Set<string>();
            forEachOutlinePixel(s, (x, y) => void keys.add(`${x},${y}`));
            return keys;
        };
        expect(image.data).toEqual(withPixels(original, outline(big), [0, 0, 0, 255]));

        const small = shape("rectangle", p(4, 3), p(8, 6));
        const before = image.data.slice();
        const changed = stroke.draw(small);
        expect(image.data).toEqual(withPixels(original, outline(small), [0, 0, 0, 255]));
        // The previous outline was put back: the reported rectangle holds it.
        expect(changed).toEqual(difference(before, image.data, 16));
        expect(changed).toEqual({ x: 1, y: 1, width: 14, height: 10 });
        expect(stroke.shape).toEqual(small);
        // The same shape again changes nothing.
        expect(stroke.draw({ ...small, from: { ...small.from } })).toBeNull();
    });

    it("stamps the brush along the outline; a filled shape also covers its inside", () => {
        for (const brush of [createBrush("square", 3), createBrush("circle", 4)]) {
            const [image, original] = patterned(20, 16);
            const stroke = new ShapeStroke(image, original, { brush, ink: simpleBlack() });
            const rect = shape("rectangle", p(5, 5), p(12, 9));
            stroke.draw(rect);
            const path: PixelPoint[] = [];
            forEachOutlinePixel(rect, (x, y) => void path.push(p(x, y)));
            expect(image.data, `${brush.shape} ${brush.size}`).toEqual(
                withPixels(original, stamped(path, brush), [0, 0, 0, 255]),
            );
            const filled = { ...rect, filled: true };
            stroke.draw(filled);
            const covered = stamped(path, brush);
            for (let y = 5; y <= 9; y++) for (let x = 5; x <= 12; x++) covered.add(`${x},${y}`);
            expect(image.data, `${brush.shape} ${brush.size} filled`).toEqual(
                withPixels(original, covered, [0, 0, 0, 255]),
            );
        }
    });

    it("inks each covered pixel once, from its value at the stroke's start, where brush stamps overlap too", () => {
        const width = 14;
        const height = 12;
        // Translucent pixels, each its own colour: alpha ink at a partial opacity changes a
        // pixel again each time it is applied, so a pixel inked twice would show it.
        const image = createPixelBuffer(width, height);
        for (let index = 0; index < width * height; index++) {
            image.data.set([200, (index * 7) & 255, 40, 100 + (index % 50)], index * 4);
        }
        const original = clonePixelBuffer(image);
        const ink = paintInk("alpha", 0x0000ff80, 200);
        const brush = createBrush("circle", 3);
        for (const filled of [false, true]) {
            image.data.set(original.data);
            const stroke = new ShapeStroke(image, original, { brush, ink });
            const final = shape("ellipse", p(2, 2), p(11, 9), filled);
            stroke.draw(final);
            stroke.draw(shape("ellipse", p(2, 2), p(11, 8), filled));
            stroke.draw(final);
            // How many stamps of the brush, and the inside, cover each pixel.
            const covers = new Map<string, number>();
            const count = (key: string) => covers.set(key, (covers.get(key) ?? 0) + 1);
            forEachOutlinePixel(final, (x, y) => {
                for (const run of brushRuns(brush, x, y)) {
                    for (let px = run.x; px < run.end; px++) count(`${px},${run.y}`);
                }
            });
            forEachFilledRun(final, (y, x, end) => {
                for (let px = x; px < end; px++) count(`${px},${y}`);
            });
            let overlapping = 0;
            for (let index = 0; index < width * height; index++) {
                const x = index % width;
                const y = Math.floor(index / width);
                const at = index * 4;
                const start = original.data.slice(at, at + 4);
                const once = start.slice();
                ink.apply(once, start, 0);
                const twice = once.slice();
                ink.apply(twice, once, 0);
                const times = covers.get(`${x},${y}`) ?? 0;
                if (times > 1) {
                    overlapping++;
                    // A second application would be seen here.
                    expect(Array.from(twice), `${x}, ${y}`).not.toEqual(Array.from(once));
                }
                expect(Array.from(image.data.slice(at, at + 4)), `${filled} ${x}, ${y}`).toEqual(
                    Array.from(times > 0 ? once : start),
                );
            }
            expect(overlapping, `${filled}`).toBeGreaterThan(20);
        }
    });

    it("draws only the part on the image; a shape off the image changes nothing", () => {
        const [image, original] = patterned(8, 8);
        const stroke = new ShapeStroke(image, original, { brush: one, ink: simpleBlack() });
        expect(stroke.draw(shape("line", p(-5, -5), p(-1, 20)))).toBeNull();
        expect(image.data).toEqual(original.data);
        expect(stroke.draw(shape("rectangle", p(-3, 2), p(3, 20)))).toEqual({
            x: 0,
            y: 2,
            width: 4,
            height: 6,
        });
        // Back off the image: the part that was on it is put back.
        expect(stroke.draw(shape("line", p(-5, -5), p(-1, 20)))).toEqual({
            x: 0,
            y: 2,
            width: 4,
            height: 6,
        });
        expect(image.data).toEqual(original.data);
    });

    it("random drags: after each draw the image holds the last shape alone, and the reported rectangle is exactly what changed", () => {
        const random = seeded(23);
        const kinds: Shape["kind"][] = ["line", "rectangle", "ellipse"];
        const inks = [
            paintInk("simple", 0x10203040, 200),
            paintInk("alpha", 0x80ff0080, 255),
            simpleBlack(),
        ];
        for (let round = 0; round < 20; round++) {
            const [image, original] = patterned(24, 18);
            const brush = createBrush(
                random() < 0.5 ? "square" : "circle",
                1 + Math.floor(random() * 5),
            );
            const ink = inks[round % inks.length]!;
            const stroke = new ShapeStroke(image, original, { brush, ink });
            const start = p(Math.floor(random() * 30) - 3, Math.floor(random() * 24) - 3);
            const kind = kinds[round % kinds.length]!;
            const filled = random() < 0.5;
            // More than 255 draws: the marks start over on the way.
            for (let move = 0; move < 300; move++) {
                const end = p(Math.floor(random() * 30) - 3, Math.floor(random() * 24) - 3);
                const next = shape(kind, start, end, filled);
                const before = image.data.slice();
                const changed = stroke.draw(next);
                const alone = clonePixelBuffer(original);
                new ShapeStroke(alone, original, { brush, ink }).draw(next);
                if (image.data.some((value, index) => value !== alone.data[index])) {
                    throw new Error(`round ${round}, move ${move}: not the last shape alone`);
                }
                const expected = difference(before, image.data, 24);
                if (JSON.stringify(changed) !== JSON.stringify(expected)) {
                    throw new Error(
                        `round ${round}, move ${move}: reported ${JSON.stringify(changed)}, ` +
                            `changed ${JSON.stringify(expected)}`,
                    );
                }
            }
        }
    });

    it("refuses an original of another size", () => {
        const image = createPixelBuffer(4, 4);
        expect(
            () =>
                new ShapeStroke(image, createPixelBuffer(4, 5), { brush: one, ink: simpleBlack() }),
        ).toThrow(RangeError);
    });
});
