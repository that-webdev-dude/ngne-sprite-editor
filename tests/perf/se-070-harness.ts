import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { build, createServer, preview } from "vite";
import type { PreviewServer, ViteDevServer } from "vite";
// Declares `window.__ngneTest` with the viewport and preview probes (development builds).
import type {} from "../../src/app/preview/mountPreview";
import type {} from "../../src/app/testing/testHooks";
import type {} from "../../src/app/viewport/mountViewport";
import type * as CoreModel from "../../src/core/model";

// SE-070: what the browser benchmarks of SPEC §6.6 that SE-070 adds share. They are written
// as the earlier ones (se-015, se-024): installed Chrome, new headless, with the GPU flags of
// SE-002 chosen by PERF_GPU (`intel-uhd`, `rtx-4060` or `swiftshader`, which is no
// reference); the WebGPU adapter is checked and a wrong one fails the run before anything is
// measured; without PERF_GPU the benchmark is skipped. The app runs in the default layout,
// the preview panel expanded (REVIEW.md F68 M).

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface GpuConfig {
    id: string;
    label: string;
    args: string[];
    vendor: string;
    architecture: RegExp;
}

const GPUS: Record<string, Omit<GpuConfig, "id">> = {
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

/** The GPU PERF_GPU names, or null: the benchmark is then skipped. */
export function selectedGpu(): GpuConfig | null {
    const id = process.env.PERF_GPU ?? "";
    const config = GPUS[id];
    return config ? { id, ...config } : null;
}

export const WINDOW = { width: 1920, height: 1080 };
export const RATIO = 1;

export function freePort(): Promise<number> {
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

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** The value at `fraction` of the sorted samples, nearest rank. */
export function percentile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return Number.NaN;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function summary(values: readonly number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
        count: sorted.length,
        medianMs: round(percentile(sorted, 0.5)),
        p95Ms: round(percentile(sorted, 0.95)),
        maxMs: round(sorted.at(-1) ?? Number.NaN),
    };
}

/** The Chrome arguments of a run: sRGB, the GPU's flags, the device pixel ratio. */
export function chromeArgs(gpu: GpuConfig): string[] {
    return ["--force-color-profile=srgb", ...gpu.args, `--force-device-scale-factor=${RATIO}`];
}

export function launch(gpu: GpuConfig): Promise<Browser> {
    return chromium.launch({ channel: "chrome", headless: true, args: chromeArgs(gpu) });
}

export function newContext(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({ viewport: WINDOW, deviceScaleFactor: RATIO });
}

export interface AdapterInfo {
    vendor: string;
    architecture: string;
    description: string;
}

/** Reads the page's WebGPU adapter and throws unless it is the one PERF_GPU asked for. */
export async function checkAdapter(page: Page, gpu: GpuConfig): Promise<AdapterInfo> {
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
    if (!adapter || adapter.vendor !== gpu.vendor || !gpu.architecture.test(adapter.architecture)) {
        throw new Error(
            `WRONG WEBGPU ADAPTER: requested ${gpu.label}, got ${JSON.stringify(adapter)} ` +
                `with ${chromeArgs(gpu).join(" ")}. Nothing was measured.`,
        );
    }
    return adapter;
}

/** What a record's details say of the run's browser and adapter. */
export function environmentDetails(browser: Browser, gpu: GpuConfig, adapter: AdapterInfo) {
    return {
        devicePixelRatio: RATIO,
        window: `${WINDOW.width}×${WINDOW.height} CSS px`,
        adapter: `${adapter.vendor} / ${adapter.architecture} (${adapter.description})`,
        chrome: `${browser.version()}, new headless, ${chromeArgs(gpu).join(" ")}`,
    };
}

/** A Vite dev server of the checkout on a free port, as the earlier benchmarks run the app. */
export async function startDevServer(): Promise<{ server: ViteDevServer; url: string }> {
    const port = await freePort();
    const server = await createServer({
        root: ROOT,
        logLevel: "warn",
        server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null },
    });
    await server.listen();
    return { server, url: `http://127.0.0.1:${port}/` };
}

/**
 * The production build of the checkout (`vite build`, the project's own configuration) into a
 * folder of its own, served by `vite preview` on a free port. `close` stops the server and
 * removes the folder.
 */
export async function startProductionServer(): Promise<{
    server: PreviewServer;
    url: string;
    close(): Promise<void>;
}> {
    const outDir = mkdtempSync(join(tmpdir(), "se-070-build-"));
    // Vitest runs with NODE_ENV=test, under which Vite would build with `import.meta.env.DEV`
    // true (and the app's test hook in it): the build is the production one of `npm run build`.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
        await build({
            root: ROOT,
            mode: "production",
            logLevel: "error",
            build: { outDir, emptyOutDir: true },
        });
    } finally {
        process.env.NODE_ENV = nodeEnv;
    }
    const port = await freePort();
    const server = await preview({
        root: ROOT,
        logLevel: "warn",
        build: { outDir },
        preview: { host: "127.0.0.1", port, strictPort: true, open: false },
    });
    return {
        server,
        url: `http://127.0.0.1:${port}/`,
        async close() {
            await server.close();
            rmSync(outDir, { recursive: true, force: true });
        },
    };
}

