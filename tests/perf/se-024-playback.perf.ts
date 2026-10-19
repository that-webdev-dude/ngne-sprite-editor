import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { it } from "vitest";
// Declares `window.__ngneTest` with the viewport probe (development builds).
import type {} from "../../src/app/testing/testHooks";
import type {} from "../../src/app/viewport/mountViewport";
import type * as PlaybackModule from "../../src/app/playback/playback";
import type * as ViewportLinkModule from "../../src/app/viewport/viewportLink";
import type * as CoreModel from "../../src/core/model";
import { record } from "./record";

// SE-024 (SPEC §6.6): editor playback from `ed:play`, 64 frames of 256×256, 100 ms each, with
// no skipped frame. Run alone on the reference machine, one GPU at a time:
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts tests/perf/se-024-playback.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts tests/perf/se-024-playback.perf.ts
//
// (`swiftshader` also works; it is no reference.) Without PERF_GPU the benchmark is skipped.
//
// The app runs from a Vite dev server in installed Chrome, new headless, with the GPU flags of
// SE-002. The document is the reference one of SPEC §6.6: 256×256 with 8 layers; the bottom
// layer has an image of its own in each frame, the seven above are linked across the frames
// (the composite still blends all eight). Playback starts with `ed:play` (Play / Pause, the
// registry's command) on the page's own clock; the measurement begins once the viewport draws
// from the `ed:play` grid of the 64 frames and has run a second more, and lasts two passes
// (12.8 s). An entry of the sequence is skipped when no frame the viewport submits while it is
// the active one shows its frame. The viewport must upload nothing meanwhile: every frame comes
// from the grid. The result is the number of entries skipped (a count; `record.ts` labels every
// result ms), against SPEC §6.6's budget of none. The lateness of each entry's first frame
// after the entry began, the gaps between frames that change the picture and the frames
// submitted per second are in the details.

const WINDOW = { width: 1920, height: 1080 };
const RATIO = 1;
const FRAMES = 64;
const SIDE = 256;
const LAYERS = 8;
const DURATION_MS = 100;
const PASSES = 2;

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

/** What the page records while playback runs. */
interface Recording {
    /** Each change of the active frame playback made: its frame and when. */
    entries: { frameId: string; at: number }[];
    /** Each frame the viewport submitted: the frame key it drew and when. */
    drawn: { key: string | null; at: number }[];
    /** Wall time and counters at the start and the end of the window. */
    start: { at: number; submitted: number; uploads: number };
    end: { at: number; submitted: number; uploads: number; grid: number | null };
}

declare global {
    interface Window {
        __se024bench?: Recording;
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

/** Opens the 64-frame, 8-layer document at 2× with the grids off; returns its id. */
function openAnimation(page: Page): Promise<string> {
    return page.evaluate(
        async ({ frames, side, layers, duration }) => {
            const load = new Function("path", "return import(path)") as (
                path: string,
            ) => Promise<typeof CoreModel>;
            const core = await load("/src/core/model/index.ts");
            const session = core.createDocument({ name: "playback", width: side, height: side });
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
                durationMs: duration,
            }));
            // The layers above the bottom one: a translucent band each, linked across frames.
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
            // The bottom layer: an opaque image of its own in each frame.
            doc.frames.forEach((frame, index) => {
                const data = new Uint8ClampedArray(side * side * 4);
                for (let at = 0; at < data.length; at += 4) {
                    const pixel = at / 4;
                    data.set([index * 4, (pixel >> 8) & 255, pixel & 255, 255], at);
                }
                const imageId = `frame-image-${index}`;
                doc.images.set(imageId, { width: side, height: side, data });
                doc.cels.set(core.celKey(base.id, frame.id), { imageId, opacity: 255 });
            });
            session.activeFrameId = first.id;
            doc.settings.pixelGrid = false;
            doc.settings.grid.visible = false;
            const state = window.__ngneTest!.sessions.getState();
            for (const open of state.documents) state.close(open.id);
            return state.open(session, { view: { scale: 2, originX: 32, originY: 32 } }).id;
        },
        { frames: FRAMES, side: SIDE, layers: LAYERS, duration: DURATION_MS },
    );
}

/** Starts playback and records the active frame's changes and the viewport's frames. */
function startRecording(page: Page): Promise<void> {
    return page.evaluate(async () => {
        const load = new Function("path", "return import(path)") as (
            path: string,
        ) => Promise<unknown>;
        const { viewportLink } = (await load(
            "/src/app/viewport/viewportLink.ts",
        )) as typeof ViewportLinkModule;
        const hooks = window.__ngneTest!;
        const probe = hooks.viewport!;
        const bench: Recording = {
            entries: [],
            drawn: [],
            start: { at: 0, submitted: 0, uploads: 0 },
            end: { at: 0, submitted: 0, uploads: 0, grid: null },
        };
        window.__se024bench = bench;
        let active: string | null = null;
        let recording = false;
        hooks.sessions.subscribe((state) => {
            const document = state.documents.find((entry) => entry.id === state.activeId);
            const frameId = document?.session.activeFrameId ?? null;
            if (frameId === active) return;
            active = frameId;
            if (recording && frameId) bench.entries.push({ frameId, at: performance.now() });
        });
        viewportLink.onDrawn((frame) => {
            if (recording) bench.drawn.push({ key: frame?.key ?? null, at: performance.now() });
        });
        if (!hooks.commands.get("frame.playPause")?.enabled()) {
            throw new Error("se-024: Play / Pause is not enabled");
        }
        await hooks.commands.get("frame.playPause")!.run();
        // The grid of the 64 frames is drawn from; then one second more.
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const deadline = performance.now() + 30_000;
        while (probe.playGrid?.cells !== 64) {
            if (performance.now() > deadline) throw new Error("se-024: no ed:play grid");
            await frame();
        }
        const settled = performance.now() + 1000;
        while (performance.now() < settled) await frame();
        bench.start = {
            at: performance.now(),
            submitted: probe.submittedFrames,
            uploads: probe.textureCalls,
        };
        recording = true;
    });
}

