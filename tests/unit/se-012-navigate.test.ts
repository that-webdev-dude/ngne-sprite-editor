import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    clampView,
    fitView,
    MIN_VISIBLE,
    panView,
    scaledSize,
    viewportCentre,
    visibleExtent,
    zoomView,
} from "../../src/app/view/navigate";
import {
    createWheelPan,
    createWheelZoom,
    WHEEL_PAUSE_MS,
    WHEEL_ZOOM_TRAVEL,
    wheelPixels,
} from "../../src/app/view/wheel";
import {
    fitZoom,
    KEY_ZOOMS,
    MAX_ZOOM,
    MIN_ZOOM,
    scaledLength,
    ZOOM_STEPS,
    zoomStep,
    zoomStepAbove,
    zoomStepBelow,
} from "../../src/app/view/zoom";
import { documentRect } from "../../src/engine/viewport/geometry";

// SE-012: zoom steps, pan limits, zoom about a point and fit — the arithmetic of view
// navigation, in device pixels of the viewport element.

const spec = readFileSync(new URL("../../docs/SPEC.md", import.meta.url), "utf8").replace(
    /\r/g,
    "",
);

const EXACT_STEPS = ZOOM_STEPS.filter((step) => step >= 1);
const VIEWPORT = { width: 972, height: 424 };

describe("zoom steps (SPEC §6.4)", () => {
    it("are the steps the SPEC lists, with the three overview steps below them", () => {
        const section = spec.slice(spec.indexOf("### 6.4 Viewport"), spec.indexOf("### 6.5 "));
        const listed = /sprite pixel: ([\d,\s]+)\. At these steps/.exec(section)?.[1];
        const steps = (listed ?? "").split(",").map((step) => Number(step.trim()));
        expect(steps).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64]);
        expect(section).toMatch(/Steps\s+1\/2, 1\/4 and 1\/8 exist for overview only/);
        expect(ZOOM_STEPS).toEqual([1 / 8, 1 / 4, 1 / 2, ...steps]);
        expect([MIN_ZOOM, MAX_ZOOM]).toEqual([1 / 8, 64]);
    });

    it("step in and out through the whole list, and stop at its ends", () => {
        for (let index = 0; index < ZOOM_STEPS.length; index++) {
            const step = ZOOM_STEPS[index] ?? 0;
            expect(zoomStepAbove(step)).toBe(ZOOM_STEPS[index + 1] ?? MAX_ZOOM);
            expect(zoomStepBelow(step)).toBe(ZOOM_STEPS[index - 1] ?? MIN_ZOOM);
            expect(zoomStep(step, 1)).toBe(zoomStepAbove(step));
            expect(zoomStep(step, -1)).toBe(zoomStepBelow(step));
        }
        expect(zoomStepAbove(64)).toBe(64);
        expect(zoomStepBelow(1 / 8)).toBe(1 / 8);
    });

    it("step from a scale that is no step to the neighbouring steps", () => {
        expect([zoomStepBelow(7), zoomStepAbove(7)]).toEqual([6, 8]);
        expect([zoomStepBelow(0.3), zoomStepAbove(0.3)]).toEqual([0.25, 0.5]);
        expect([zoomStepBelow(100), zoomStepAbove(100)]).toEqual([64, 64]);
        expect([zoomStepBelow(0.01), zoomStepAbove(0.01)]).toEqual([1 / 8, 1 / 8]);
    });

    it("the keys 1 to 6 are 1×, 2×, 4×, 8×, 16× and 32×, each a zoom step", () => {
        expect(spec).toContain("| Zoom 1×, 2×, 4×, 8×, 16×, 32× ");
        expect(KEY_ZOOMS).toEqual([1, 2, 4, 8, 16, 32]);
        for (const zoom of KEY_ZOOMS) expect(ZOOM_STEPS).toContain(zoom);
    });

    it("a scaled side is the side of the engine's document rectangle", () => {
        for (const scale of ZOOM_STEPS) {
            for (const length of [1, 3, 5, 33, 255, 1024]) {
                const rect = documentRect({ scale, originX: 0, originY: 0 }, length, 1);
                expect(scaledLength(length, scale)).toBe(rect.width);
            }
        }
        expect(scaledSize({ width: 5, height: 3 }, 0.125)).toEqual({ width: 1, height: 1 });
    });
});

