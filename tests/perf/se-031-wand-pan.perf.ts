import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { it } from "vitest";
// Declares `window.__ngneTest` with the viewport, overlay and ants probes (development builds).
import type {} from "../../src/app/overlay/mountOverlay";
import type {} from "../../src/app/selection/selectionAnts.overlay";
import type * as OverlayLayersModule from "../../src/app/overlay/overlayLayers";
import type {} from "../../src/app/testing/testHooks";
import type {} from "../../src/app/viewport/mountViewport";
import type * as CoreModel from "../../src/core/model";
import { record } from "./record";

// SE-031 (from the SE-030 review, E74): the marching ants redraw in a constant number of draw
// calls, and a non-contiguous magic-wand pick of a dithered area is the largest boundary a
// selection tool makes. Their ring was rebuilt at each view change in time proportional to the
// visible boundary; since SE-031's review a pan moves the ring and paints only the strips it
// uncovers (`ringPainter.ts`). This benchmark pans over such a selection on a 256×256 and a
// 1024×1024 document and times the overlay's redraw at each step of the pan. Run alone on the
// reference machine, one GPU at a time:
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts tests/perf/se-031-wand-pan.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts tests/perf/se-031-wand-pan.perf.ts
//
// (`swiftshader` also works; it is no reference.) Without PERF_GPU the benchmark is skipped.
//
// The app runs from a Vite dev server in installed Chrome, new headless, with the GPU flags of
// SE-002 and reduced motion, so the ants stand still and only the pan redraws the overlay.
// Each document is a checkerboard of two opaque colours, its corner at device pixel 32, 32:
// 256² at 4× and 1024² at 1×, 1024 device pixels a side either way. The overlay canvas is the
// viewport, smaller than the window (the rail, the dock and the timeline take the rest), so
// neither document fits it whole: its size and the part of the document on it are recorded
// (`overlayCanvas`, `visibleDocument`). The wand, Contiguous off, picks one of the colours with
// a real click: half the pixels, none touching another by an edge. Then the view moves by 3
// device pixels per step, one step per animation frame, back and forth, `STEPS` steps; each
// step changes the view, and the ants' ring work of each redraw is counted (`antsRingWork`). Every draw layer of the overlay is wrapped in the page to time it: the redraw is the
// sum of the layers' draws (the canvas's clear is not in it), the ants' layer is reported
// apart. What is timed is the JavaScript of the draws; the upload that `putImageData` hands to
// the browser and the blit of the surface on the GPU, which the browser may do later, are not
// in it. The redraws of the pick, which also work out the selection's boundary, are reported
// apart and are not in the statistic.
//
// Neither the ticket nor SPEC §6.6 states a budget for the pan: the record is for information
// (no `pass`). Its result is the 1024² document's p95; the 256² one's numbers are in its
// details. The orchestrator records it with PERF_RECORD=1 (docs/tickets/EXECUTION.md,
// Measurements): id `se-031-wand-pan-<gpu>`.

const WINDOW = { width: 1920, height: 1080 };
const RATIO = 1;
const STEPS = 120;
const STEP_PX = 3;
const CASES = [
    { side: 256, scale: 4 },
    { side: 1024, scale: 1 },
] as const;

interface GpuConfig {
    label: string;
    args: string[];
    vendor: string;
    architecture: RegExp;
}

const GPUS: Record<string, GpuConfig> = {
    "intel-uhd": {
        label: "Intel UHD",
        args: ["--force-low-power-gpu"],
        vendor: "intel",
        architecture: /^gen-12/,
    },
    "rtx-4060": {
        label: "RTX 4060",
        args: ["--force-high-performance-gpu"],
        vendor: "nvidia",
        architecture: /^lovelace$/,
    },
    swiftshader: {
        label: "SwiftShader",
        args: [
            "--use-webgpu-adapter=swiftshader",
            "--enable-unsafe-webgpu",
            "--enable-unsafe-swiftshader",
            ...(process.platform === "win32"
                ? []
                : [
                      "--no-sandbox",
                      "--enable-features=Vulkan",
                      "--use-angle=vulkan",
                      "--use-vulkan=swiftshader",
                      "--disable-vulkan-surface",
                  ]),
        ],
        vendor: "google",
        architecture: /^swiftshader$/,
    },
};

