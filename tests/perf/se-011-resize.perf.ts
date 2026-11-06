import type { Browser } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { it } from "vitest";
import type * as ViewportLinkModule from "../../src/app/viewport/viewportLink";
import { record } from "./record";
import {
    checkAdapter,
    environmentDetails,
    expectPreviewExpanded,
    LAYERS,
    launch,
    newContext,
    openApp,
    openReferenceDocument,
    selectedGpu,
    SIDE,
    sleep,
    startDevServer,
    summary,
    viewportSettled,
    WINDOW,
} from "./se-070-harness";

// NGNE 0.3.0 migration, SPEC §6.4 sizing: a new size of the viewport element resizes the
// renderer on screen (`renderer.resize`) and draws it in the same `ResizeObserver` task, so no
// cleared canvas is presented and no renderer is made. Run alone, one GPU at a time
// (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-011-resize.perf.ts
//
// (`rtx-4060`, or `swiftshader`, which is no reference.) Without PERF_GPU it is skipped.
//
// The reference document (256 × 256, 8 layers, two frames so the preview plays) at 2×, preview
// expanded. The window is resized 30 times through three sizes. Before the app loads, the
// page wraps `ResizeObserver` so that it records, for observers of the viewport element:
// - `observedAt`: entry into the first callback that sees the element's new size;
// - `callbackMs`: how long the viewport's own callback ran (resize and draw, in that task).
// The viewport's `onDrawn` then records the first submitted frame whose canvas has the new
// device size: `latencyMs` is from `observedAt` to that submit, and `sameTask` says whether it
// came inside the observer's callback. A resize that made a renderer or a device, a submit at
// another size, or no submit within 10 s fails the run: nothing was measured.
// No budget: SPEC §6.6 has none for a resize; the record is for information.

const SIZES = [
    { width: 1600, height: 900 },
    { width: 1280, height: 800 },
    { width: WINDOW.width, height: WINDOW.height },
];
const RESIZES = 30;
const gpu = selectedGpu();

interface ResizeSample {
    latencyMs: number;
    callbackMs: number;
    sameTask: boolean;
    size: { width: number; height: number };
}

interface ResizeRecorder {
    armed: boolean;
    observedAt: number | null;
    inCallback: boolean;
    callbackMs: number;
    wanted: { width: number; height: number } | null;
    samples: ResizeSample[];
    errors: string[];
}

declare global {
    interface Window {
        __se011resize?: ResizeRecorder;
    }
}

