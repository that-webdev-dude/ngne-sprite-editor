import { Frame } from "@ngne/core";
import type { WebGPURenderer } from "@ngne/core";
import {
    describeError,
    integerParam,
    nextFrame,
    round2,
    runSpike,
    sleep,
    summarize,
} from "../lib/harness.ts";
import { bitmapOf, camera, createRenderer, placeDoc, readDiff } from "../lib/ngne.ts";
import { makeDoc, type Doc } from "../lib/pattern.ts";
import { UploadQueue } from "../lib/queue.ts";

// Question 1: upload latency and sustained rate.
// Method (ticket): from a CPU Uint8ClampedArray build a bitmap, `texture("ed:f:0")`, `render()`;
// time to `texture()` resolution and to the next `render()` submitted; 64², 256², 512², 1024²;
// 200 samples each; then 5 s of replacements requested every animation frame.
// Go: 256²: p95 <= 25 ms to submitted and >= 30 completed replacements/s sustained.

const SLOT = "ed:f:0";
const CLEAR = 0x101820;
const CANVAS = 1024;
const WARMUP = 10;
const GO_SIZE = 256;
const GO_SUBMITTED_MS = 25;
const GO_RATE = 30;

/** A 16 px brush dab at a position that moves with every sample, so every upload differs. */
function dab(doc: Doc, index: number): void {
    const size = Math.min(16, doc.width);
    const x0 = (index * 7) % (doc.width - size + 1);
    const y0 = (index * 13) % (doc.height - size + 1);
    for (let y = y0; y < y0 + size; y++)
        for (let x = x0; x < x0 + size; x++) {
            const o = (y * doc.width + x) * 4;
            doc.pixels[o] = (index * 31) & 255;
            doc.pixels[o + 1] = (index * 17) & 255;
            doc.pixels[o + 2] = ((index * 5) & 255) | 1;
        }
}