/** Opens the app of the dev server and waits for its test hook, past Vite's first reload. */
export async function openApp(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await page.waitForFunction(() => window.__ngneTest !== undefined, undefined, {
        timeout: 60_000,
    });
    // Vite may reload the page once after optimizing a dependency it found late.
    await sleep(2000);
    await page.waitForFunction(() => window.__ngneTest !== undefined);
}

/** The reference document of SPEC §6.6: 256 × 256 with 8 layers. */
export const SIDE = 256;
export const LAYERS = 8;

/**
 * Opens the reference document of SPEC §6.6 with `frames` frames as the only document, at 2×
 * with the grids off, the bottom layer active; returns its id. As in SE-024's benchmark: the
 * bottom layer has an opaque image of its own in each frame (frame i differs from every other
 * in each pixel's red channel), the seven above a translucent band each, linked across the
 * frames; the composite blends all eight.
 */
export function openReferenceDocument(page: Page, frames: number): Promise<string> {
    return page.evaluate(
        async ({ frames, side, layers }) => {
            const load = new Function("path", "return import(path)") as (
                path: string,
            ) => Promise<typeof CoreModel>;
            const core = await load("/src/core/model/index.ts");
            const session = core.createDocument({ name: "reference", width: side, height: side });
            const { doc } = session;
            const base = doc.layers[0]!;
            doc.layers = Array.from({ length: layers }, (_, index) => ({
                ...base,
                id: index === 0 ? base.id : `layer-${index + 1}`,
                name: `Layer ${index + 1}`,
            }));
            const first = doc.frames[0]!;
            doc.frames = Array.from({ length: frames }, (_, index) => ({
                id: index === 0 ? first.id : `frame-${index + 1}`,
                durationMs: 100,
            }));
            doc.layers.slice(1).forEach((layer, index) => {
                const data = new Uint8ClampedArray(side * side * 4);
                for (let y = index * 24; y < index * 24 + 12; y++) {
                    for (let x = 0; x < side; x++)
                        data.set([255, 255, 255, 96], (y * side + x) * 4);
                }
                const imageId = `band-${index}`;
                doc.images.set(imageId, { width: side, height: side, data });
                for (const frame of doc.frames) {
                    doc.cels.set(core.celKey(layer.id, frame.id), { imageId, opacity: 255 });
                }
            });
            doc.frames.forEach((frame, index) => {
                const data = new Uint8ClampedArray(side * side * 4);
                for (let at = 0; at < data.length; at += 4) {
                    const pixel = at / 4;
                    data.set([(index * 4) & 255, (pixel >> 8) & 255, pixel & 255, 255], at);
                }
                const imageId = `frame-image-${index}`;
                doc.images.set(imageId, { width: side, height: side, data });
                doc.cels.set(core.celKey(base.id, frame.id), { imageId, opacity: 255 });
            });
            session.activeLayerId = base.id;
            session.activeFrameId = first.id;
            doc.settings.pixelGrid = false;
            doc.settings.grid.visible = false;
            const state = window.__ngneTest!.sessions.getState();
            for (const open of state.documents) state.close(open.id);
            const id = state.open(session, { view: { scale: 2, originX: 32, originY: 32 } }).id;
            window.__ngneTest!.assertInvariants();
            return id;
        },
        { frames, side: SIDE, layers: LAYERS },
    );
}

/** Waits until the viewport is at rest: nothing uploading, drawing or being replaced. */
export async function viewportSettled(page: Page): Promise<void> {
    await page.waitForFunction(() => window.__ngneTest?.viewport?.settled === true, undefined, {
        polling: 20,
        timeout: 30_000,
    });
}

/**
 * Throws unless the preview panel is expanded and playing (the default layout, REVIEW.md F68
 * M): its dock section's toggle says expanded, its game has a canvas with a box, and the
 * game renders frames — at least 3 more within 10 s (it plays 100 ms entries).
 */
export async function expectPreviewExpanded(page: Page): Promise<void> {
    const toggle = await page.evaluate(
        () =>
            document
                .querySelector('[data-dock-panel="preview"] .dock-section__toggle')
                ?.getAttribute("aria-expanded") ?? null,
    );
    if (toggle !== "true") {
        throw new Error(
            `se-070: the preview panel is not expanded (aria-expanded: ${toggle}). Nothing was measured.`,
        );
    }
    try {
        await page.waitForFunction(
            () => {
                const canvas = document.querySelector(
                    '[data-dock-panel="preview"] [data-preview-canvas] canvas',
                );
                const box = canvas?.getBoundingClientRect();
                return (
                    window.__ngneTest?.preview?.lifecycle != null &&
                    box !== undefined &&
                    box.width > 0 &&
                    box.height > 0
                );
            },
            undefined,
            { timeout: 30_000 },
        );
        const start = await page.evaluate(() => window.__ngneTest!.preview!.frames);
        await page.waitForFunction(
            (start) => (window.__ngneTest?.preview?.frames ?? 0) >= start + 3,
            start,
            { timeout: 10_000, polling: 50 },
        );
    } catch (error) {
        throw new Error(
            `se-070: the expanded preview shows no playing game (${String(error)}). Nothing was measured.`,
            { cause: error },
        );
    }
}