it.skipIf(!gpu)(
    `NGNE 0.3.0: viewport resize, observation to submitted frame, ${SIDE}² with ${LAYERS} layers (${gpu?.id ?? "set PERF_GPU"})`,
    async () => {
        if (!gpu) return;
        let server: ViteDevServer | null = null;
        let browser: Browser | null = null;
        try {
            const started = await startDevServer();
            server = started.server;
            browser = await launch(gpu);
            const page = await (await newContext(browser)).newPage();
            const pageErrors: string[] = [];
            page.on("pageerror", (error) => void pageErrors.push(String(error)));
            await page.addInitScript(() => {
                const recorder: ResizeRecorder = {
                    armed: false,
                    observedAt: null,
                    inCallback: false,
                    callbackMs: 0,
                    wanted: null,
                    samples: [],
                    errors: [],
                };
                window.__se011resize = recorder;
                const Native = window.ResizeObserver;
                window.ResizeObserver = class extends Native {
                    constructor(callback: ResizeObserverCallback) {
                        super((entries, observer) => {
                            const entry = entries.find((item) =>
                                item.target.matches("[data-viewport-canvas]"),
                            );
                            if (!entry || !recorder.armed) {
                                callback(entries, observer);
                                return;
                            }
                            const box = entry.devicePixelContentBoxSize?.[0];
                            const start = performance.now();
                            if (recorder.observedAt === null) {
                                recorder.observedAt = start;
                                recorder.wanted = box
                                    ? { width: box.inlineSize, height: box.blockSize }
                                    : null;
                            }
                            recorder.inCallback = true;
                            try {
                                callback(entries, observer);
                            } finally {
                                recorder.inCallback = false;
                                recorder.callbackMs = Math.max(
                                    recorder.callbackMs,
                                    performance.now() - start,
                                );
                            }
                        });
                    }
                };
            });
            await openApp(page, started.url);
            const adapter = await checkAdapter(page, gpu);
            await openReferenceDocument(page, 2);
            await expectPreviewExpanded(page);
            await viewportSettled(page);
            await page.evaluate(async () => {
                const load = new Function("path", "return import(path)") as (
                    path: string,
                ) => Promise<unknown>;
                const { viewportLink } = (await load(
                    "/src/app/viewport/viewportLink.ts",
                )) as typeof ViewportLinkModule;
                const recorder = window.__se011resize!;
                viewportLink.onDrawn(() => {
                    if (!recorder.armed || recorder.observedAt === null) return;
                    const size = window.__ngneTest!.viewport!.canvasSize;
                    const wanted = recorder.wanted;
                    if (!size || !wanted) return;
                    if (size.width !== wanted.width || size.height !== wanted.height) {
                        recorder.errors.push(
                            `a frame was submitted at ${size.width}×${size.height}, not ${wanted.width}×${wanted.height}`,
                        );
                        return;
                    }
                    recorder.samples.push({
                        latencyMs: performance.now() - recorder.observedAt,
                        callbackMs: 0,
                        sameTask: recorder.inCallback,
                        size: { ...size },
                    });
                    recorder.armed = false;
                });
            });
            await sleep(500);
            const devices = () =>
                page.evaluate(() => ({
                    renderers: window.__ngneTest!.viewport!.liveRenderers,
                    status: window.__ngneTest!.viewport!.status,
                }));
            const start = await devices();

            for (let index = 0; index < RESIZES; index++) {
                const size = SIZES[index % SIZES.length]!;
                const count = await page.evaluate(() => {
                    const recorder = window.__se011resize!;
                    recorder.observedAt = null;
                    recorder.wanted = null;
                    recorder.callbackMs = 0;
                    recorder.armed = true;
                    return recorder.samples.length;
                });
                await page.setViewportSize(size);
                await page.waitForFunction(
                    (count) => window.__se011resize!.samples.length > count,
                    count,
                    { polling: 10, timeout: 10_000 },
                );
                // The callback's duration is known once it has returned.
                await page.evaluate((count) => {
                    const recorder = window.__se011resize!;
                    recorder.samples[count]!.callbackMs = recorder.callbackMs;
                }, count);
                await viewportSettled(page);
                await page.evaluate(
                    () =>
                        new Promise<void>((resolve) =>
                            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                        ),
                );
            }

            const samples = await page.evaluate(() => window.__se011resize!.samples);
            const errors = await page.evaluate(() => window.__se011resize!.errors);
            const end = await devices();
            if (errors.length > 0)
                throw new Error(`se-011 resize: ${errors[0]}. Nothing was measured.`);
            if (pageErrors.length > 0)
                throw new Error(`se-011 resize: page errors: ${pageErrors[0]}`);
            if (end.renderers !== start.renderers || end.status !== "ready") {
                throw new Error(
                    `se-011 resize: renderers ${start.renderers} → ${end.renderers}, status ` +
                        `${end.status}: a renderer was made or lost. Nothing was measured.`,
                );
            }
            const latency = summary(samples.map((sample) => sample.latencyMs));
            const result = {
                resizes: samples.length,
                latency,
                callback: summary(samples.map((sample) => sample.callbackMs)),
                submittedInObserverTask: samples.filter((sample) => sample.sameTask).length,
                sizes: SIZES.map((size) => `${size.width}×${size.height}`),
                submitted: "onDrawn: frames submitted to NGNE, not known to be presented on screen",
                document: `${SIDE}×${SIDE}, ${LAYERS} layers, 2 frames, at 2×, preview expanded`,
                ...environmentDetails(browser, gpu, adapter),
            };
            record({
                id: `se-011-resize-${gpu.id}`,
                ticket: "SE-011",
                measurement:
                    "Window resize of the editor on the reference document " +
                    `(${SIDE}×${SIDE}, ${LAYERS} layers), Chrome on ${gpu.label}: from the ` +
                    "viewport element's ResizeObserver callback to the submit of the first frame " +
                    "at the new canvas size (NGNE 0.3.0 renderer.resize, no renderer replacement).",
                statistic: `median of ${samples.length} resizes`,
                resultMs: latency.medianMs,
                details: result,
            });
            console.log(JSON.stringify(result, null, 4));
        } finally {
            await browser?.close();
            await server?.close();
        }
    },
);
