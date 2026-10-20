import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { it } from "vitest";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { record } from "./record";

// SE-026: the timeline grid is virtualized (only the cells in view and a margin are in the DOM),
// and a scripted scroll of a 200-frame × 30-layer document averages at least 50 frames per
// second on the reference hardware. This benchmark scrolls the timeline panel of the real app,
// one step per animation frame, and measures the frame rate the page keeps meanwhile. Run alone
// on the reference machine, one GPU at a time:
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts tests/perf/se-026-timeline-scroll.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts tests/perf/se-026-timeline-scroll.perf.ts
//
// (`swiftshader` also works; it is no reference.) Without PERF_GPU the benchmark is skipped: the
// editor needs a WebGPU adapter to start.
//
// The app runs from a Vite dev server in installed Chrome, new headless, at 1920×1080 CSS px and
// DPR 1. The document is 16×16 with 30 pixel layers and 200 frames; every other cel holds an
// image of its own (a checkerboard of filled and empty cels), so both dot styles are drawn. The
// timeline panel keeps its default size. The scroll: `STEPS` animation frames, each moving the
// panel's scroller by `STEP_X` px across and `STEP_Y` px down, turning back at either end (a
// diagonal zigzag over the whole grid, faster than a wheel), after `WARM_UP` frames of the same
// that are not counted. Each step is set in an animation frame callback; the frame rate is the
// number of frames over the time between the first and the last callback. Before the scroll the
// page idles for `IDLE` frames, whose rate shows the display's refresh rate under the same
// conditions (a slow machine phase shows there too: compare `idleFps` across runs). The number of
// cels' cells in the DOM is sampled every 10 frames.
//
// Budget (SE-026 acceptance): an average of at least 50 fps, i.e. an average frame interval of at
// most 20 ms; `resultMs` is that average interval. The orchestrator records it with
// PERF_RECORD=1 (docs/tickets/EXECUTION.md, Measurements): id `se-026-timeline-scroll-<gpu>`.

const WINDOW = { width: 1920, height: 1080 };
const LAYERS = 30;
const FRAMES = 200;
const IDLE = 120;
const WARM_UP = 60;
const STEPS = 600;
const STEP_X = 37;
const STEP_Y = 9;
const BUDGET_MS = 1000 / 50;

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

/** Opens the benchmark's document, its active cel the first layer's at the first frame. */
async function openDocument(page: Page): Promise<void> {
    await page.evaluate(
        ({ layers, frames }) => {
            const hooks = window.__ngneTest!;
            const state = hooks.sessions.getState();
            for (const open of state.documents) state.close(open.id);
            hooks.openSession({ name: "scroll", width: 16, height: 16 });
            const run = (id: string) => void hooks.commands.get(id)!.run();
            for (let layer = 1; layer < layers; layer++) run("layer.new");
            for (let frame = 1; frame < frames; frame++) run("frame.newEmpty");
            const current = hooks.sessions.getState();
            const document = current.documents.find((entry) => entry.id === current.activeId)!;
            const { session } = document;
            const { doc } = session;
            doc.layers.forEach((layer, row) => {
                doc.frames.forEach((frame, column) => {
                    if ((row + column) % 2 === 1) return;
                    const imageId = `scroll-${row}-${column}`;
                    const data = new Uint8ClampedArray(16 * 16 * 4).fill(row + column);
                    doc.images.set(imageId, { width: 16, height: 16, data });
                    doc.cels.set(`${layer.id}:${frame.id}`, { imageId, opacity: 255 });
                });
            });
            session.activeLayerId = doc.layers[doc.layers.length - 1]!.id;
            session.activeFrameId = doc.frames[0]!.id;
            current.touch(document.id);
        },
        { layers: LAYERS, frames: FRAMES },
    );
    await page.waitForFunction(
        ({ layers, frames }) => {
            const grid = document.querySelector('[role="grid"][aria-label="Cels"]');
            return (
                grid?.querySelectorAll('[role="rowheader"]').length === layers &&
                grid.querySelectorAll(".timeline__frame").length === frames
            );
        },
        { layers: LAYERS, frames: FRAMES },
        { timeout: 60_000 },
    );
}

interface ScrollRun {
    idleIntervals: number[];
    intervals: number[];
    cells: number[];
    panel: { width: number; height: number; scrollWidth: number; scrollHeight: number };
}

