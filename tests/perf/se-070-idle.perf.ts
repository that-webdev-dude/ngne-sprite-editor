import type { Browser, Page } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { it } from "vitest";
import { record } from "./record";
import {
    LAYERS,
    SIDE,
    checkAdapter,
    environmentDetails,
    expectPreviewExpanded,
    launch,
    newContext,
    openApp,
    openReferenceDocument,
    selectedGpu,
    sleep,
    startDevServer,
    viewportSettled,
} from "./se-070-harness";

// SE-070, SPEC §6.6: "Idle editor: frames submitted per second — 0". The idle budget is the
// editor viewport's (SPEC §6.6, REVIEW.md F68): the expanded preview plays its animation, one
// frame per entry, and is reported beside it. Run alone, one GPU at a time
// (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts tests/perf/se-070-idle.perf.ts
//
// (`rtx-4060`, or `swiftshader`, which is no reference.) Without PERF_GPU it is skipped.
//
// The reference document (256 × 256, 8 layers) with 8 frames of 100 ms, in the default layout
// with the preview expanded. Once the viewport is at rest and two seconds more have passed,
// two windows of 10 s each: the pointer outside the viewport, then resting on the canvas
// after one move onto it (the brush cursor is the overlay's, SPEC §6.4). In each window the
// page counts the viewport's submitted frames (`probe.submittedFrames`), its `texture()`
// calls, the preview's rendered frames and its own animation frames; a window without about
// 60 animation frames per second of the page (fewer than 20) fails the run: the page was not
// running, and so does a view change afterwards that submits no frame (the counter must count).
// The result is the larger of the two windows' viewport frames per second (`unit:
// count`, frames per second) against a budget of 0.

const WINDOW_MS = 10_000;
const gpu = selectedGpu();

interface IdleWindow {
    seconds: number;
    viewportFrames: number;
    viewportUploads: number;
    previewFrames: number | null;
    pageAnimationFrames: number;
}

function measureWindow(page: Page, ms: number): Promise<IdleWindow> {
    return page.evaluate(async (ms) => {
        const hooks = window.__ngneTest!;
        const probe = hooks.viewport!;
        const start = {
            at: performance.now(),
            frames: probe.submittedFrames,
            uploads: probe.textureCalls,
            preview: hooks.preview?.frames ?? null,
        };
        let animationFrames = 0;
        let running = true;
        const tick = () => {
            if (!running) return;
            animationFrames++;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        await new Promise((resolve) => setTimeout(resolve, ms));
        running = false;
        const preview = hooks.preview?.frames ?? null;
        return {
            seconds: (performance.now() - start.at) / 1000,
            viewportFrames: probe.submittedFrames - start.frames,
            viewportUploads: probe.textureCalls - start.uploads,
            previewFrames:
                preview === null || start.preview === null ? null : preview - start.preview,
            pageAnimationFrames: animationFrames,
        };
    }, ms);
}

it.skipIf(!gpu)(
    `SE-070: idle editor, ${SIDE}² with ${LAYERS} layers (${gpu?.id ?? "set PERF_GPU"})`,
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
            await page.mouse.move(0, 0);
            await openApp(page, started.url);
            const adapter = await checkAdapter(page, gpu);
            await openReferenceDocument(page, 8);
            await expectPreviewExpanded(page);
            await viewportSettled(page);
            await sleep(2000);

            const outside = await measureWindow(page, WINDOW_MS);
            const box = await page.locator("[data-viewport]").boundingBox();
            if (!box) throw new Error("se-070: no viewport on the page");
            // Onto the document (at 2× from (32, 32) device pixels: the canvas's middle).
            await page.mouse.move(box.x + 32 + SIDE, box.y + 32 + SIDE, { steps: 5 });
            await viewportSettled(page);
            await sleep(1000);
            const over = await measureWindow(page, WINDOW_MS);
            // The counter counts: a change of the view is drawn, one frame or more.
            const control = await page.evaluate(async () => {
                const hooks = window.__ngneTest!;
                const before = hooks.viewport!.submittedFrames;
                const state = hooks.sessions.getState();
                state.setView(state.activeId!, { scale: 3, originX: 32, originY: 32 });
                await new Promise((resolve) => setTimeout(resolve, 500));
                return hooks.viewport!.submittedFrames - before;
            });
            if (control < 1) {
                throw new Error(
                    "se-070: a change of the view submitted no frame. Nothing was measured.",
                );
            }
            if (pageErrors.length > 0) throw new Error(`se-070: page errors: ${pageErrors[0]}`);
            for (const window of [outside, over]) {
                if (window.pageAnimationFrames < 20 * window.seconds) {
                    throw new Error(
                        `se-070: the page ran ${window.pageAnimationFrames} animation frames in ` +
                            `${window.seconds.toFixed(1)} s. Nothing was measured.`,
                    );
                }
            }
            const rate = (window: IdleWindow) =>
                Math.round((window.viewportFrames / window.seconds) * 100) / 100;
            const result = Math.max(rate(outside), rate(over));
            const describe = (window: IdleWindow) => ({
                ...window,
                seconds: Math.round(window.seconds * 100) / 100,
                viewportFramesPerSecond: rate(window),
                previewFramesPerSecond:
                    window.previewFrames === null
                        ? null
                        : Math.round((window.previewFrames / window.seconds) * 10) / 10,
            });
            const details = {
                pointerOutside: describe(outside),
                pointerOnCanvas: describe(over),
                controlFramesAfterViewChange: control,
                submitted: "probe.submittedFrames: frames the viewport submitted to NGNE",
                preview: "the expanded preview plays the 8 entries of 100 ms (SPEC §6.6)",
                document: `${SIDE}×${SIDE}, ${LAYERS} layers, 8 frames, at 2×, preview expanded`,
                ...environmentDetails(browser, gpu, adapter),
            };
            record({
                id: `se-070-idle-${gpu.id}`,
                ticket: "SE-070",
                measurement:
                    `Frames the editor viewport submits per second while idle, reference ` +
                    `document (${SIDE}×${SIDE}, ${LAYERS} layers, 8 frames), default layout, ` +
                    `Chrome on ${gpu.label}: two windows of ${WINDOW_MS / 1000} s, pointer ` +
                    "outside the viewport and resting on the canvas.",
                statistic: "larger of the two windows' viewport frames per second",
                unit: "count",
                budgetMs: 0,
                resultMs: result,
                details,
            });
            console.log(JSON.stringify(details, null, 4));
        } finally {
            await browser?.close();
            await server?.close();
        }
    },
);