function stopRecording(page: Page): Promise<Recording> {
    return page.evaluate(async () => {
        const load = new Function("path", "return import(path)") as (
            path: string,
        ) => Promise<typeof PlaybackModule>;
        const { editorPlayback } = await load("/src/app/playback/playback.ts");
        const bench = window.__se024bench!;
        const probe = window.__ngneTest!.viewport!;
        bench.end = {
            at: performance.now(),
            submitted: probe.submittedFrames,
            uploads: probe.textureCalls,
            grid: probe.playGrid?.cells ?? null,
        };
        const playing = editorPlayback.playing;
        editorPlayback.stop();
        if (!playing) throw new Error("se-024: playback stopped during the measurement");
        return bench;
    });
}

/**
 * The entries of the window (the first and the last, which the window cuts, left out) and
 * which of them no submitted frame showed while they were active.
 */
function analyse(recording: Recording) {
    const { entries, drawn } = recording;
    const lateness: number[] = [];
    const skipped: { frameId: string; at: number }[] = [];
    for (let index = 1; index < entries.length - 1; index++) {
        const entry = entries[index]!;
        const next = entries[index + 1]!;
        const key = `${entry.frameId}:plain`;
        const first = drawn.find(
            (frame) => frame.key === key && frame.at >= entry.at && frame.at < next.at,
        );
        if (first) lateness.push(first.at - entry.at);
        else
            skipped.push({ frameId: entry.frameId, at: Math.round(entry.at - recording.start.at) });
    }
    // The gaps between frames that showed another frame than the one before.
    const changes: number[] = [];
    let last: { key: string | null; at: number } | null = null;
    for (const frame of drawn) {
        if (last && frame.key !== last.key) changes.push(frame.at - last.at);
        if (!last || frame.key !== last.key) last = frame;
    }
    return { entries: Math.max(0, entries.length - 2), lateness, skipped, changes };
}

it.skipIf(!gpu)(
    `SE-024: editor playback from ed:play, 64 frames of 256², 100 ms each (${gpuId || "set PERF_GPU"})`,
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

            await openAnimation(page);
            await page.waitForFunction(
                () => window.__ngneTest?.viewport?.settled === true,
                undefined,
                {
                    polling: 20,
                    timeout: 30_000,
                },
            );
            await startRecording(page);
            await sleep(PASSES * FRAMES * DURATION_MS);
            const recording = await stopRecording(page);
            if (pageErrors.length > 0) throw new Error(`se-024: page errors: ${pageErrors[0]}`);

            const uploads = recording.end.uploads - recording.start.uploads;
            if (uploads !== 0 || recording.end.grid !== FRAMES) {
                throw new Error(
                    `se-024: playback did not draw from ed:play alone (${uploads} uploads, grid ` +
                        `${recording.end.grid}). Nothing was measured.`,
                );
            }
            const { entries, lateness, skipped, changes } = analyse(recording);
            const seconds = (recording.end.at - recording.start.at) / 1000;
            const details = {
                entries,
                skippedEntries: skipped,
                firstFrameAfterEntry: summary(lateness),
                gapsBetweenPictureChanges: summary(changes),
                framesSubmittedPerSecond:
                    Math.round(
                        ((recording.end.submitted - recording.start.submitted) / seconds) * 10,
                    ) / 10,
                windowSeconds: Math.round(seconds * 100) / 100,
                document: `${SIDE}×${SIDE}, ${LAYERS} layers, ${FRAMES} frames of ${DURATION_MS} ms, at 2×`,
                devicePixelRatio: RATIO,
                window: `${WINDOW.width}×${WINDOW.height} CSS px`,
                adapter: `${adapter.vendor} / ${adapter.architecture} (${adapter.description})`,
                chrome: `${browser.version()}, new headless, ${args.join(" ")}`,
            };
            record({
                id: `se-024-playback-${gpuId}`,
                ticket: "SE-024",
                measurement:
                    `Editor playback from the ed:play grid of ${FRAMES} frames of ${SIDE}×${SIDE} ` +
                    `(${LAYERS} layers), ${DURATION_MS} ms each, at 1× speed on the page's clock, ` +
                    `${PASSES} passes, Chrome on ${gpu.label}: entries of the sequence that no ` +
                    "submitted frame showed while they were the active frame.",
                statistic: `entries skipped of ${entries} (a count, not milliseconds)`,
                budgetMs: 0,
                resultMs: skipped.length,
                details,
            });
            console.log(JSON.stringify(details, null, 4));
        } finally {
            await browser?.close();
            await server?.close();
        }
    },
);