/** Idles `IDLE` frames, then scrolls `WARM_UP` + `STEPS` frames, one step per frame. */
function scroll(page: Page): Promise<ScrollRun> {
    return page.evaluate(
        async ({ idle, warmUp, steps, stepX, stepY }) => {
            const panel = document.querySelector<HTMLElement>("[data-timeline]")!;
            const frame = () =>
                new Promise<number>((resolve) => requestAnimationFrame((time) => resolve(time)));
            const intervalsOf = (times: number[]) =>
                times.slice(1).map((time, index) => time - times[index]!);
            const idleTimes: number[] = [];
            for (let index = 0; index <= idle; index++) idleTimes.push(await frame());
            panel.scrollLeft = 0;
            panel.scrollTop = 0;
            let dx = stepX;
            let dy = stepY;
            const times: number[] = [];
            const cells: number[] = [];
            for (let index = 0; index < warmUp + steps; index++) {
                const time = await frame();
                const maxLeft = panel.scrollWidth - panel.clientWidth;
                const maxTop = panel.scrollHeight - panel.clientHeight;
                if (panel.scrollLeft + dx > maxLeft || panel.scrollLeft + dx < 0) dx = -dx;
                if (panel.scrollTop + dy > maxTop || panel.scrollTop + dy < 0) dy = -dy;
                panel.scrollLeft += dx;
                panel.scrollTop += dy;
                if (index < warmUp) continue;
                times.push(time);
                if (index % 10 === 0) {
                    cells.push(panel.querySelectorAll('[role="gridcell"]').length);
                }
            }
            // The last step's frame.
            times.push(await frame());
            return {
                idleIntervals: intervalsOf(idleTimes),
                intervals: intervalsOf(times),
                cells,
                panel: {
                    width: panel.clientWidth,
                    height: panel.clientHeight,
                    scrollWidth: panel.scrollWidth,
                    scrollHeight: panel.scrollHeight,
                },
            };
        },
        { idle: IDLE, warmUp: WARM_UP, steps: STEPS, stepX: STEP_X, stepY: STEP_Y },
    );
}

function percentile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return Number.NaN;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

const round = (value: number) => Math.round(value * 100) / 100;
const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

it.skipIf(!gpu)(
    `SE-026: frame rate of a scripted scroll of the timeline, 200 frames × 30 layers (${gpuId || "set PERF_GPU"})`,
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
                "--force-device-scale-factor=1",
            ];
            browser = await chromium.launch({ channel: "chrome", headless: true, args });
            const context = await browser.newContext({ viewport: WINDOW, deviceScaleFactor: 1 });
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

            await openDocument(page);
            await sleep(1000);
            const run = await scroll(page);
            if (pageErrors.length > 0) throw new Error(`se-026: page errors: ${pageErrors[0]}`);
            const sorted = [...run.intervals].sort((a, b) => a - b);
            const averageMs = mean(run.intervals);
            const idleMs = mean(run.idleIntervals);
            const entry = {
                id: `se-026-timeline-scroll-${gpuId}`,
                ticket: "SE-026",
                measurement:
                    "Average animation frame interval while the timeline panel of a 200-frame × " +
                    `30-layer document is scrolled by ${STEP_X} px across and ${STEP_Y} px down ` +
                    `per frame in a zigzag over the whole grid (1920×1080, DPR 1, ${gpu.label})`,
                statistic: `mean over ${STEPS} scroll frames (after ${WARM_UP} not counted)`,
                budgetMs: BUDGET_MS,
                resultMs: round(averageMs),
                details: {
                    fps: round(1000 / averageMs),
                    budget: "at least 50 fps on average (SE-026 acceptance): 20 ms",
                    framesScrolled: run.intervals.length,
                    p95IntervalMs: round(percentile(sorted, 0.95)),
                    maxIntervalMs: round(sorted.at(-1) ?? Number.NaN),
                    idleFps: round(1000 / idleMs),
                    cellsInDom: {
                        max: Math.max(...run.cells),
                        min: Math.min(...run.cells),
                        withoutVirtualization: LAYERS * FRAMES,
                    },
                    panel: `${run.panel.width}×${run.panel.height} CSS px, content ${run.panel.scrollWidth}×${run.panel.scrollHeight}`,
                    window: `${WINDOW.width}×${WINDOW.height} CSS px`,
                    adapter: `${adapter.vendor} / ${adapter.architecture} (${adapter.description})`,
                    chrome: `${browser.version()}, new headless, ${args.join(" ")}`,
                },
            };
            record(entry);
            // The record prints its result only; the details are printed here.
            console.log(JSON.stringify(entry.details, null, 4));
        } finally {
            await browser?.close();
            await server?.close();
        }
    },
);
