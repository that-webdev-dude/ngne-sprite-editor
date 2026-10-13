import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    clientToDoc,
    createViewMapping,
    docToClient,
    docToDevice,
} from "../../src/app/view/coordinates";
import type { ViewFrame } from "../../src/app/view/coordinates";
import { ZOOM_STEPS } from "../../src/app/view/zoom";
import { documentRect } from "../../src/engine/viewport/geometry";

// SE-012: the coordinate mapping shared by the tools and the overlay. Client positions are
// CSS pixels, device positions are pixels of the viewport element's canvases, document
// positions are sprite pixels.

/** SPEC §6.4: the steps at which texels are whole device pixels. */
const EXACT_STEPS = ZOOM_STEPS.filter((step) => step >= 1);
/** The device pixel ratios of the acceptance. */
const RATIOS = [1, 1.25, 1.5, 2];
/** Where the viewport element may lie, in CSS pixels; with 1.25 and 1.5 not all are whole device pixels. */
const CORNERS = [
    [0, 0],
    [44, 72],
    [45, 73],
    [72.5, 36.25],
    [301, 187],
] as const;
/** View origins, in device pixels: on screen, off screen, odd. */
const ORIGINS = [
    [0, 0],
    [40, 24],
    [-173, 9],
    [641, -2047],
    [-65535, 30011],
] as const;
const DOC = { docWidth: 37, docHeight: 21 };

interface FrameOptions {
    scale?: number;
    origin?: readonly number[];
    ratio?: number;
    left?: number;
    top?: number;
}

function frame({ scale = 1, origin = [], ratio = 1, left = 0, top = 0 }: FrameOptions): ViewFrame {
    const [originX = 0, originY = 0] = origin;
    return { view: { scale, originX, originY }, ...DOC, ratio, left, top };
}

/** Every frame of the acceptance: zoom steps ≥ 1 × ratios × element corners × origins. */
function* exactFrames(): Generator<ViewFrame> {
    for (const scale of EXACT_STEPS) {
        for (const ratio of RATIOS) {
            for (const [left, top] of CORNERS) {
                for (const origin of ORIGINS) yield frame({ scale, ratio, left, top, origin });
            }
        }
    }
}

/** Whole document positions: inside the document, on its edges, outside it. */
const WHOLE = [-1024, -3, -1, 0, 1, 2, 7, 20, 21, 36, 37, 255, 1023, 1024];