const gpuId = process.env.PERF_GPU ?? "";
const gpu = GPUS[gpuId];

/** One redraw of the overlay: the time of each layer's draw, by layer id. */
interface Redraw {
    layers: Record<string, number>;
    /** What the ants' draw did to their ring's pixels (`ringPainter.ts`). */
    antsWork?: string;
}

declare global {
    interface Window {
        __se031pan?: { redraws: Redraw[]; current: Redraw | null };
    }
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createNetServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() =>
                typeof address === "object" && address
                    ? resolve(address.port)
                    : reject(new Error("no port")),
            );
        });
    });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

function percentile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return Number.NaN;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function summary(values: readonly number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
        count: sorted.length,
        medianMs: round(percentile(sorted, 0.5)),
        p95Ms: round(percentile(sorted, 0.95)),
        maxMs: round(sorted.at(-1) ?? Number.NaN),
    };
}

/** Waits until the viewport is at rest and the overlay has drawn what was asked of it. */
async function quiet(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const hooks = window.__ngneTest;
            return hooks?.viewport?.settled === true && hooks.overlay?.pending === false;
        },
        undefined,
        { polling: 20, timeout: 30_000 },
    );
}

/** Wraps every draw layer of the overlay so that each redraw records its layers' times. */
async function instrument(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const path = "/src/app/overlay/overlayLayers.ts";
        const load = new Function("path", "return import(path)") as (
            path: string,
        ) => Promise<typeof OverlayLayersModule>;
        const { overlayLayers } = await load(path);
        const bench = { redraws: [] as Redraw[], current: null as Redraw | null };
        window.__se031pan = bench;
        overlayLayers.forEach((layer, index) => {
            const draw = layer.draw.bind(layer);
            layer.draw = (frame) => {
                if (index === 0) {
                    bench.current = { layers: {} };
                    bench.redraws.push(bench.current);
                }
                const start = performance.now();
                try {
                    draw(frame);
                } finally {
                    if (bench.current) {
                        bench.current.layers[layer.id] = performance.now() - start;
                        if (layer.id === "selection-ants") {
                            bench.current.antsWork = window.__ngneTest?.selectionAnts?.ringWork;
                        }
                    }
                }
            };
        });
    });
}

/** Opens a checkerboard document of `side`² at `scale`, its corner at 32, 32. */
async function openCheckerboard(page: Page, side: number, scale: number): Promise<string> {
    return page.evaluate(
        async ({ side, scale }) => {
            const load = new Function("path", "return import(path)") as (
                path: string,
            ) => Promise<typeof CoreModel>;
            const core = await load("/src/core/model/index.ts");
            const session = core.createDocument({
                name: `checker-${side}`,
                width: side,
                height: side,
            });
            const { doc } = session;
            const data = new Uint8ClampedArray(side * side * 4);
            for (let y = 0; y < side; y++) {
                for (let x = 0; x < side; x++) {
                    const at = (y * side + x) * 4;
                    const dark = (x + y) % 2 === 0;
                    data.set(dark ? [40, 40, 60, 255] : [220, 210, 160, 255], at);
                }
            }
            const imageId = `checker-image-${side}`;
            doc.images.set(imageId, { width: side, height: side, data });
            doc.cels.set(`${session.activeLayerId}:${session.activeFrameId}`, {
                imageId,
                opacity: 255,
            });
            doc.settings.pixelGrid = false;
            doc.settings.grid.visible = false;
            const state = window.__ngneTest!.sessions.getState();
            for (const open of state.documents) state.close(open.id);
            return state.open(session, { view: { scale, originX: 32, originY: 32 } }).id;
        },
        { side, scale },
    );
}