describe("fit (SPEC §6.4: the largest zoom step that fits, centred)", () => {
    it("picks the largest step at which the document lies inside the viewport", () => {
        expect(fitZoom(32, 32, 972, 424)).toBe(12);
        expect(fitZoom(32, 32, 384, 384)).toBe(12);
        // Exactly as large as the viewport still fits.
        expect(fitZoom(32, 32, 512, 512)).toBe(16);
        expect(fitZoom(32, 32, 511, 512)).toBe(12);
        expect(fitZoom(8, 8, 972, 424)).toBe(48);
        expect(fitZoom(1, 1, 972, 424)).toBe(64);
        expect(fitZoom(256, 256, 972, 424)).toBe(1);
        expect(fitZoom(1024, 1024, 972, 424)).toBe(0.25);
        expect(fitZoom(1024, 16, 972, 424)).toBe(0.5);
    });

    it("picks the smallest step for a document that fits at none", () => {
        expect(fitZoom(1024, 1024, 100, 100)).toBe(1 / 8);
        expect(fitZoom(8, 8, 0, 0)).toBe(1 / 8);
    });

    it("no larger step fits, for every document and viewport", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1024 }),
                fc.integer({ min: 1, max: 1024 }),
                fc.integer({ min: 130, max: 4000 }),
                fc.integer({ min: 130, max: 4000 }),
                (width, height, viewWidth, viewHeight) => {
                    const viewport = { width: viewWidth, height: viewHeight };
                    const view = fitView({ width, height }, viewport);
                    const size = scaledSize({ width, height }, view.scale);
                    expect(ZOOM_STEPS).toContain(view.scale);
                    // It fits …
                    expect(size.width).toBeLessThanOrEqual(viewWidth);
                    expect(size.height).toBeLessThanOrEqual(viewHeight);
                    // … the next step does not …
                    if (view.scale < MAX_ZOOM) {
                        const larger = scaledSize({ width, height }, zoomStepAbove(view.scale));
                        expect(larger.width > viewWidth || larger.height > viewHeight).toBe(true);
                    }
                    // … and it is centred, to the device pixel, and whole.
                    const right = viewWidth - (view.originX + size.width);
                    const bottom = viewHeight - (view.originY + size.height);
                    expect(right - view.originX === 0 || right - view.originX === 1).toBe(true);
                    expect(bottom - view.originY === 0 || bottom - view.originY === 1).toBe(true);
                    expect(Number.isInteger(view.originX) && Number.isInteger(view.originY)).toBe(
                        true,
                    );
                    // A fitted view is inside the pan limits.
                    expect(clampView(view, { width, height }, viewport)).toBe(view);
                },
            ),
            { numRuns: 500 },
        );
    });

    it("centres a 32×32 document at 12× in a 972×424 viewport", () => {
        expect(fitView({ width: 32, height: 32 }, VIEWPORT)).toEqual({
            scale: 12,
            originX: 294,
            originY: 20,
        });
        expect(viewportCentre(VIEWPORT)).toEqual({ x: 486, y: 212 });
    });
});

