import { describe, expect, it } from "vitest";
import { ImportError, fitRect, resample } from "../../src/core/import";
import type { ResampleFit, ResampleMethod } from "../../src/core/import";
import { createPixelBuffer } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";

const METHODS: ResampleMethod[] = ["nearest", "area", "dominant"];
const FITS: ResampleFit[] = ["stretch", "contain", "cover"];

function rect(x: number, y: number, width: number, height: number) {
    return { x, y, width, height };
}

/** An opaque buffer in which every pixel holds its own position: red is x and green is y. */
function coordinates(width: number, height: number): PixelBuffer {
    const buffer = createPixelBuffer(width, height);
    for (let y = 0, i = 0; y < height; y++) {
        for (let x = 0; x < width; x++, i += 4) {
            buffer.data.set([x, y, 200, 255], i);
        }
    }
    return buffer;
}

describe("fitRect", () => {
    it("stretch puts the whole source on the whole target", () => {
        expect(fitRect(4, 2, 2, 2, "stretch")).toEqual({
            source: rect(0, 0, 4, 2),
            target: rect(0, 0, 2, 2),
        });
        expect(fitRect(3, 7, 10, 1, "stretch")).toEqual({
            source: rect(0, 0, 3, 7),
            target: rect(0, 0, 10, 1),
        });
    });

    it("contain centres the whole source on a part of the target", () => {
        const target = (
            sourceWidth: number,
            sourceHeight: number,
            width: number,
            height: number,
        ) => {
            const fitted = fitRect(sourceWidth, sourceHeight, width, height, "contain");
            expect(fitted.source).toEqual(rect(0, 0, sourceWidth, sourceHeight));
            return fitted.target;
        };
        expect(target(4, 2, 4, 4)).toEqual(rect(0, 1, 4, 2));
        expect(target(2, 4, 4, 4)).toEqual(rect(1, 0, 2, 4));
        expect(target(64, 32, 16, 16)).toEqual(rect(0, 4, 16, 8));
        // An odd margin: the smaller half comes first.
        expect(target(4, 2, 2, 2)).toEqual(rect(0, 0, 2, 1));
        expect(target(1, 1, 2, 1)).toEqual(rect(0, 0, 1, 1));
        expect(target(1, 1, 4, 1)).toEqual(rect(1, 0, 1, 1));
        // The fitted side is rounded, halves up: 2 × 0.67 → 1, 3.33 × 5 → 3, 2.5 × 5 → 3.
        expect(target(3, 1, 2, 2)).toEqual(rect(0, 0, 2, 1));
        expect(target(2, 3, 5, 5)).toEqual(rect(1, 0, 3, 5));
        expect(target(1, 2, 5, 5)).toEqual(rect(1, 0, 3, 5));
        // And it is at least one pixel: 2 × 0.25.
        expect(target(8, 1, 2, 2)).toEqual(rect(0, 0, 2, 1));
        // 48 × 32 in 16 × 16: 16 × 10.67 → 16 × 11, two rows above and three below.
        expect(target(48, 32, 16, 16)).toEqual(rect(0, 2, 16, 11));
    });

    it("cover puts the centred part of the source on the whole target", () => {
        const source = (
            sourceWidth: number,
            sourceHeight: number,
            width: number,
            height: number,
        ) => {
            const fitted = fitRect(sourceWidth, sourceHeight, width, height, "cover");
            expect(fitted.target).toEqual(rect(0, 0, width, height));
            return fitted.source;
        };
        expect(source(4, 2, 2, 2)).toEqual(rect(1, 0, 2, 2));
        expect(source(2, 4, 2, 2)).toEqual(rect(0, 1, 2, 2));
        expect(source(64, 32, 16, 16)).toEqual(rect(16, 0, 32, 32));
        // The part may start inside a pixel.
        expect(source(4, 1, 1, 1)).toEqual(rect(1.5, 0, 1, 1));
        expect(source(3, 2, 2, 2)).toEqual(rect(0.5, 0, 2, 2));
        expect(source(2, 5, 4, 4)).toEqual(rect(0, 1.5, 2, 2));
        // 5 × 3 on 2 × 3: the part is 2 wide and starts 1.5 pixels in.
        expect(source(5, 3, 2, 3)).toEqual(rect(1.5, 0, 2, 3));
    });

    it("cover scales both sides by the same factor", () => {
        for (let sourceWidth = 1; sourceWidth <= 7; sourceWidth++) {
            for (let sourceHeight = 1; sourceHeight <= 7; sourceHeight++) {
                for (let width = 1; width <= 7; width++) {
                    for (let height = 1; height <= 7; height++) {
                        const { source } = fitRect(
                            sourceWidth,
                            sourceHeight,
                            width,
                            height,
                            "cover",
                        );
                        // source.width / width = source.height / height, without dividing.
                        expect(source.width * height).toBeCloseTo(source.height * width, 9);
                        expect(source.x).toBeCloseTo((sourceWidth - source.width) / 2, 9);
                        expect(source.y).toBeCloseTo((sourceHeight - source.height) / 2, 9);
                    }
                }
            }
        }
    });

    it("gives the whole source on the whole target for every fit when the shapes agree", () => {
        for (const fit of FITS) {
            expect(fitRect(6, 4, 3, 2, fit), fit).toEqual({
                source: rect(0, 0, 6, 4),
                target: rect(0, 0, 3, 2),
            });
            expect(fitRect(5, 5, 5, 5, fit), fit).toEqual({
                source: rect(0, 0, 5, 5),
                target: rect(0, 0, 5, 5),
            });
        }
    });

    it("rejects a size that is not positive integers", () => {
        for (const sizes of [
            [0, 1, 1, 1],
            [1, 0, 1, 1],
            [1, 1, 0, 1],
            [1, 1, 1, 0],
            [1.5, 1, 1, 1],
            [1, 1, 1, -2],
            [1, Number.NaN, 1, 1],
        ]) {
            const run = () => fitRect(sizes[0], sizes[1], sizes[2], sizes[3], "contain");
            expect(run, sizes.join()).toThrow(ImportError);
            expect(run).toThrow(expect.objectContaining({ code: "settings" }));
        }
    });
});

