import { describe, expect, it } from "vitest";
import { axesOf } from "../../src/app/overlay/gridLines";
import { antsRing, isDarkDash, ringArea, ringBounds } from "../../src/app/selection/antsGeometry";
import { createRingPainter } from "../../src/app/selection/ringPainter";
import type { RingPainter, RingSource } from "../../src/app/selection/ringPainter";
import type { BitMask } from "../../src/core/model";
import { maskBounds, selectionBoundary } from "../../src/core/selection";
import type { DeviceRect } from "../../src/engine/viewport/geometry";
import { maskOf, randomMask, seeded } from "./se-030-support";
import { fakeOverlay, surfaceMaker } from "./se-031-support";
import type { CallLog } from "./se-031-support";

// SE-031 review (B): the ring of the ants on a pan. The surface covers the selection's bounds
// grown by 1 pixel, cut to the canvas (`ringBounds`, constant time); a pan (the same mask,
// zoom and canvas size, the document moved by whole pixels) moves the pixels kept and paints
// only the strips it uncovered; a zoom, a resize or a pan past the surface paints afresh.
// After every step of random pans the painter kept across them must hold and draw exactly what
// a fresh painter does at the same view, on a 256² checkerboard and on random masks.

type Size = { width: number; height: number };
type View = { scale: number; originX: number; originY: number };

function checkerboard(side: number): BitMask {
    const rows: string[] = [];
    for (let y = 0; y < side; y++) {
        let row = "";
        for (let x = 0; x < side; x++) row += (x + y) % 2 === 0 ? "#" : ".";
        rows.push(row);
    }
    return maskOf(rows);
}

function sourceOf(mask: BitMask): RingSource {
    const bounds = maskBounds(mask);
    if (!bounds) throw new Error("an empty mask");
    let boundary: ReturnType<typeof selectionBoundary> | null = null;
    return { key: mask, bounds, boundary: () => (boundary ??= selectionBoundary(mask)) };
}

function rectOf(mask: BitMask, view: View): DeviceRect {
    return {
        x: view.originX,
        y: view.originY,
        width: mask.width * view.scale,
        height: mask.height * view.scale,
    };
}

/** A painter on fake surfaces, and a draw that returns the overlay's pixels and the calls made. */
function painterFor(source: RingSource, doc: Size) {
    const log: CallLog = [];
    const surfaces = surfaceMaker(log);
    const painter: RingPainter = createRingPainter(surfaces.make);
    const draw = (rect: DeviceRect, size: Size, phase = 0) => {
        const overlay = fakeOverlay(size, log);
        const from = log.length;
        painter.draw(overlay.context, source, { rect, doc, size }, phase);
        return { pixels: overlay.pixels, calls: log.slice(from) };
    };
    return { painter, draw, log };
}

/** The first differing pixel of two images, as text; null when they are equal. */
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number): string | null {
    for (let index = 0; index < a.length; index += 4) {
        for (let channel = 0; channel < 4; channel++) {
            if (a[index + channel] !== b[index + channel]) {
                const pixel = index / 4;
                return `${pixel % width}, ${Math.floor(pixel / width)}: ${Array.from(a.slice(index, index + 4))} not ${Array.from(b.slice(index, index + 4))}`;
            }
        }
    }
    return a.length === b.length ? null : "sizes differ";
}

/** What the overlay must show: the ring of `mask` at `rect`, dark where `isDarkDash`. */
function expectedOverlay(mask: BitMask, rect: DeviceRect, size: Size, phase: number) {
    const pixels = new Uint8ClampedArray(size.width * size.height * 4);
    for (const run of antsRing(selectionBoundary(mask), axesOf(rect, mask, size), size)) {
        for (let y = run.y; y < run.y + run.height; y++) {
            for (let x = run.x; x < run.x + run.width; x++) {
                const value = isDarkDash(x, y, phase) ? 0 : 255;
                pixels.set([value, value, value, 255], (y * size.width + x) * 4);
            }
        }
    }
    return pixels;
}

