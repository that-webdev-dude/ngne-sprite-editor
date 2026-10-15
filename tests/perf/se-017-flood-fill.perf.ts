import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { createPixelBuffer } from "../../src/core/pixels";
import { floodMask, paintInk, paintMask } from "../../src/core/raster";
import { record } from "./record";

// SE-017 acceptance: a flood fill of a 1024×1024 empty canvas completes in ≤ 100 ms. The fill
// is what the paint bucket does at the press: the flood mask of the pixel clicked (contiguous,
// tolerance 0, sampled from the layer) and the ink written into every pixel of it. Measured and
// recorded, not asserted (SPEC §11); the orchestrator records the number.

const SIDE = 1024;
const BUDGET_MS = 100;
const RUNS = 20;

it("fills a 1024×1024 empty canvas", () => {
    const ink = paintInk("simple", 0x336699ff, 255);
    // No warm-up: the first fill is the cold one a user makes once, and it counts.
    const samples: number[] = [];
    const floodSamples: number[] = [];
    for (let run = 0; run < RUNS; run++) {
        const image = createPixelBuffer(SIDE, SIDE);
        const start = performance.now();
        const mask = floodMask(image, { x: 517, y: 301 }, { tolerance: 0, contiguous: true });
        const flooded = performance.now();
        const changed = paintMask(image, image, mask, ink);
        samples.push(performance.now() - start);
        floodSamples.push(flooded - start);
        // The benchmark ran the real thing: every pixel was taken and painted.
        expect(changed).toEqual({ x: 0, y: 0, width: SIDE, height: SIDE });
        expect(mask.data.every((byte) => byte === 0xff)).toBe(true);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const floods = [...floodSamples].sort((a, b) => a - b);
    record({
        id: "se-017-flood-fill",
        ticket: "SE-017",
        measurement:
            `floodMask (contiguous, tolerance 0) of a transparent ${SIDE}×${SIDE} image from one ` +
            "pixel, then paintMask writing simple ink into every pixel of the mask, Node",
        statistic: `slowest of ${RUNS} consecutive fills, the first (cold) one included`,
        budgetMs: BUDGET_MS,
        resultMs: sorted[sorted.length - 1]!,
        details: {
            runs: RUNS,
            minMs: sorted[0],
            medianMs: (sorted[RUNS / 2 - 1]! + sorted[RUNS / 2]!) / 2,
            maxMs: sorted[sorted.length - 1],
            firstMs: samples[0],
            floodMaskMaxMs: floods[floods.length - 1],
            floodMaskMedianMs: (floods[RUNS / 2 - 1]! + floods[RUNS / 2]!) / 2,
            samplesMs: samples,
        },
    });
});