describe("clientToDoc(docToClient(p)) == p (acceptance)", () => {
    it("holds for whole p at every zoom step ≥ 1 and the ratios 1, 1.25, 1.5 and 2", () => {
        let checked = 0;
        for (const candidate of exactFrames()) {
            const mapping = createViewMapping(candidate);
            for (const x of WHOLE) {
                const y = WHOLE[(WHOLE.indexOf(x) * 5 + 3) % WHOLE.length] ?? 0;
                const client = mapping.docToClient(x, y);
                const back = mapping.clientToDoc(client.x, client.y);
                if (back.x !== x || back.y !== y) {
                    expect({ frame: candidate, x, y, client, back }).toBe("a round trip");
                }
                checked++;
            }
        }
        expect(checked).toBe(
            EXACT_STEPS.length * RATIOS.length * CORNERS.length * ORIGINS.length * WHOLE.length,
        );
        // All 15 steps of SPEC §6.4 from 1 up.
        expect(EXACT_STEPS).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64]);
    });

    it("holds for every pixel of a 1024-pixel side at each step and ratio", () => {
        for (const scale of EXACT_STEPS) {
            for (const ratio of RATIOS) {
                const mapping = createViewMapping(
                    frame({ scale, ratio, left: 45, top: 73, origin: [-311, 17] }),
                );
                for (let p = 0; p < 1024; p++) {
                    const client = mapping.docToClient(p, 1023 - p);
                    const back = mapping.clientToDoc(client.x, client.y);
                    if (back.x !== p || back.y !== 1023 - p) {
                        expect({ scale, ratio, p, client, back }).toBe("a round trip");
                    }
                }
            }
        }
    });

    it("holds for arbitrary whole positions, origins and element corners", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...EXACT_STEPS),
                fc.constantFrom(...RATIOS),
                fc.integer({ min: -100_000, max: 100_000 }),
                fc.integer({ min: -100_000, max: 100_000 }),
                // Element corners in quarters of a CSS pixel, as a zoomed page lays out.
                fc.integer({ min: 0, max: 16_000 }),
                fc.integer({ min: 0, max: 16_000 }),
                fc.integer({ min: -2048, max: 2048 }),
                fc.integer({ min: -2048, max: 2048 }),
                (scale, ratio, originX, originY, left, top, x, y) => {
                    const mapping = createViewMapping(
                        frame({
                            scale,
                            ratio,
                            left: left / 4,
                            top: top / 4,
                            origin: [originX, originY],
                        }),
                    );
                    const client = mapping.docToClient(x, y);
                    expect(mapping.clientToDoc(client.x, client.y)).toEqual({ x, y });
                },
            ),
            { numRuns: 2000 },
        );
    });

    it("holds at ratios whose division is not exact in floating point: 0.9, 1.1, 1.75, 2.625", () => {
        // (n / 1.1) * 1.1 is below n for thousands of whole n: a position on a texel
        // boundary would fall into the texel before it. 1.1 is a page zoomed to 110%, 1.75
        // a display scaled to 175%.
        const below = (ratio: number) => {
            let count = 0;
            for (let n = 0; n < 4096; n++) if ((n / ratio) * ratio < n) count++;
            return count;
        };
        for (const ratio of [0.9, 1.1, 1.75, 2.625]) {
            expect(below(ratio), `ratio ${ratio}`).toBeGreaterThan(0);
            for (const scale of EXACT_STEPS) {
                const mapping = createViewMapping(
                    frame({ scale, ratio, left: 44, top: 72, origin: [-311, 17] }),
                );
                for (let p = -64; p < 1088; p++) {
                    const client = mapping.docToClient(p, 1023 - p);
                    const back = mapping.clientToDoc(client.x, client.y);
                    if (back.x !== p || back.y !== 1023 - p) {
                        expect({ scale, ratio, p, client, back }).toBe("a round trip");
                    }
                }
            }
        }
    });

    it("holds for the positions a pointer event reports: 32-bit floats of CSS pixels", () => {
        // A mouse on device pixel 151 at a ratio of 1.5: the nearest 32-bit float to
        // 100.666… times 1.5 is short of 151.
        expect(Math.fround(151 / 1.5) * 1.5).toBeLessThan(151);
        let short = 0;
        for (const ratio of [1.25, 1.5, 1.75, 2, 2.625, 4]) {
            for (const scale of EXACT_STEPS) {
                // An element far into a large window: the float's error grows with the position.
                const mapping = createViewMapping(
                    frame({ scale, ratio, left: 1044, top: 3072, origin: [-311, 17] }),
                );
                for (let p = -64; p < 1088; p++) {
                    const client = mapping.docToClient(p, 1023 - p);
                    const x = Math.fround(client.x);
                    const y = Math.fround(client.y);
                    if (x < client.x || y < client.y) short++;
                    const back = mapping.clientToDoc(x, y);
                    if (back.x !== p || back.y !== 1023 - p) {
                        expect({ scale, ratio, p, client, back }).toBe("a round trip");
                    }
                }
            }
        }
        // The case is real: thousands of the positions were rounded down.
        expect(short).toBeGreaterThan(1000);
    });

    it("holds for mouse positions as Chrome reports them: the device pixel times a 32-bit reciprocal", () => {
        // Measured for SE-012 at a ratio of 1.5: device pixel 269 arrives as `clientX`
        // 179.33334350585938, which is fround(269 · fround(1 / 1.5)).
        const reported = (device: number, ratio: number) =>
            Math.fround(device * Math.fround(1 / ratio));
        expect(reported(269, 1.5)).toBe(179.33334350585938);
        // At 1.25, the scale of many laptop displays, one position in five is short of its
        // device pixel; at 1.2 two in three.
        const short = (ratio: number) => {
            let count = 0;
            for (let n = 1; n < 4000; n++) if (reported(n, ratio) * ratio < n) count++;
            return count;
        };
        expect(short(1.25)).toBeGreaterThan(700);
        expect(short(1.2)).toBeGreaterThan(2500);

        for (const ratio of [1.1, 1.2, 1.25, 1.5, 1.75, 2, 2.625, 3]) {
            for (const scale of EXACT_STEPS) {
                const left = 44;
                const top = 72;
                const mapping = createViewMapping(
                    frame({ scale, ratio, left, top, origin: [100, 60] }),
                );
                const cornerX = Math.round(left * ratio);
                const cornerY = Math.round(top * ratio);
                // The mouse on every device pixel of a row and of a column of the element.
                for (let device = 0; device < 2048; device++) {
                    const x = reported(cornerX + device, ratio);
                    const y = reported(cornerY + device, ratio);
                    const pixel = mapping.clientToDoc(x, y);
                    const expected = {
                        x: Math.floor((device - 100) / scale),
                        y: Math.floor((device - 60) / scale),
                    };
                    if (pixel.x !== expected.x || pixel.y !== expected.y) {
                        expect({ scale, ratio, device, x, y, pixel }).toEqual(expected);
                    }
                    const at = mapping.clientToDevice(x, y);
                    if (at.x !== device || at.y !== device) {
                        expect({ scale, ratio, device, at }).toBe("the device pixel");
                    }
                }
            }
        }
    });

    it("the three functions of the ticket give what the mapping gives", () => {
        const candidate = frame({ scale: 12, ratio: 1.5, left: 44, top: 72, origin: [40, 24] });
        const mapping = createViewMapping(candidate);
        expect(docToClient(candidate, 3, 2)).toEqual(mapping.docToClient(3, 2));
        expect(docToDevice(candidate, 3, 2)).toEqual(mapping.docToDevice(3, 2));
        const client = docToClient(candidate, 3, 2);
        expect(clientToDoc(candidate, client.x, client.y)).toEqual({ x: 3, y: 2 });
    });
});

