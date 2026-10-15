import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { createBucket } from "../../src/app/tools/bucket/bucket";
import { celAt, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import { floodMask, paintInk, paintMask } from "../../src/core/raster";
import { harness, stroke } from "../unit/se-014-support";
import { record } from "./record";

// SE-017 acceptance: a flood fill of a 1024×1024 empty canvas completes in ≤ 100 ms. Measured
// and recorded, not asserted (SPEC §11); the orchestrator records the number.
//
// The result is the flood fill itself: `floodMask` of one pixel (contiguous, tolerance 0)
// followed by `paintMask` writing simple ink into every pixel of the mask, which is the part of
// the paint bucket's press that `core/raster` does. It is taken on two 1024×1024 canvases, a
// transparent one (whose pixels match through the alpha-0 rule) and an opaque flat one (which
// compares every channel), and the result is the larger of their two statistics.
//
// For information only (`details.bucketPress`), the whole press of the paint bucket through
// the pointer pipeline in Node (`createToolPipeline`, as the SE-014 and SE-017 unit tests run
// it, without a viewport): from `down` to `up` on an opaque flat 1024×1024 document with one
// layer — the press composites the frame in full and the transaction snapshots the cel, the
// fill as above, the live composite of the dirty rectangle (the whole canvas), and at the
// release the commit's comparison with the snapshot and its undo patches. No upload, echo or
// animation frame is included.

const SIDE = 1024;
const BUDGET_MS = 100;
const RUNS = 20;
const PRESS_RUNS = 10;
const FILL = 0x336699ff;

/** Slowest, median and every sample of a series, in milliseconds. */
function summary(samples: readonly number[]) {
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = sorted.length / 2;
    return {
        maxMs: sorted[sorted.length - 1]!,
        medianMs: (sorted[Math.floor(middle - 0.5)]! + sorted[Math.ceil(middle - 0.5)]!) / 2,
        minMs: sorted[0]!,
        firstMs: samples[0]!,
        samplesMs: [...samples],
    };
}

/** `RUNS` consecutive flood fills of a fresh canvas of `colour`, the first (cold) one included. */
function fills(colour: number) {
    const ink = paintInk("simple", FILL, 255);
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run++) {
        const image = createPixelBuffer(SIDE, SIDE, colour);
        const start = performance.now();
        const mask = floodMask(image, { x: 517, y: 301 }, { tolerance: 0, contiguous: true });
        const changed = paintMask(image, image, mask, ink);
        samples.push(performance.now() - start);
        // The benchmark ran the real thing: every pixel was taken and painted.
        expect(changed).toEqual({ x: 0, y: 0, width: SIDE, height: SIDE });
        expect(mask.data.every((byte) => byte === 0xff)).toBe(true);
    }
    return summary(samples);
}

/** A 1024×1024 document whose one layer has a cel of opaque white. */
function flatDocument(): DocSession {
    const session = createDocument(
        { name: "flat", width: SIDE, height: SIDE },
        sequentialIds("f-"),
    );
    const { doc, activeLayerId, activeFrameId } = session;
    const imageId = "flat-image";
    doc.images.set(imageId, createPixelBuffer(SIDE, SIDE, 0xffffffff));
    doc.cels.set(`${activeLayerId}:${activeFrameId}`, { imageId, opacity: 255 });
    return session;
}

/** `PRESS_RUNS` bucket presses through the pipeline, each on a fresh document. */
function presses() {
    const samples: number[] = [];
    for (let run = 0; run < PRESS_RUNS; run++) {
        const h = harness([]);
        const bucket = createBucket({ composites: h.composites });
        h.registry.register({ ...bucket, id: "perf.bucket" }, "se-017-flood-fill.perf.ts");
        h.tools.select("perf.bucket");
        h.editor.getState().setForeground(FILL);
        const session = flatDocument();
        const { history } = h.open(session, { scale: 1, originX: 0, originY: 0 });
        const start = performance.now();
        stroke(h, [{ x: 517, y: 301 }]);
        samples.push(performance.now() - start);
        expect(history.undoCount).toBe(1);
        const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId);
        const image = session.doc.images.get(cel!.imageId) as PixelBuffer;
        expect(Array.from(image.data.slice(0, 4))).toEqual([0x33, 0x66, 0x99, 0xff]);
        expect(Array.from(image.data.slice(-4))).toEqual([0x33, 0x66, 0x99, 0xff]);
        expect(h.errors).toEqual([]);
    }
    return summary(samples);
}

it("fills a 1024×1024 canvas: transparent and opaque flat", () => {
    const transparent = fills(0x00000000);
    const opaque = fills(0xffffffff);
    const press = presses();
    const result = Math.max(transparent.maxMs, opaque.maxMs);
    record({
        id: "se-017-flood-fill",
        ticket: "SE-017",
        measurement:
            `floodMask (contiguous, tolerance 0) of a ${SIDE}×${SIDE} image from one pixel, then ` +
            "paintMask writing simple ink into every pixel of the mask; a transparent and an " +
            "opaque flat image, Node",
        statistic:
            `larger of the two canvases' slowest of ${RUNS} consecutive fills, the first ` +
            "(cold) one included",
        budgetMs: BUDGET_MS,
        resultMs: result,
        details: {
            runs: RUNS,
            transparent,
            opaqueFlat: opaque,
            bucketPress: {
                measurement:
                    "the paint bucket's press from down to up through createToolPipeline in " +
                    `Node, opaque flat ${SIDE}×${SIDE} document with one layer: full composite ` +
                    "and snapshot at the press, the fill, the live composite of the whole " +
                    "canvas, the commit's comparison and undo patches; no viewport",
                statistic: `slowest of ${PRESS_RUNS} presses, each on a fresh document, the first included`,
                ...press,
            },
        },
    });
    console.log(
        `se-017-flood-fill details: transparent max ${transparent.maxMs.toFixed(1)} ms ` +
            `(median ${transparent.medianMs.toFixed(1)}), opaque flat max ` +
            `${opaque.maxMs.toFixed(1)} ms (median ${opaque.medianMs.toFixed(1)}); bucket ` +
            `press through the pipeline max ${press.maxMs.toFixed(1)} ms (median ` +
            `${press.medianMs.toFixed(1)})`,
    );
});