describe("pan limits: at least 32 device pixels of the document stay visible", () => {
    const doc = { width: 32, height: 32 };

    it("is 32 device pixels", () => {
        expect(MIN_VISIBLE).toBe(32);
    });

    it("stops the document 32 device pixels inside each edge of the viewport", () => {
        const far = 100_000;
        // 32 × 8 = 256 device pixels a side.
        expect(panView({ scale: 8, originX: 0, originY: 0 }, -far, -far, doc, VIEWPORT)).toEqual({
            scale: 8,
            originX: 32 - 256,
            originY: 32 - 256,
        });
        expect(panView({ scale: 8, originX: 0, originY: 0 }, far, far, doc, VIEWPORT)).toEqual({
            scale: 8,
            originX: 972 - 32,
            originY: 424 - 32,
        });
        expect(visibleExtent({ scale: 8, originX: -224, originY: 392 }, doc, VIEWPORT)).toEqual({
            width: 32,
            height: 32,
        });
    });

    it("keeps a document smaller than 32 device pixels visible in full", () => {
        const small = { width: 8, height: 5 };
        const view = { scale: 2, originX: 100, originY: 100 };
        expect(panView(view, -100_000, 100_000, small, VIEWPORT)).toEqual({
            scale: 2,
            originX: 0,
            originY: 424 - 10,
        });
        expect(panView(view, 100_000, -100_000, small, VIEWPORT)).toEqual({
            scale: 2,
            originX: 972 - 16,
            originY: 0,
        });
    });

    it("moves by the distance asked for while inside the limits, and returns the same view for none", () => {
        const view = { scale: 4, originX: 100, originY: 50 };
        expect(panView(view, 17, -9, doc, VIEWPORT)).toEqual({
            scale: 4,
            originX: 117,
            originY: 41,
        });
        expect(panView(view, 0, 0, doc, VIEWPORT)).toBe(view);
        expect(clampView(view, doc, VIEWPORT)).toBe(view);
    });

    it("gives whole origins", () => {
        expect(clampView({ scale: 4, originX: 10.4, originY: -3.5 }, doc, VIEWPORT)).toEqual({
            scale: 4,
            originX: 10,
            originY: -3,
        });
    });

    it("limits nothing while the viewport has no size", () => {
        const view = { scale: 4, originX: -9000, originY: 9000 };
        expect(clampView(view, doc, { width: 0, height: 0 })).toBe(view);
    });

    it("holds after any pan and any zoom, for every document, viewport and step", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1024 }),
                fc.integer({ min: 1, max: 1024 }),
                fc.integer({ min: 1, max: 3000 }),
                fc.integer({ min: 1, max: 3000 }),
                fc.constantFrom(...ZOOM_STEPS),
                fc.constantFrom(...ZOOM_STEPS),
                fc.integer({ min: -200_000, max: 200_000 }),
                fc.integer({ min: -200_000, max: 200_000 }),
                (width, height, viewWidth, viewHeight, from, to, dx, dy) => {
                    const size = { width, height };
                    const viewport = { width: viewWidth, height: viewHeight };
                    const check = (view: { scale: number; originX: number; originY: number }) => {
                        const shown = visibleExtent(view, size, viewport);
                        const drawn = scaledSize(size, view.scale);
                        expect(shown.width).toBeGreaterThanOrEqual(
                            Math.min(MIN_VISIBLE, drawn.width, viewWidth),
                        );
                        expect(shown.height).toBeGreaterThanOrEqual(
                            Math.min(MIN_VISIBLE, drawn.height, viewHeight),
                        );
                        expect(Number.isInteger(view.originX)).toBe(true);
                        expect(Number.isInteger(view.originY)).toBe(true);
                    };
                    const panned = panView(
                        { scale: from, originX: 0, originY: 0 },
                        dx,
                        dy,
                        size,
                        viewport,
                    );
                    check(panned);
                    // A zoom about a point far from the document pushes it away from there.
                    check(zoomView(panned, to, { x: dx, y: dy }, size, viewport));
                    check(zoomView(panned, to, viewportCentre(viewport), size, viewport));
                },
            ),
            { numRuns: 1000 },
        );
    });
});