runSpike(1, async (spike) => {
    const sampleCount = integerParam(spike.params, "samples", 200);
    const streamMs = integerParam(spike.params, "streamMs", 5000);
    const sizes = (spike.params.get("sizes") ?? "64,256,512,1024").split(",").map(Number);
    spike.metric("parameters", { sampleCount, streamMs, sizes, warmup: WARMUP });

    const canvas = document.createElement("canvas");
    canvas.style.width = canvas.style.height = `${CANVAS / devicePixelRatio}px`;
    document.querySelector("#stage")?.append(canvas);
    const errors: string[] = [];
    const renderer: WebGPURenderer = await createRenderer(canvas, CANVAS, CANVAS, (error) =>
        errors.push(describeError(error)),
    );
    const frame = new Frame();
    const view = camera(false);
    const draw = (doc: Doc) => {
        frame.reset();
        frame.scene(view, 1);
        placeDoc(frame, SLOT, { doc, x: 0, y: 0, scale: 1 });
        renderer.render(frame, CLEAR);
    };

    for (const size of sizes) {
        const doc = makeDoc(size, size, size);
        const label = `${size}²`;
        spike.log(`${label}: ${sampleCount} samples, render straight after resolution`);

        // Series A, the method as written: render() is called as soon as texture() resolves.
        const bitmapMs: number[] = [];
        const resolvedMs: number[] = [];
        const submittedMs: number[] = [];
        for (let index = -WARMUP; index < sampleCount; index++) {
            await sleep(Math.random() * 16);
            dab(doc, index + WARMUP);
            const t0 = performance.now();
            const bitmap = await bitmapOf(doc);
            const t1 = performance.now();
            await renderer.texture(SLOT, bitmap);
            const t2 = performance.now();
            draw(doc);
            const t3 = performance.now();
            bitmap.close();
            if (index < 0) continue;
            bitmapMs.push(t1 - t0);
            resolvedMs.push(t2 - t0);
            submittedMs.push(t3 - t0);
        }

        // Series B, the viewport path of SPEC §6.4: the publish sets a dirty flag and the draw
        // happens in the next animation frame. Each sample starts at a random frame phase.
        spike.log(`${label}: ${sampleCount} samples, render in the next animation frame`);
        const frameSubmittedMs: number[] = [];
        for (let index = -WARMUP; index < sampleCount; index++) {
            await sleep(Math.random() * 16);
            dab(doc, index + WARMUP + sampleCount);
            const t0 = performance.now();
            const bitmap = await bitmapOf(doc);
            await renderer.texture(SLOT, bitmap);
            await nextFrame();
            draw(doc);
            const t3 = performance.now();
            bitmap.close();
            if (index >= 0) frameSubmittedMs.push(t3 - t0);
        }

        const diff = readDiff(canvas, CLEAR, [{ doc, x: 0, y: 0, scale: 1 }]);
        spike.check(
            `${label}: canvas shows the last uploaded buffer`,
            diff.count === 0,
            diff.count ? `${diff.count} pixels differ; ${diff.first}` : "",
        );

        // 5 s of replacements requested every animation frame through the §6.4 queue.
        spike.log(`${label}: ${streamMs} ms of replacements requested every animation frame`);
        let dirty = false;
        let renders = 0;
        const publishAt: number[] = [];
        const failures: string[] = [];
        const queue = new UploadQueue<number>(
            renderer,
            () => {
                publishAt.push(performance.now());
                dirty = true;
            },
            (_, error) => failures.push(describeError(error)),
        );
        let frames = 0;
        const start = performance.now();
        let now = start;
        while (now - start < streamMs) {
            await nextFrame();
            now = performance.now();
            if (now - start >= streamMs) break;
            frames++;
            if (dirty) {
                dirty = false;
                draw(doc);
                renders++;
            }
            dab(doc, frames);
            queue.request(SLOT, () => bitmapOf(doc), frames);
        }
        const end = performance.now();
        await queue.idle();
        const inWindow = publishAt.filter((time) => time <= end).map((time) => time - start);
        const seconds = (end - start) / 1000;
        const perSecond = Array.from(
            { length: Math.floor(seconds) },
            (_, second) =>
                inWindow.filter((time) => time >= second * 1000 && time < (second + 1) * 1000)
                    .length,
        );
        let maxGap = inWindow[0] ?? streamMs;
        for (let index = 1; index < inWindow.length; index++)
            maxGap = Math.max(maxGap, (inWindow[index] ?? 0) - (inWindow[index - 1] ?? 0));
        const rate = round2(inWindow.length / seconds);
        const stream = {
            durationMs: round2(end - start),
            animationFrames: frames,
            animationFramesPerSecond: round2(frames / seconds),
            requested: queue.stats.requested,
            replacedInQueue: queue.stats.replaced,
            completed: inWindow.length,
            completedPerSecond: rate,
            completedBySecond: perSecond,
            maxPublishGapMs: round2(maxGap),
            renders,
            failures,
        };

        const resolved = summarize(resolvedMs);
        const submitted = summarize(submittedMs);
        const frameSubmitted = summarize(frameSubmittedMs);
        spike.metric(label, {
            bitmapMs: summarize(bitmapMs),
            resolvedMs: resolved,
            submittedMs: submitted,
            frameSubmittedMs: frameSubmitted,
            stream,
        });
        spike.samples(`${label} bitmapMs`, bitmapMs);
        spike.samples(`${label} resolvedMs`, resolvedMs);
        spike.samples(`${label} submittedMs`, submittedMs);
        spike.samples(`${label} frameSubmittedMs`, frameSubmittedMs);
        spike.samples(`${label} streamPublishAtMs`, inWindow);

        spike.summary(
            `${label} to texture() resolved, median / p95 / max (ms)`,
            `${resolved.median} / ${resolved.p95} / ${resolved.max}`,
        );
        spike.summary(
            `${label} to render() submitted, median / p95 / max (ms)`,
            `${submitted.median} / ${submitted.p95} / ${submitted.max}`,
        );
        spike.summary(
            `${label} to submitted in the next animation frame, median / p95 (ms)`,
            `${frameSubmitted.median} / ${frameSubmitted.p95}`,
        );
        spike.summary(
            `${label} sustained completed replacements/s (animation frames/s)`,
            `${rate} (${stream.animationFramesPerSecond})`,
        );

        const submittedOk = submitted.p95 <= GO_SUBMITTED_MS;
        const rateOk = rate >= GO_RATE && failures.length === 0;
        const record = size === GO_SIZE ? spike.check : spike.info;
        record(
            `${label}: p95 to submitted <= ${GO_SUBMITTED_MS} ms`,
            submittedOk,
            `p95 ${submitted.p95} ms`,
        );
        record(
            `${label}: >= ${GO_RATE} completed replacements/s sustained`,
            rateOk,
            `${rate}/s over ${round2(seconds)} s; by second ${perSecond.join(", ")}` +
                (failures.length ? `; failures: ${failures.join(" | ")}` : ""),
        );
        spike.info(
            `${label}: p95 to submitted in the next animation frame <= ${GO_SUBMITTED_MS} ms`,
            frameSubmitted.p95 <= GO_SUBMITTED_MS,
            `p95 ${frameSubmitted.p95} ms`,
        );
    }

    spike.check("No renderer diagnostic", errors.length === 0, errors.join(" | "));
    spike.metric("inspect", renderer.inspect());
    renderer.dispose();
});