/** Pans the view `STEPS` steps, one per animation frame, each step waiting for its redraw. */
function pan(page: Page, id: string): Promise<void> {
    return page.evaluate(
        async ({ id, steps, step }) => {
            const hooks = window.__ngneTest!;
            const frame = () =>
                new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            for (let index = 0; index < steps; index++) {
                const state = hooks.sessions.getState();
                const view = state.documents.find((entry) => entry.id === id)!.view;
                // Back and forth: 20 steps one way, 20 the other.
                const direction = Math.floor(index / 20) % 2 === 0 ? 1 : -1;
                const before = hooks.overlay!.redraws;
                state.setView(id, {
                    originX: view.originX + direction * step,
                    originY: view.originY + direction * step,
                });
                while (hooks.overlay!.redraws === before || hooks.overlay!.pending) await frame();
            }
        },
        { id, steps: STEPS, step: STEP_PX },
    );
}

it.skipIf(!gpu)(
    `SE-031: overlay redraw while panning over a dithered wand selection, 256² and 1024² (${gpuId || "set PERF_GPU"})`,
    async () => {
        if (!gpu) return;
        const root = fileURLToPath(new URL("../../", import.meta.url));
        let server: ViteDevServer | null = null;
        let browser: Browser | null = null;
        try {
            const port = await freePort();
            server = await createServer({
                root,
                logLevel: "warn",
                server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null },
            });
            await server.listen();
            const args = [
                "--force-color-profile=srgb",
                ...gpu.args,
                `--force-device-scale-factor=${RATIO}`,
            ];
            browser = await chromium.launch({ channel: "chrome", headless: true, args });
            const context = await browser.newContext({
                viewport: WINDOW,
                deviceScaleFactor: RATIO,
                reducedMotion: "reduce",
            });
            const page = await context.newPage();
            const pageErrors: string[] = [];
            page.on("pageerror", (error) => void pageErrors.push(String(error)));
            await page.goto(`http://127.0.0.1:${port}/`);
            await page.waitForFunction(() => window.__ngneTest !== undefined, undefined, {
                timeout: 60_000,
            });
            // Vite may reload the page once after optimizing a dependency it found late.
            await sleep(2000);
            await page.waitForFunction(() => window.__ngneTest !== undefined);
            const adapter = await page.evaluate(async () => {
                const gpu = (
                    navigator as Navigator & {
                        gpu?: {
                            requestAdapter(): Promise<{ info: Record<string, unknown> } | null>;
                        };
                    }
                ).gpu;
                const info = (await gpu?.requestAdapter())?.info;
                return info
                    ? {
                          vendor: String(info.vendor),
                          architecture: String(info.architecture),
                          description: String(info.description),
                      }
                    : null;
            });
            if (
                !adapter ||
                adapter.vendor !== gpu.vendor ||
                !gpu.architecture.test(adapter.architecture)
            ) {
                throw new Error(
                    `WRONG WEBGPU ADAPTER: requested ${gpu.label}, got ${JSON.stringify(adapter)} ` +
                        `with ${args.join(" ")}. Nothing was measured.`,
                );
            }

            await instrument(page);
            /** The redraws recorded since the last call. */
            const takeRedraws = () => page.evaluate(() => window.__se031pan!.redraws.splice(0));
            const results: Record<string, unknown> = {};
            let result = Number.NaN;
            for (const { side, scale } of CASES) {
                const id = await openCheckerboard(page, side, scale);
                await quiet(page);
                await page.evaluate(() => {
                    const editor = window.__ngneTest!.editor.getState();
                    editor.setTool("wand");
                    editor.setToolOptions("wand", { contiguous: false, mode: "replace" });
                });
                await takeRedraws();
                // The wand's real click on texel (1, 0) (whose colour is every other pixel's).
                const box = (await page.locator("[data-viewport-canvas]").boundingBox())!;
                await page.mouse.click(
                    box.x + (32 + 1.5 * scale) / RATIO,
                    box.y + (32 + 0.5 * scale) / RATIO,
                );
                const picked = await page.evaluate((id) => {
                    const state = window.__ngneTest!.sessions.getState();
                    const selection = state.documents.find((entry) => entry.id === id)!.session
                        .selection;
                    if (!selection) return 0;
                    let count = 0;
                    for (const byte of selection.mask.data) {
                        for (let bit = byte; bit !== 0; bit &= bit - 1) count++;
                    }
                    return count;
                }, id);
                if (picked !== (side * side) / 2) {
                    throw new Error(
                        `se-031: the wand picked ${picked} pixels, not half of ${side}²`,
                    );
                }
                // The redraws of the pick work out the new selection's boundary: apart.
                await quiet(page);
                const pick = await takeRedraws();
                const shown = await page.evaluate((id) => {
                    const hooks = window.__ngneTest!;
                    const { view, session } = hooks.sessions
                        .getState()
                        .documents.find((entry) => entry.id === id)!;
                    const canvas = hooks.overlay!.canvasSize;
                    const width = session.doc.width * view.scale;
                    const height = session.doc.height * view.scale;
                    const x = Math.max(0, view.originX);
                    const y = Math.max(0, view.originY);
                    return {
                        overlayCanvas: `${canvas.width}×${canvas.height} device px`,
                        visibleDocument: {
                            x,
                            y,
                            width: Math.min(canvas.width, view.originX + width) - x,
                            height: Math.min(canvas.height, view.originY + height) - y,
                        },
                    };
                }, id);
                await pan(page, id);
                await quiet(page);
                const steps = await takeRedraws();
                const sum = (redraw: Redraw) =>
                    Object.values(redraw.layers).reduce((total, ms) => total + ms, 0);
                const overlayRedraw = summary(steps.map(sum));
                if (side === 1024) result = overlayRedraw.p95Ms;
                const work: Record<string, number> = {};
                for (const redraw of steps) {
                    const key = redraw.antsWork ?? "unknown";
                    work[key] = (work[key] ?? 0) + 1;
                }
                results[`side${side}`] = {
                    document: `${side}×${side} checkerboard at ${scale}×, its corner at device pixel 32, 32`,
                    ...shown,
                    selectedPixels: picked,
                    steps: steps.length,
                    overlayRedraw,
                    antsLayer: summary(steps.map((redraw) => redraw.layers["selection-ants"] ?? 0)),
                    antsRingWork: work,
                    redrawsOfThePick: {
                        note: "the pending area until the release, then the new selection's boundary and ring",
                        overlayRedraw: summary(pick.map(sum)),
                        antsLayer: summary(
                            pick.map((redraw) => redraw.layers["selection-ants"] ?? 0),
                        ),
                        previewLayer: summary(
                            pick.map((redraw) => redraw.layers["selection-preview"] ?? 0),
                        ),
                    },
                };
            }
            if (pageErrors.length > 0) throw new Error(`se-031: page errors: ${pageErrors[0]}`);
            record({
                id: `se-031-wand-pan-${gpuId}`,
                ticket: "SE-031",
                measurement:
                    "The JavaScript time of the overlay's redraw (the sum of its draw layers' " +
                    "draws; not the putImageData upload or the GPU blit the browser may do " +
                    `later) at each step of a pan of ${STEP_PX} device px per animation frame ` +
                    "over a non-contiguous magic-wand selection of a checkerboard (half the " +
                    "pixels, none touching by an edge) on a 1024² document at 1×, reduced " +
                    `motion, on ${gpu.label}; a 256² document at 4× in the details.`,
                statistic: `p95 over ${STEPS} pan steps of the 1024² document`,
                resultMs: result,
                details: {
                    ...results,
                    budget: "none: neither the ticket nor SPEC §6.6 states one",
                    devicePixelRatio: RATIO,
                    window: `${WINDOW.width}×${WINDOW.height} CSS px`,
                    adapter: `${adapter.vendor} / ${adapter.architecture} (${adapter.description})`,
                    chrome: `${browser.version()}, new headless, ${args.join(" ")}`,
                },
            });
            console.log(JSON.stringify(results, null, 4));
        } finally {
            await browser?.close();
            await server?.close();
        }
    },
);