describe("zoom about a point", () => {
    const doc = { width: 64, height: 48 };
    const big = { width: 4000, height: 3000 };
    /** The document pixel under a device position. */
    const pixelAt = (view: { scale: number; originX: number; originY: number }, at: number[]) => [
        Math.floor(((at[0] ?? 0) - view.originX) / view.scale),
        Math.floor(((at[1] ?? 0) - view.originY) / view.scale),
    ];

    it("keeps the document pixel under the anchor for every pair of steps ≥ 1", () => {
        // Anchors on whole device pixels and on halves (a ratio of 1.5), over the document.
        for (const anchor of [
            [700, 500],
            [701.5, 499.5],
            [1203, 911],
            [640.5, 760],
        ]) {
            for (const from of EXACT_STEPS) {
                for (const to of EXACT_STEPS) {
                    // The document under the anchor, wherever its pixel boundary falls.
                    for (const shift of [0, 1, from - 1, Math.floor(from / 2)]) {
                        const view = {
                            scale: from,
                            originX: Math.floor(anchor[0] ?? 0) - 20 * from - shift,
                            originY: Math.floor(anchor[1] ?? 0) - 31 * from - shift,
                        };
                        const next = zoomView(
                            view,
                            to,
                            { x: anchor[0] ?? 0, y: anchor[1] ?? 0 },
                            doc,
                            big,
                        );
                        expect(next.scale).toBe(to);
                        if (
                            pixelAt(next, anchor)[0] !== pixelAt(view, anchor)[0] ||
                            pixelAt(next, anchor)[1] !== pixelAt(view, anchor)[1]
                        ) {
                            expect({ from, to, anchor, view, next }).toBe("the same pixel");
                        }
                        // The origins stay whole: texels stay on device pixels.
                        expect(Number.isInteger(next.originX)).toBe(true);
                        expect(Number.isInteger(next.originY)).toBe(true);
                    }
                }
            }
        }
    });

    it("keeps the pixel for arbitrary anchors over the document, through a walk of steps", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 64, max: 7000 }),
                fc.integer({ min: 64, max: 5000 }),
                fc.constantFrom(0, 0.25, 0.5, 0.75),
                fc.integer({ min: 0, max: 63 }),
                fc.integer({ min: 0, max: 47 }),
                fc.integer({ min: 0, max: 63 }),
                fc.array(fc.constantFrom(...EXACT_STEPS), { minLength: 2, maxLength: 12 }),
                (anchorX, anchorY, fraction, pixelX, pixelY, inside, walk) => {
                    const anchor = { x: anchorX + fraction, y: anchorY + fraction };
                    const first = walk[0] ?? 1;
                    // The anchor lies `inside % first` device pixels into the pixel.
                    let view = {
                        scale: first,
                        originX: anchorX - pixelX * first - (inside % first),
                        originY: anchorY - pixelY * first - (inside % first),
                    };
                    const viewport = { width: 8000, height: 6000 };
                    expect(pixelAt(view, [anchor.x, anchor.y])).toEqual([pixelX, pixelY]);
                    for (const scale of walk.slice(1)) {
                        view = zoomView(view, scale, anchor, doc, viewport);
                        expect(view.scale).toBe(scale);
                        expect(pixelAt(view, [anchor.x, anchor.y])).toEqual([pixelX, pixelY]);
                    }
                },
            ),
            { numRuns: 1000 },
        );
    });

    it("keeps the position under the anchor to the device pixel, not only its pixel", () => {
        // 5.5 document pixels into the document at 8×: device 44 + origin.
        const view = { scale: 8, originX: 100, originY: 60 };
        const next = zoomView(view, 16, { x: 144, y: 104 }, doc, big);
        // (144 − origin) / 16 = 5.5 again.
        expect(next).toEqual({ scale: 16, originX: 56, originY: 16 });
        expect(zoomView(next, 8, { x: 144, y: 104 }, doc, big)).toEqual(view);
    });

    it("returns the view it was given when the scale does not change", () => {
        const view = { scale: 8, originX: 100, originY: 60 };
        expect(zoomView(view, 8, { x: 3, y: 4 }, doc, big)).toBe(view);
    });

    it("zooms through the overview steps about the anchor, with whole origins", () => {
        let view = { scale: 1, originX: 400, originY: 300 };
        const anchor = { x: 432, y: 324 };
        for (const scale of [0.5, 0.25, 0.125, 0.25, 0.5, 1]) {
            view = zoomView(view, scale, anchor, doc, big);
            expect(view.scale).toBe(scale);
            expect(Number.isInteger(view.originX) && Number.isInteger(view.originY)).toBe(true);
            // The document's middle stays within a device pixel of the anchor.
            const size = scaledSize(doc, scale);
            expect(Math.abs(view.originX + size.width / 2 - anchor.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(view.originY + size.height / 2 - anchor.y)).toBeLessThanOrEqual(1);
        }
    });

    it("applies the pan limits after the zoom", () => {
        // Zooming in about a point right of the document pushes it out to the left.
        const view = { scale: 1, originX: 100, originY: 100 };
        const next = zoomView(view, 64, { x: 900, y: 124 }, doc, VIEWPORT);
        expect(next.scale).toBe(64);
        expect(visibleExtent(next, doc, VIEWPORT).width).toBe(MIN_VISIBLE);
        expect(next.originX).toBe(MIN_VISIBLE - 64 * 64);
    });
});

