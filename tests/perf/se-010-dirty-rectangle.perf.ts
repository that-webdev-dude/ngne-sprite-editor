import { expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { PixelLayer, SpriteDoc } from "../../src/core/model";
import { pixelBuffersEqual } from "../../src/core/pixels";
import { record } from "./record";

// SE-010 acceptance and SPEC §6.6: the dirty-rectangle recomposite of a 16 px brush dab on a
// 256×256 document with 8 layers takes at most 2 ms. The number is recorded by the
// orchestrator (docs/tickets/EXECUTION.md, Measurements); nothing here asserts the budget.

const SIDE = 256;
const LAYERS = 8;
const DAB = 16;
const WARM_UP = 2_000;
const SAMPLES = 5_000;
const FULL_SAMPLES = 50;

/** Deterministic pseudo-random integers (a linear congruential generator), 0 to `below - 1`. */
function generator(seed: number): (below: number) => number {
    let state = seed;
    return (below) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return Math.floor((state / 2 ** 32) * below);
    };
}

/**
 * The worst case for the compositor: every layer visible with a cel, every pixel of every
 * cel half transparent (alpha 1..254) and no opacity at 255, so that each of the 8 layers
 * takes the full blend with its three divisions on every pixel but the first.
 */
function worstCase(): { doc: SpriteDoc; frameId: string } {
    const next = generator(10);
    const { doc, activeFrameId } = createDocument(
        { name: "benchmark", width: SIDE, height: SIDE },
        sequentialIds(),
    );
    doc.layers = Array.from({ length: LAYERS }, (_, index): PixelLayer => ({
        id: `layer-${index}`,
        name: `Layer ${index}`,
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 200 + index,
        blend: "normal",
    }));
    for (const layer of doc.layers) {
        const data = new Uint8ClampedArray(SIDE * SIDE * 4);
        for (let at = 0; at < data.length; at += 4) {
            data[at] = next(256);
            data[at + 1] = next(256);
            data[at + 2] = next(256);
            data[at + 3] = 1 + next(254);
        }
        const imageId = `image-${layer.id}`;
        doc.images.set(imageId, { width: SIDE, height: SIDE, data });
        doc.cels.set(celKey(layer.id, activeFrameId), { imageId, opacity: 250 });
    }
    return { doc, frameId: activeFrameId };
}

function percentile(sorted: readonly number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

it("SE-010: 16×16 dirty rectangle over 8 layers at 256×256", () => {
    const { doc, frameId } = worstCase();
    const into = compositeFrame(doc, frameId);
    const next = generator(20);
    // A dab anywhere on the canvas, wholly inside it.
    const dab = () => ({
        x: next(SIDE - DAB + 1),
        y: next(SIDE - DAB + 1),
        width: DAB,
        height: DAB,
    });

    for (let run = 0; run < WARM_UP; run++) compositeFrame(doc, frameId, { rect: dab(), into });

    const samples: number[] = [];
    for (let run = 0; run < SAMPLES; run++) {
        const rect = dab();
        const start = performance.now();
        compositeFrame(doc, frameId, { rect, into });
        samples.push(performance.now() - start);
    }

    // For information: a composite of the whole frame, which a frame switch pays once.
    const full: number[] = [];
    for (let run = 0; run < FULL_SAMPLES; run++) {
        const start = performance.now();
        compositeFrame(doc, frameId, { into });
        full.push(performance.now() - start);
    }

    // The benchmark ran the real thing: the buffer is still the composite of the frame.
    expect(pixelBuffersEqual(into, compositeFrame(doc, frameId))).toBe(true);

    samples.sort((a, b) => a - b);
    full.sort((a, b) => a - b);
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    record({
        id: "se-010-dirty-rectangle",
        ticket: "SE-010",
        measurement:
            "compositeFrame with a 16×16 rect into an existing buffer, 256×256 document, " +
            "8 visible layers with every pixel half transparent (worst case), Node",
        statistic: `95th percentile of ${SAMPLES} calls after ${WARM_UP} warm-up calls`,
        budgetMs: 2,
        resultMs: percentile(samples, 0.95),
        details: {
            samples: SAMPLES,
            warmUpCalls: WARM_UP,
            minMs: samples[0],
            medianMs: percentile(samples, 0.5),
            meanMs: mean,
            p95Ms: percentile(samples, 0.95),
            p99Ms: percentile(samples, 0.99),
            maxMs: samples[samples.length - 1],
            fullFrameMedianMs: percentile(full, 0.5),
            fullFrameSamples: FULL_SAMPLES,
        },
    });
});