describe("clientToDoc", () => {
    it("gives the same pixel for every device pixel of a texel, and the next one after it", () => {
        for (const candidate of exactFrames()) {
            const mapping = createViewMapping(candidate);
            const { scale } = candidate.view;
            const corner = mapping.docToDevice(5, 9);
            for (const offset of [0, 0.5, scale - 1, scale - 0.5, scale - 0.25]) {
                const client = mapping.deviceToClient(corner.x + offset, corner.y + offset);
                expect(mapping.clientToDoc(client.x, client.y)).toEqual({ x: 5, y: 9 });
            }
            const next = mapping.deviceToClient(corner.x + scale, corner.y + scale);
            expect(mapping.clientToDoc(next.x, next.y)).toEqual({ x: 6, y: 10 });
            const before = mapping.deviceToClient(corner.x - 0.5, corner.y - 0.5);
            expect(mapping.clientToDoc(before.x, before.y)).toEqual({ x: 4, y: 8 });
        }
    });

    it("takes a position within 1/128 of a device pixel as that pixel, and no further", () => {
        const mapping = createViewMapping(frame({ scale: 1, origin: [10, 20] }));
        // Noise below the pixel's edge: still the pixel, not the one before it.
        expect(mapping.clientToDoc(15 - 1 / 256, 25 - 1 / 256)).toEqual({ x: 5, y: 5 });
        expect(mapping.clientToDevice(15 - 1 / 256, 25 + 1 / 256)).toEqual({ x: 15, y: 25 });
        // A sixty-fourth of a device pixel is a position, not noise.
        expect(mapping.clientToDoc(15 - 1 / 64, 25 - 1 / 64)).toEqual({ x: 4, y: 4 });
        expect(mapping.clientToDevice(15 - 1 / 64, 25 + 1 / 64)).toEqual({
            x: 15 - 1 / 64,
            y: 25 + 1 / 64,
        });
    });

    it("gives whole numbers outside the document as well, and says what is inside", () => {
        const mapping = createViewMapping(frame({ scale: 8, origin: [40, 24] }));
        expect(mapping.clientToDoc(39, 23)).toEqual({ x: -1, y: -1 });
        expect(mapping.clientToDoc(0, 0)).toEqual({ x: -5, y: -3 });
        expect(mapping.clientToDoc(40 + 37 * 8, 24 + 21 * 8)).toEqual({ x: 37, y: 21 });
        expect(mapping.contains({ x: 0, y: 0 })).toBe(true);
        expect(mapping.contains({ x: 36, y: 20 })).toBe(true);
        expect(mapping.contains({ x: 37, y: 20 })).toBe(false);
        expect(mapping.contains({ x: 36, y: 21 })).toBe(false);
        expect(mapping.contains({ x: -1, y: 0 })).toBe(false);
        expect(mapping.contains({ x: 0, y: -1 })).toBe(false);
    });

    it("is the floor of the exact position, whose fraction lies inside the pixel", () => {
        const mapping = createViewMapping(
            frame({ scale: 16, ratio: 2, left: 44, top: 72, origin: [10, 20] }),
        );
        // Client (60, 100) is device (32, 56): 22 and 36 device pixels into the document.
        expect(mapping.clientToDevice(60, 100)).toEqual({ x: 32, y: 56 });
        expect(mapping.clientToDocExact(60, 100)).toEqual({ x: 22 / 16, y: 36 / 16 });
        expect(mapping.clientToDoc(60, 100)).toEqual({ x: 1, y: 2 });
        expect(mapping.deviceToDoc(10, 20)).toEqual({ x: 0, y: 0 });
    });
});

