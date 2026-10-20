import { it } from "vitest";
import { record } from "./record";
import { showFrame, slotKeys, switchOnce, withReferenceDocument } from "./se-070-frame-switch";
import type { SwitchSample } from "./se-070-frame-switch";
import { LAYERS, SIDE, selectedGpu, summary } from "./se-070-harness";

// SE-070, SPEC §6.6: "Frame switch to a frame already in the slot cache: submitted — next
// animation frame". Run alone, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts tests/perf/se-070-frame-switch-cached.perf.ts
//
// (`rtx-4060`, or `swiftshader`, which is no reference.) Without PERF_GPU it is skipped.
//
// The reference document (256 × 256, 8 layers) with 8 frames, as many as the viewport has
// cache slots (`FRAME_SLOT_COUNT`): after one visit of each, every frame is in the cache.
// Then 10 sweeps from frame 1 to frame 8 with ArrowRight on the viewport (70 switches; the
// way back to frame 1 is not measured), each recorded as `se-070-frame-switch.ts` describes.
// A switch counts the animation frames from the key to the submit of the frame that shows
// the new frame: 1 is the next animation frame. The result is the largest count (`unit:
// count`) against a budget of 1. A switch that made a `texture()` call, or a cache that does
// not hold all 8 frames before the sweeps, fails the run: nothing was measured.

const FRAMES = 8;
const SWEEPS = 10;
const gpu = selectedGpu();

it.skipIf(!gpu)(
    `SE-070: frame switch to a cached frame, ${SIDE}² with ${LAYERS} layers (${gpu?.id ?? "set PERF_GPU"})`,
    async () => {
        if (!gpu) return;
        await withReferenceDocument(gpu, FRAMES, async ({ page, details }) => {
            // One visit of each frame puts it in the cache.
            for (let frame = 1; frame <= FRAMES; frame++) await showFrame(page, frame);
            await showFrame(page, 1);
            const cached = await slotKeys(page);
            if (new Set(cached).size !== FRAMES) {
                throw new Error(
                    `se-070: the cache holds ${cached.length} frames, not ${FRAMES}. Nothing was measured.`,
                );
            }
            const samples: SwitchSample[] = [];
            for (let sweep = 0; sweep < SWEEPS; sweep++) {
                for (let step = 1; step < FRAMES; step++) samples.push(await switchOnce(page));
                await showFrame(page, 1);
            }
            const uploaded = samples.filter((sample) => sample.uploads > 0);
            if (uploaded.length > 0) {
                throw new Error(
                    `se-070: ${uploaded.length} switches uploaded (first to frame ` +
                        `${uploaded[0]!.to}): the frames were not all cached. Nothing was measured.`,
                );
            }
            const frames = samples.map((sample) => sample.frames);
            const counts: Record<string, number> = {};
            for (const count of frames) counts[count] = (counts[count] ?? 0) + 1;
            const largest = Math.max(...frames);
            const result = {
                switches: samples.length,
                animationFramesToSubmit: counts,
                latency: summary(samples.map((sample) => sample.latencyMs)),
                submitted: "onDrawn: frames submitted to NGNE, not known to be presented on screen",
                document: `${SIDE}×${SIDE}, ${LAYERS} layers, ${FRAMES} frames, at 2×, preview expanded`,
                ...details(),
            };
            record({
                id: `se-070-frame-switch-cached-${gpu.id}`,
                ticket: "SE-070",
                measurement:
                    `Frame switch to a frame in the viewport's slot cache (ArrowRight on the ` +
                    `viewport) on the reference document (${SIDE}×${SIDE}, ${LAYERS} layers, ` +
                    `${FRAMES} frames), Chrome on ${gpu.label}: animation frames from the key to ` +
                    "the submit of the frame showing the new frame (1: the next animation frame).",
                statistic: `largest of ${samples.length} switches, in animation frames`,
                unit: "count",
                budgetMs: 1,
                resultMs: largest,
                details: result,
            });
            console.log(JSON.stringify(result, null, 4));
        });
    },
);
