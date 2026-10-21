import { it } from "vitest";
import { record } from "./record";
import {
    expectFramesCounted,
    showFrame,
    slotKeys,
    switchOnce,
    withReferenceDocument,
} from "./se-070-frame-switch";
import type { SwitchSample } from "./se-070-frame-switch";
import { LAYERS, SIDE, percentile, selectedGpu, summary } from "./se-070-harness";

// SE-070, SPEC §6.6: "Frame switch needing an upload: submitted, p95 ≤ 50 ms". Run alone, one
// GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts tests/perf/se-070-frame-switch-upload.perf.ts
//
// (`rtx-4060`, or `swiftshader`, which is no reference.) Without PERF_GPU it is skipped.
//
// The reference document (256 × 256, 8 layers) with 64 frames, eight times the viewport's
// cache slots. Three sweeps from frame 1 to frame 64 with ArrowRight on the viewport (63
// switches each; the way back to frame 1 is not measured), each switch recorded as
// `se-070-frame-switch.ts` describes: from the key's `timeStamp` to the submit of the frame
// that shows the new frame. A frame stepped to was last shown 63 switches before, so it is
// never in the cache: every switch must make a `texture()` call and count at least 1
// animation frame, and the preview panel must be expanded and playing, or the run fails. The first
// sweep also builds each frame's composite (none was asked for before); the later sweeps find
// it in the composite cache and upload only. The result is the larger of the two p95s (first
// sweep; later sweeps) against SPEC §6.6's 50 ms.

const FRAMES = 64;
const SWEEPS = 3;
const BUDGET_MS = 50;
const gpu = selectedGpu();

it.skipIf(!gpu)(
    `SE-070: frame switch needing an upload, ${SIDE}² with ${LAYERS} layers (${gpu?.id ?? "set PERF_GPU"})`,
    async () => {
        if (!gpu) return;
        await withReferenceDocument(gpu, FRAMES, async ({ page, details }) => {
            const sweeps: SwitchSample[][] = [];
            for (let sweep = 0; sweep < SWEEPS; sweep++) {
                await showFrame(page, 1);
                const samples: SwitchSample[] = [];
                for (let step = 1; step < FRAMES; step++) samples.push(await switchOnce(page));
                sweeps.push(samples);
            }
            const all = sweeps.flat();
            const cachedHits = all.filter((sample) => sample.uploads === 0);
            if (cachedHits.length > 0) {
                throw new Error(
                    `se-070: ${cachedHits.length} switches made no upload (first to frame ` +
                        `${cachedHits[0]!.to}; cache ${JSON.stringify(await slotKeys(page))}). ` +
                        "Nothing was measured.",
                );
            }
            expectFramesCounted(all);
            const p95 = (samples: readonly SwitchSample[]) =>
                percentile(
                    samples.map((sample) => sample.latencyMs).sort((a, b) => a - b),
                    0.95,
                );
            const first = sweeps[0]!;
            const later = sweeps.slice(1).flat();
            const result = Math.max(p95(first), p95(later));
            const frames: Record<string, number> = {};
            for (const sample of all) frames[sample.frames] = (frames[sample.frames] ?? 0) + 1;
            const uploads: Record<string, number> = {};
            for (const sample of all) uploads[sample.uploads] = (uploads[sample.uploads] ?? 0) + 1;
            const output = {
                firstSweep: summary(first.map((sample) => sample.latencyMs)),
                laterSweeps: summary(later.map((sample) => sample.latencyMs)),
                animationFramesToSubmit: frames,
                uploadsPerSwitch: uploads,
                submitted: "onDrawn: frames submitted to NGNE, not known to be presented on screen",
                document: `${SIDE}×${SIDE}, ${LAYERS} layers, ${FRAMES} frames, at 2×, preview expanded`,
                ...details(),
            };
            record({
                id: `se-070-frame-switch-upload-${gpu.id}`,
                ticket: "SE-070",
                measurement:
                    `Frame switch to a frame not in the viewport's slot cache (ArrowRight on the ` +
                    `viewport) on the reference document (${SIDE}×${SIDE}, ${LAYERS} layers, ` +
                    `${FRAMES} frames), Chrome on ${gpu.label}: the key's timeStamp to the ` +
                    "submit of the frame showing the new frame.",
                statistic:
                    `larger of two p95s: the first sweep (${first.length} switches, composites ` +
                    `built) and the later sweeps (${later.length}, composites cached)`,
                budgetMs: BUDGET_MS,
                resultMs: result,
                details: output,
            });
            console.log(JSON.stringify(output, null, 4));
        });
    },
);