describe("docToDevice", () => {
    it("is origin + position × scale: whole device pixels at every step ≥ 1", () => {
        for (const candidate of exactFrames()) {
            const { scale, originX, originY } = candidate.view;
            const mapping = createViewMapping(candidate);
            for (const x of WHOLE) {
                const device = mapping.docToDevice(x, -x);
                expect(device).toEqual({ x: originX + x * scale, y: originY - x * scale });
                expect(Number.isInteger(device.x) && Number.isInteger(device.y)).toBe(true);
            }
        }
    });

    it("does not depend on the ratio or on where the element lies", () => {
        const at = (ratio: number, left: number, top: number) =>
            docToDevice(frame({ scale: 6, ratio, left, top, origin: [30, 18] }), 4, 5);
        expect(at(1, 0, 0)).toEqual({ x: 54, y: 48 });
        expect(at(1.5, 44, 72)).toEqual({ x: 54, y: 48 });
        expect(at(2, 301, 187)).toEqual({ x: 54, y: 48 });
    });

    it("maps the document's corners onto the engine's document rectangle at every step", () => {
        for (const scale of ZOOM_STEPS) {
            for (const [docWidth, docHeight] of [
                [1, 1],
                [5, 3],
                [33, 32],
                [255, 256],
                [1024, 1023],
            ] as const) {
                for (const [originX, originY] of ORIGINS) {
                    const view = { scale, originX, originY };
                    const mapping = createViewMapping({
                        view,
                        docWidth,
                        docHeight,
                        ratio: 1.5,
                        left: 45,
                        top: 73,
                    });
                    const rect = documentRect(view, docWidth, docHeight);
                    expect(mapping.rect).toEqual(rect);
                    expect(mapping.docToDevice(0, 0)).toEqual({ x: rect.x, y: rect.y });
                    expect(mapping.docToDevice(docWidth, docHeight)).toEqual({
                        x: rect.x + rect.width,
                        y: rect.y + rect.height,
                    });
                }
            }
        }
    });

    it("keeps every device pixel of the rectangle inside the document at the overview steps", () => {
        for (const scale of ZOOM_STEPS.filter((step) => step < 1)) {
            const view = { scale, originX: 12, originY: -5 };
            const mapping = createViewMapping({
                view,
                docWidth: 33,
                docHeight: 5,
                ratio: 1,
                left: 0,
                top: 0,
            });
            const { rect } = mapping;
            for (let y = rect.y; y < rect.y + rect.height; y++) {
                for (let x = rect.x; x < rect.x + rect.width; x++) {
                    expect(mapping.contains(mapping.clientToDoc(x, y))).toBe(true);
                }
            }
            expect(mapping.contains(mapping.clientToDoc(rect.x - 1, rect.y))).toBe(false);
            expect(mapping.contains(mapping.clientToDoc(rect.x + rect.width, rect.y))).toBe(false);
            expect(mapping.contains(mapping.clientToDoc(rect.x, rect.y + rect.height))).toBe(false);
        }
    });
});

describe("docToClient", () => {
    it("is the device position over the ratio, from the element's corner", () => {
        const mapping = createViewMapping(
            frame({ scale: 8, ratio: 2, left: 44, top: 72, origin: [40, 24] }),
        );
        // Device (40 + 3·8, 24 + 2·8) = (64, 40); the element starts at device (88, 144).
        expect(mapping.docToClient(3, 2)).toEqual({ x: (88 + 64) / 2, y: (144 + 40) / 2 });
        expect(mapping.deviceToClient(0, 0)).toEqual({ x: 44, y: 72 });
    });

    it("takes the element's corner on whole device pixels, where the browser lays it out", () => {
        // 45 CSS pixels at 1.5 are 67.5 device pixels: the box starts at device pixel 68.
        const mapping = createViewMapping(frame({ scale: 4, ratio: 1.5, left: 45, top: 73 }));
        expect(mapping.clientToDevice(68 / 1.5, 110 / 1.5)).toEqual({ x: 0, y: 0 });
        expect(mapping.deviceToClient(0, 0)).toEqual({ x: 68 / 1.5, y: 110 / 1.5 });
        expect(mapping.clientToDoc(68 / 1.5, 110 / 1.5)).toEqual({ x: 0, y: 0 });
        expect(mapping.clientToDoc(67 / 1.5, 109 / 1.5)).toEqual({ x: -1, y: -1 });
    });

    it("takes a ratio that is not a positive number as 1", () => {
        for (const ratio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
            const mapping = createViewMapping(frame({ scale: 2, ratio, left: 10, top: 20 }));
            expect(mapping.docToClient(3, 4)).toEqual({ x: 16, y: 28 });
        }
    });
});
