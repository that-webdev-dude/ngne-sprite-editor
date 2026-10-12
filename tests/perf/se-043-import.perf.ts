import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { runImport } from "../../src/core/import";
import type { ImportResult, ImportSettings } from "../../src/core/import";
import type { PixelBuffer } from "../../src/core/pixels";
import { record } from "./record";

// SE-043 acceptance: a 2048×2048 source reduced to 16 colours at 64×64 completes in ≤ 500 ms.
// Measured and recorded, not asserted (SPEC §11); the orchestrator records the number.

const SOURCE_SIDE = 2048;
const TARGET_SIDE = 64;
const COLORS = 16;
const BUDGET_MS = 500;
const RUNS = 20;

/**
 * An opaque, photo-like image: smooth colour gradients, a soft bright disc and per-pixel
 * noise from a fixed-seed generator (a linear congruential one), so nearly every pixel has a
 * colour of its own and every run sees the same bytes.
 */
function photo(side: number): PixelBuffer {
    const data = new Uint8ClampedArray(side * side * 4);
    let seed = 0x2f6e2b1;
    const noise = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed >>> 24) / 255 - 0.5;
    };
    for (let y = 0, i = 0; y < side; y++) {
        const v = y / (side - 1);
        for (let x = 0; x < side; x++, i += 4) {
            const u = x / (side - 1);
            const disc = Math.max(0, 1 - Math.hypot(u - 0.65, v - 0.35) * 3);
            data[i] = 255 * (0.15 + 0.6 * u + 0.25 * disc) + 24 * noise();
            data[i + 1] = 255 * (0.2 + 0.5 * v * (1 - u) + 0.3 * disc) + 24 * noise();
            data[i + 2] = 255 * (0.8 - 0.6 * v + 0.1 * Math.sin(u * 12)) + 24 * noise();
            data[i + 3] = 255;
        }
    }
    return { width: side, height: side, data };
}

const settings: ImportSettings = {
    size: { width: TARGET_SIDE, height: TARGET_SIDE, fit: "contain" },
    resample: "area",
    alpha: { threshold: 128 },
    colors: { mode: "reduce", count: COLORS },
    dither: "none",
};

function distinctColors(buffer: PixelBuffer): number {
    const view = new DataView(buffer.data.buffer, buffer.data.byteOffset);
    const colors = new Set<number>();
    for (let i = 0; i < buffer.data.length; i += 4) {
        colors.add(view.getUint32(i));
    }
    return colors.size;
}

it("imports a 2048×2048 photo as a 64×64 sprite of 16 colours", () => {
    const sources = [{ name: "photo.png", pixels: photo(SOURCE_SIDE) }];
    expect(distinctColors(sources[0].pixels)).toBeGreaterThan(1_000_000);

    // No warm-up: the first sample is the cold call a user makes once, and it counts.
    const samples: number[] = [];
    const results: ImportResult[] = [];
    for (let run = 0; run < RUNS; run++) {
        const start = performance.now();
        results.push(runImport(sources, settings));
        samples.push(performance.now() - start);
    }

    for (const { frames, palette } of results) {
        expect(frames).toHaveLength(1);
        expect([frames[0].width, frames[0].height]).toEqual([TARGET_SIDE, TARGET_SIDE]);
        expect(palette.colors).toHaveLength(COLORS);
        expect(distinctColors(frames[0])).toBeLessThanOrEqual(COLORS);
        expect(frames[0].data).toEqual(results[0].frames[0].data);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    record({
        id: "se-043-import",
        ticket: "SE-043",
        measurement:
            `runImport of one opaque photo-like ${SOURCE_SIDE}×${SOURCE_SIDE} source to one ` +
            `${TARGET_SIDE}×${TARGET_SIDE} frame: area average, threshold 128, reduce to ` +
            `${COLORS} colours, no dither`,
        statistic: `slowest of ${RUNS} consecutive runs, the first (cold) one included`,
        budgetMs: BUDGET_MS,
        resultMs: sorted[sorted.length - 1],
        details: {
            runs: RUNS,
            minMs: sorted[0],
            medianMs: (sorted[RUNS / 2 - 1] + sorted[RUNS / 2]) / 2,
            maxMs: sorted[sorted.length - 1],
            firstMs: samples[0],
            samplesMs: samples,
        },
    });
});