describe("wheel travel", () => {
    it("one notch of a mouse wheel is one zoom step: up in, down out", () => {
        const zoom = createWheelZoom();
        expect(zoom(-100, 0)).toBe(1);
        expect(zoom(-100, 16)).toBe(1);
        expect(zoom(100, 32)).toBe(-1);
        expect(zoom(120, 5000)).toBe(-1);
        expect(zoom(-WHEEL_ZOOM_TRAVEL, 5001)).toBe(1);
        expect(zoom(0, 5002)).toBe(0);
        expect(zoom(Number.NaN, 5003)).toBe(0);
    });

    it("adds the small deltas of a touchpad up to one step, and never gives two", () => {
        const zoom = createWheelZoom();
        const steps = [];
        for (let event = 0; event < 10; event++) steps.push(zoom(-12, event * 16));
        // 5 × 12 = 60 reaches the travel of one step; the count starts again from there.
        expect(steps).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        expect(zoom(-5000, 200)).toBe(1);
    });

    it("forgets travel short of a step when the wheel turns back or pauses", () => {
        const zoom = createWheelZoom();
        expect(zoom(-40, 0)).toBe(0);
        // Turned back: the 40 are gone, 40 the other way is not a step either.
        expect(zoom(40, 10)).toBe(0);
        expect(zoom(40, 20)).toBe(-1);
        expect(zoom(-40, 30)).toBe(0);
        // A pause: the 40 are gone.
        expect(zoom(-40, 30 + WHEEL_PAUSE_MS + 1)).toBe(0);
        expect(zoom(-40, 30 + WHEEL_PAUSE_MS + 2)).toBe(1);
    });

    it("pans by whole device pixels and carries the fraction over", () => {
        const pan = createWheelPan();
        expect(pan(100, 1)).toBe(100);
        expect(pan(100, 1.5)).toBe(150);
        expect(pan(-33, 2)).toBe(-66);
        // 0.4, then 0.8 (one pixel, 0.2 too many), then 0.2.
        expect([pan(0.4, 1), pan(0.4, 1), pan(0.4, 1)]).toEqual([0, 1, 0]);
        // Ten events of 0.4 are four pixels, none of them lost.
        const slow = createWheelPan();
        const moved = Array.from({ length: 10 }, () => slow(0.4, 1));
        expect(moved.reduce((sum, distance) => sum + distance, 0)).toBe(4);
        expect(moved.every((distance) => distance === 0 || distance === 1)).toBe(true);
        const back = createWheelPan();
        expect([back(-0.4, 1), back(-0.4, 1), back(-0.4, 1)]).toEqual([0, -1, 0]);
        expect(pan(Number.NaN, 1)).toBe(0);
    });

    it("reads lines and pages as pixels", () => {
        expect(wheelPixels(3, 0)).toBe(3);
        expect(wheelPixels(3, 1)).toBe(48);
        expect(wheelPixels(1, 2)).toBe(800);
    });
});
