import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { boundaryOf } from "../../src/app/selection/boundaryCache";
import { createPendingStore, pendingBoundary } from "../../src/app/selection/tools/pendingShape";
import { createWand } from "../../src/app/selection/tools/wand";
import { CONTIGUOUS } from "../../src/app/tools/bucket/bucket";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import { at, harness } from "../unit/se-014-support";
import { record } from "./record";

// SE-031 acceptance: the magic wand on a 1024×1024 flat canvas completes in ≤ 100 ms. Measured
// and recorded, not asserted (SPEC §11); the orchestrator records the number.
//
// What is timed is the wand's click through the pointer pipeline in Node (`createToolPipeline`,
// as the unit tests drive it, without a viewport): its press and its release on an opaque flat
// 1024×1024 document with one layer, Sample: Active layer, Tolerance 0 — the flood mask of the
// press (every pixel matches), the pending area handed to the overlay's store, and at the
// release the selection command (Replace: the selection keeps the pick's mask, its bounds
// found) run through the history. Contiguous and not, each on a fresh document; the result is
// the larger of their slowest clicks, the first (cold) one included.
//
// For information only, not part of the click: the boundary of the pick, worked out once and
// shared (`boundaryCache.ts`). `previewBoundary` is the preview's at the press (between the
// press and the release, as the overlay's redraw would ask for it): the one computation.
// `antsBoundary` is the ants' at their first draw of the selection after the release: a lookup
// of that same boundary, which the benchmark checks is the very object the preview had.

const SIDE = 1024;
const BUDGET_MS = 100;
const RUNS = 10;
const SEED = { x: 517, y: 301 };

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

/** A 1024×1024 document whose one layer has a cel of opaque white. */
function flatDocument(run: number, contiguous: boolean): DocSession {
    const session = createDocument(
        { name: "flat", width: SIDE, height: SIDE },
        sequentialIds(`flat-${contiguous}-${run}-`),
    );
    const { doc, activeLayerId, activeFrameId } = session;
    const imageId = "flat-image";
    doc.images.set(imageId, createPixelBuffer(SIDE, SIDE, 0xffffffff));
    doc.cels.set(`${activeLayerId}:${activeFrameId}`, { imageId, opacity: 255 });
    return session;
}

/** `RUNS` wand clicks through the pipeline, each on a fresh document. */
function clicks(contiguous: boolean) {
    const samples: number[] = [];
    const previews: number[] = [];
    const ants: number[] = [];
    for (let run = 0; run < RUNS; run++) {
        const h = harness([]);
        const pending = createPendingStore();
        const wand = createWand({ composites: h.composites }, pending);
        h.registry.register({ ...wand, id: "perf.wand" }, "se-031-magic-wand.perf.ts");
        h.tools.select("perf.wand");
        h.tools.setOption(h.tools.active()!, CONTIGUOUS.key, contiguous);
        const session = flatDocument(run, contiguous);
        const { history } = h.open(session, { scale: 1, originX: 0, originY: 0 });

        let start = performance.now();
        h.pipeline.down(at(h, SEED, { button: 0 }));
        let click = performance.now() - start;

        const shape = pending.get()!.shape;
        start = performance.now();
        const preview = pendingBoundary(shape, SIDE, SIDE);
        previews.push(performance.now() - start);

        start = performance.now();
        h.pipeline.up(at(h, SEED, { button: 0, buttons: 0 }));
        click += performance.now() - start;
        samples.push(click);

        start = performance.now();
        const boundary = boundaryOf(session.selection!.mask);
        ants.push(performance.now() - start);

        // The benchmark ran the real thing: one step, every pixel selected, one boundary.
        expect(history.undoCount).toBe(1);
        expect(session.selection?.bounds).toEqual({ x: 0, y: 0, width: SIDE, height: SIDE });
        expect(session.selection?.mask.data.every((byte) => byte === 0xff)).toBe(true);
        expect(shape.kind === "mask" && shape.mask).toBe(session.selection!.mask);
        expect(boundary).toBe(preview);
        expect(boundary.horizontal).toHaveLength(2);
        expect(h.errors).toEqual([]);
    }
    return {
        clicks: summary(samples),
        previewBoundary: summary(previews),
        antsBoundary: summary(ants),
    };
}

it("picks a 1024×1024 flat canvas with the magic wand: contiguous and not", () => {
    const contiguous = clicks(true);
    const global = clicks(false);
    const result = Math.max(contiguous.clicks.maxMs, global.clicks.maxMs);
    record({
        id: "se-031-magic-wand",
        ticket: "SE-031",
        measurement:
            `the magic wand's click (press and release) through createToolPipeline on an opaque ` +
            `flat ${SIDE}×${SIDE} document with one layer, Sample: Active layer, Tolerance 0: ` +
            "floodMask of every pixel, the pending area, and the selection command run through " +
            "the history at the release; Node, no viewport",
        statistic:
            `larger of Contiguous on and off's slowest of ${RUNS} clicks, each on a fresh ` +
            "document, the first (cold) one included",
        budgetMs: BUDGET_MS,
        resultMs: result,
        details: {
            runs: RUNS,
            contiguous: contiguous.clicks,
            global: global.clicks,
            boundary: {
                measurement:
                    "the pick's boundary (every pixel), worked out once and shared: the " +
                    "preview's at the press is the one computation, the ants' after the release " +
                    "a lookup of the same object; not part of the click",
                previewBoundary: {
                    contiguous: contiguous.previewBoundary,
                    global: global.previewBoundary,
                },
                antsBoundary: { contiguous: contiguous.antsBoundary, global: global.antsBoundary },
            },
        },
    });
    const max = (a: { maxMs: number }, b: { maxMs: number }) =>
        Math.max(a.maxMs, b.maxMs).toFixed(2);
    console.log(
        `se-031-magic-wand details: contiguous max ${contiguous.clicks.maxMs.toFixed(1)} ms ` +
            `(median ${contiguous.clicks.medianMs.toFixed(1)}), global max ` +
            `${global.clicks.maxMs.toFixed(1)} ms (median ${global.clicks.medianMs.toFixed(1)}); ` +
            `preview boundary max ${max(contiguous.previewBoundary, global.previewBoundary)} ms, ` +
            `ants boundary (shared) max ${max(contiguous.antsBoundary, global.antsBoundary)} ms`,
    );
});