describe("the surface's area", () => {
    it("is the selection's device bounds grown by 1 pixel, cut to the canvas, and holds the whole ring", () => {
        const random = seeded(31031);
        for (let round = 0; round < 200; round++) {
            const mask = randomMask(
                1 + Math.floor(random() * 14),
                1 + Math.floor(random() * 10),
                0.2 + random() * 0.6,
                random,
            );
            const bounds = maskBounds(mask);
            if (!bounds) continue;
            const scale = [0.5, 1, 2, 3, 4, 8][Math.floor(random() * 6)]!;
            const rect = {
                x: Math.floor(random() * 80) - 30,
                y: Math.floor(random() * 60) - 25,
                width: Math.round(mask.width * scale),
                height: Math.round(mask.height * scale),
            };
            const size = { width: 50, height: 37 };
            const axes = axesOf(rect, mask, size);
            const area = ringBounds(bounds, axes, size);
            const ring = ringArea(selectionBoundary(mask), axes, size);
            if (!ring) continue;
            // The ring's own bounding rectangle lies in the area.
            expect(area, `round ${round}`).not.toBeNull();
            expect(ring.x >= area!.x && ring.y >= area!.y, `round ${round}`).toBe(true);
            expect(ring.x + ring.width <= area!.x + area!.width, `round ${round}`).toBe(true);
            expect(ring.y + ring.height <= area!.y + area!.height, `round ${round}`).toBe(true);
            if (scale >= 1) {
                // At 1× and above it is exactly the grown device bounds on the canvas.
                const x0 = Math.max(0, rect.x + bounds.x * scale - 1);
                const y0 = Math.max(0, rect.y + bounds.y * scale - 1);
                const x1 = Math.min(size.width, rect.x + (bounds.x + bounds.width) * scale + 1);
                const y1 = Math.min(size.height, rect.y + (bounds.y + bounds.height) * scale + 1);
                expect(area).toEqual({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
            }
        }
    });
});

describe("a pan", () => {
    /** Random pans of `mask` at `scale` on `size`, compared with a fresh painter at each step. */
    function pans(mask: BitMask, scale: number, size: Size, seed: number, steps: number) {
        const random = seeded(seed);
        const source = sourceOf(mask);
        const kept = painterFor(source, mask);
        let view: View = {
            scale,
            originX: Math.floor(random() * size.width) - Math.floor(size.width / 3),
            originY: Math.floor(random() * size.height) - Math.floor(size.height / 3),
        };
        const work: string[] = [];
        kept.draw(rectOf(mask, view), size);
        for (let step = 0; step < steps; step++) {
            const reach = kept.painter.kept?.area.width ?? size.width;
            const choices = [1, 2, 3, 7, reach - 1, reach, reach + 4, size.width + 20];
            const pick = () =>
                (random() < 0.5 ? -1 : 1) * choices[Math.floor(random() * choices.length)]!;
            view = { ...view, originX: view.originX + pick(), originY: view.originY + pick() };
            // Now and then back across the document's edge and into the canvas.
            if (random() < 0.15)
                view = { ...view, originX: -Math.floor((mask.width * scale) / 2), originY: 3 };
            const rect = rectOf(mask, view);
            const phase = step % 4;
            const panned = kept.draw(rect, size, phase);
            work.push(kept.painter.last.work);
            const fresh = painterFor(source, mask);
            const afresh = fresh.draw(rect, size, phase);
            const label = `seed ${seed}, step ${step}, view ${JSON.stringify(view)}`;
            expect(kept.painter.kept?.area ?? null, label).toEqual(
                fresh.painter.kept?.area ?? null,
            );
            if (kept.painter.kept && fresh.painter.kept) {
                expect(
                    difference(
                        kept.painter.kept.pixels,
                        fresh.painter.kept.pixels,
                        kept.painter.kept.area.width,
                    ),
                    label,
                ).toBeNull();
            }
            expect(difference(panned.pixels, afresh.pixels, size.width), label).toBeNull();
        }
        return work;
    }

    it("keeps exactly what a fresh painter paints, over random pans of a 256² checkerboard", () => {
        const work = pans(checkerboard(256), 1, { width: 300, height: 280 }, 256, 40);
        // Both ways were taken: moved, and painted afresh after a pan past the surface.
        expect(work.filter((entry) => entry === "moved").length).toBeGreaterThan(5);
        expect(work.filter((entry) => entry === "painted").length).toBeGreaterThan(5);
    });

    it("keeps exactly what a fresh painter paints, over random pans of random masks at every zoom", () => {
        const random = seeded(3031);
        let moved = 0;
        for (let round = 0; round < 40; round++) {
            const mask = randomMask(
                2 + Math.floor(random() * 14),
                2 + Math.floor(random() * 10),
                0.2 + random() * 0.6,
                random,
            );
            if (!maskBounds(mask)) continue;
            const scale = [1, 2, 3, 4, 5, 8][Math.floor(random() * 6)]!;
            const work = pans(mask, scale, { width: 70, height: 53 }, 1000 + round, 25);
            moved += work.filter((entry) => entry === "moved").length;
        }
        expect(moved).toBeGreaterThan(100);
    });

    it("draws the ring and the dashes after a pan, as SE-030's oracle says", () => {
        const mask = maskOf([
            "..........",
            ".####.....",
            ".#..#.#...",
            ".####.....",
            ".......##.",
            "#......##.",
        ]);
        const size = { width: 90, height: 70 };
        const { draw, painter } = painterFor(sourceOf(mask), mask);
        let rect = rectOf(mask, { scale: 4, originX: 5, originY: 6 });
        draw(rect, size, 1);
        for (const [dx, dy] of [
            [3, 1],
            [-7, 4],
            [0, -2],
            [-20, 0],
        ] as const) {
            rect = { ...rect, x: rect.x + dx, y: rect.y + dy };
            const { pixels } = draw(rect, size, 1);
            expect(painter.last.work).toBe("moved");
            expect(difference(pixels, expectedOverlay(mask, rect, size, 1), size.width)).toBeNull();
        }
    });

    it("of 3 px walks under 2% of the runs a full paint walks", () => {
        // The checkerboard covers the canvas, so the pan uncovers a strip along two sides.
        const mask = checkerboard(256);
        const size = { width: 600, height: 500 };
        const { draw, painter } = painterFor(sourceOf(mask), mask);
        const rect = rectOf(mask, { scale: 4, originX: -100, originY: -80 });
        draw(rect, size);
        expect(painter.last.work).toBe("painted");
        expect(painter.kept?.area).toEqual({ x: 0, y: 0, ...size });
        const panned = { ...rect, x: rect.x + 3, y: rect.y + 3 };
        draw(panned, size);
        expect(painter.last.work).toBe("moved");
        const moved = painter.last.runs;
        // A full paint of the same view, for comparison.
        const fresh = painterFor(sourceOf(mask), mask);
        fresh.draw(panned, size);
        const full = fresh.painter.last.runs;
        expect(full).toBeGreaterThan(20_000);
        expect(moved).toBeGreaterThan(0);
        expect(moved / full).toBeLessThan(0.02);
        // And a pan that keeps the whole selection on the canvas paints nothing at all.
        const whole = painterFor(sourceOf(mask), mask);
        const inside = rectOf(mask, { scale: 4, originX: 20, originY: 20 });
        whole.draw(inside, { width: 1100, height: 1100 });
        whole.draw({ ...inside, x: 23, y: 17 }, { width: 1100, height: 1100 });
        expect(whole.painter.last).toEqual({ work: "moved", runs: 0 });
    });

    it("paints afresh at a zoom or a resize, and when it goes past the surface; keeps the ring when nothing changed", () => {
        const mask = checkerboard(16);
        const size = { width: 100, height: 90 };
        const { draw, painter } = painterFor(sourceOf(mask), mask);
        const rect = rectOf(mask, { scale: 2, originX: 10, originY: 12 });
        expect(draw(rect, size).calls).toContain("putImageData");
        expect(painter.last.work).toBe("painted");
        expect(draw(rect, size).calls).toEqual(["drawImage"]);
        expect(painter.last.work).toBe("kept");
        draw({ ...rect, x: rect.x + 2 }, size);
        expect(painter.last.work).toBe("moved");
        // Zoom: the document's device size changes.
        draw(rectOf(mask, { scale: 3, originX: 12, originY: 12 }), size);
        expect(painter.last.work).toBe("painted");
        // Resize: the canvas's size changes.
        draw(rectOf(mask, { scale: 3, originX: 12, originY: 12 }), { width: 101, height: 90 });
        expect(painter.last.work).toBe("painted");
        // Past the surface: the right edge of the document at the canvas's left edge, then
        // moved 101 pixels on: nothing kept is where the ring now is.
        draw(rectOf(mask, { scale: 3, originX: -40, originY: 12 }), { width: 101, height: 90 });
        expect(painter.last.work).toBe("moved");
        draw(rectOf(mask, { scale: 3, originX: -40 + 101, originY: 12 }), {
            width: 101,
            height: 90,
        });
        expect(painter.last.work).toBe("painted");
        // Off the canvas: nothing to draw, no call.
        expect(
            draw(rectOf(mask, { scale: 3, originX: 500, originY: 12 }), { width: 101, height: 90 })
                .calls,
        ).toEqual([]);
        expect(painter.last.work).toBe("none");
    });
});