describe("fitRect and resample", () => {
    // Every size pair from 1 × 1 to 6 × 5 and 7 × 6, every fit and method. The source holds
    // its own coordinates, so the result shows which source pixel each target pixel took.
    it("resample draws exactly the target rectangle, from the source part fitRect reports", () => {
        const failures: string[] = [];
        for (let sourceWidth = 1; sourceWidth <= 6; sourceWidth++) {
            for (let sourceHeight = 1; sourceHeight <= 5; sourceHeight++) {
                const pixels = coordinates(sourceWidth, sourceHeight);
                for (let width = 1; width <= 7; width++) {
                    for (let height = 1; height <= 6; height++) {
                        for (const fit of FITS) {
                            const { source, target } = fitRect(
                                sourceWidth,
                                sourceHeight,
                                width,
                                height,
                                fit,
                            );
                            for (const method of METHODS) {
                                const result = resample(pixels, width, height, { method, fit });
                                const label =
                                    `${sourceWidth}×${sourceHeight} → ${width}×${height} ` +
                                    `${fit} ${method}`;
                                for (let y = 0, i = 0; y < height; y++) {
                                    for (let x = 0; x < width; x++, i += 4) {
                                        const column = x - target.x;
                                        const row = y - target.y;
                                        const inside =
                                            column >= 0 &&
                                            column < target.width &&
                                            row >= 0 &&
                                            row < target.height;
                                        if (result.data[i + 3] !== (inside ? 255 : 0)) {
                                            failures.push(`${label}: alpha at ${x}, ${y}`);
                                        }
                                        if (!inside) {
                                            continue;
                                        }
                                        // What this target pixel shows, by `fitRect`.
                                        const stepX = source.width / target.width;
                                        const stepY = source.height / target.height;
                                        const left = source.x + column * stepX;
                                        const top = source.y + row * stepY;
                                        const shownX = result.data[i];
                                        const shownY = result.data[i + 1];
                                        // Every method takes its colour from the pixels in
                                        // that part of the source.
                                        const covered =
                                            shownX >= Math.floor(left + 1e-9) &&
                                            shownX <= Math.ceil(left + stepX - 1e-9) - 1 &&
                                            shownY >= Math.floor(top + 1e-9) &&
                                            shownY <= Math.ceil(top + stepY - 1e-9) - 1;
                                        // Nearest takes the pixel that holds its centre.
                                        const centred =
                                            method !== "nearest" ||
                                            (Math.abs(left + stepX / 2 - (shownX + 0.5)) <=
                                                0.5 + 1e-9 &&
                                                Math.abs(top + stepY / 2 - (shownY + 0.5)) <=
                                                    0.5 + 1e-9);
                                        if (!covered || !centred) {
                                            failures.push(
                                                `${label}: ${x}, ${y} shows ${shownX}, ${shownY}`,
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it("places a reference over the fitted image with one scale for cover and contain", () => {
        // What SE-044 does with the result: a reference layer showing the whole source, with
        // `scale` document pixels per source pixel and its top-left at (x, y).
        const place = (fit: ResampleFit) => {
            const { source, target } = fitRect(64, 32, 16, 16, fit);
            const scale = target.width / source.width;
            return { scale, x: target.x - source.x * scale, y: target.y - source.y * scale };
        };
        // Contain: the 64 × 32 image is 16 × 8, four rows down.
        expect(place("contain")).toEqual({ scale: 0.25, x: 0, y: 4 });
        // Cover: it is 32 × 16 and hangs over by eight columns on each side.
        expect(place("cover")).toEqual({ scale: 0.5, x: -8, y: 0 });
    });
});
