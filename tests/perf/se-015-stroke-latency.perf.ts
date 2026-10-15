import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, CDPSession, Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { it } from "vitest";
// Declares `window.__ngneTest` with the viewport and overlay probes (development builds).
import type {} from "../../src/app/overlay/mountOverlay";
import type {} from "../../src/app/testing/testHooks";
import type {} from "../../src/app/viewport/mountViewport";
import type * as CoreModel from "../../src/core/model";
import { record } from "./record";
import type { PerfEntry } from "./record";

// SE-015 and SPEC §6.6: the stroke budget. Pointer event to the submit of the frame that
// contains that sample, p95 ≤ 33 ms, on a 256 × 256 document with 8 layers, the pixel grid
// shown, at 8×. Run alone on the reference machine, one GPU at a time:
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts tests/perf/se-015-stroke-latency.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts tests/perf/se-015-stroke-latency.perf.ts
//
// (`swiftshader` also works; it is no reference.) Without PERF_GPU the benchmark is skipped.
//
// The app runs from a Vite dev server in installed Chrome, new headless, with the GPU flags
// of SE-002 (docs/spikes/SE-002-ngne-integration.md, GPU selection); the WebGPU adapter is
// checked, and a wrong one fails the run before anything is measured. Strokes are real mouse
// input sent through the DevTools protocol, without waiting for each event's
// acknowledgement, as a mouse reporting at 125 Hz: they reach the app as trusted pointer
// events, through its pointer pipeline, live composite and upload queue.
//
// How "the frame that contains a sample" is found, from outside the app: a stroke follows a
// planned path of texels that it never revisits, one texel per report, so what any composite
// shows of the stroke is a prefix of the path. The page wraps `createImageBitmap`: when a
// bitmap is built from the document's composite, the length of the prefix it shows is read
// from its pixels. That length follows the bitmap through NGNE's copy into a GPU texture, the
// texture's view and the bind group made of it (WebGPU calls wrapped in the page), and each
// submitted frame takes the longest prefix of the bind groups it drew with. A sample is in
// the first frame submitted after its event whose prefix reaches the sample's texel. Its
// latency is that submit's time less the event's `timeStamp` (one clock, the page's).
//
// Measured: one continuous stroke of 6 s (latency of every sample, and the longest one: the
// longest pointer-to-submitted gap of SPEC §6.6), and the first sample of 40 short strokes
// (the press composites the frame in full and copies the image). The result is the larger
// of the two p95s. Nothing here asserts the budget; the orchestrator records the number with
// PERF_RECORD=1 (docs/tickets/EXECUTION.md, Measurements).

const BUDGET_MS = 33;
const SIDE = 256;
const LAYERS = 8;
const SCALE = 8;
const WINDOW = { width: 1920, height: 1080 };
const RATIO = 1;
/** Mouse report rate, Hz; each report moves the pointer one texel. */
const RATE = 125;
const CONTINUOUS_MS = 6000;
const SHORT_STROKES = 40;
const SHORT_MOVES = 6;
/** The paint colour: no composite pixel of the document has it before it is painted. */
const PAINT = [255, 0, 255, 255] as const;

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

interface Texel {
    x: number;
    y: number;
}

interface AdapterInfo {
    vendor: string;
    architecture: string;
    description: string;
}

/** One pointer sample as the page received it. */
interface BenchSample {
    /** `timeStamp` of the event (or coalesced event), page clock. */
    t: number;
    x: number;
    y: number;
    kind: "down" | "move";
}

/** One frame submitted to the GPU, with the longest prefix of the path it drew. */
interface BenchFrame {
    t: number;
    prefix: number;
}

interface Bench {
    /** The path of the stroke in progress, in texels; null between strokes. */
    path: Texel[] | null;
    width: number;
    colour: readonly number[];
    samples: BenchSample[];
    frames: BenchFrame[];
    /** Submits that drew no texture of a known prefix. */
    otherSubmits: number;
    adapters: AdapterInfo[];
}

declare global {
    interface Window {
        __se015bench?: Bench;
    }
}

/** Runs in the page before its scripts: records samples and frames. Self-contained. */
function installBench(): void {
    const bench: Bench = {
        path: null,
        width: 0,
        colour: [],
        samples: [],
        frames: [],
        otherSubmits: 0,
        adapters: [],
    };
    window.__se015bench = bench;

    /** How many texels of the path, from its start, `data` (the document's size) shows painted. */
    const prefixOf = (data: Uint8ClampedArray): number => {
        const path = bench.path;
        if (!path) return 0;
        const [r, g, b, a] = bench.colour;
        const painted = (index: number) => {
            const texel = path[index]!;
            const at = (texel.y * bench.width + texel.x) * 4;
            return data[at] === r && data[at + 1] === g && data[at + 2] === b && data[at + 3] === a;
        };
        let low = 0;
        let high = path.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (painted(middle)) low = middle + 1;
            else high = middle;
        }
        return low;
    };

    const bitmaps = new WeakMap<object, number>();
    const textures = new WeakMap<object, number>();
    const views = new WeakMap<object, number>();
    const groups = new WeakMap<object, number>();
    let bound: number[] = [];
    const isObject = (value: unknown): value is object =>
        typeof value === "object" && value !== null;

    const makeBitmap = window.createImageBitmap as (...args: unknown[]) => Promise<ImageBitmap>;
    window.createImageBitmap = function (source: unknown, ...rest: unknown[]) {
        let prefix: number | undefined;
        if (source instanceof ImageData && bench.path && source.width === bench.width) {
            prefix = prefixOf(source.data);
        } else if (isObject(source)) {
            prefix = bitmaps.get(source);
        }
        const made = makeBitmap.call(window, source, ...rest);
        if (prefix !== undefined) {
            const known = prefix;
            void made.then(
                (bitmap) => void bitmaps.set(bitmap, known),
                () => undefined,
            );
        }
        return made;
    } as typeof window.createImageBitmap;

    type Method = (this: unknown, ...args: unknown[]) => unknown;
    const wrap = (owner: string, name: string, around: (original: Method) => Method): void => {
        const prototype = (globalThis as unknown as Record<string, { prototype: object }>)[owner]
            ?.prototype as Record<string, Method> | undefined;
        const original = prototype?.[name];
        if (prototype && original) prototype[name] = around(original);
    };

    wrap(
        "GPUQueue",
        "copyExternalImageToTexture",
        (original) =>
            function (this: unknown, ...args: unknown[]) {
                const [source, destination] = args as [{ source?: unknown }, { texture?: unknown }];
                const prefix = isObject(source?.source) ? bitmaps.get(source.source) : undefined;
                if (prefix !== undefined && isObject(destination?.texture)) {
                    textures.set(destination.texture, prefix);
                }
                return original.apply(this, args);
            },
    );
    wrap(
        "GPUTexture",
        "createView",
        (original) =>
            function (this: unknown, ...args: unknown[]) {
                const view = original.apply(this, args);
                const prefix = isObject(this) ? textures.get(this) : undefined;
                if (prefix !== undefined && isObject(view)) views.set(view, prefix);
                return view;
            },
    );
    wrap(
        "GPUDevice",
        "createBindGroup",
        (original) =>
            function (this: unknown, ...args: unknown[]) {
                const group = original.apply(this, args);
                const [descriptor] = args as [{ entries?: { resource?: unknown }[] }];
                for (const entry of descriptor?.entries ?? []) {
                    const prefix = isObject(entry.resource) ? views.get(entry.resource) : undefined;
                    if (prefix !== undefined && isObject(group)) groups.set(group, prefix);
                }
                return group;
            },
    );
    wrap(
        "GPURenderPassEncoder",
        "setBindGroup",
        (original) =>
            function (this: unknown, ...args: unknown[]) {
                const group = args[1];
                const prefix = isObject(group) ? groups.get(group) : undefined;
                if (prefix !== undefined) bound.push(prefix);
                return original.apply(this, args);
            },
    );
    wrap(
        "GPUQueue",
        "submit",
        (original) =>
            function (this: unknown, ...args: unknown[]) {
                const result = original.apply(this, args);
                const t = performance.now();
                if (bound.length > 0) bench.frames.push({ t, prefix: Math.max(...bound) });
                else bench.otherSubmits++;
                bound = [];
                return result;
            },
    );
    wrap(
        "GPUAdapter",
        "requestDevice",
        (original) =>
            function (this: unknown, ...args: unknown[]) {
                const info = (this as { info?: Record<string, unknown> }).info;
                bench.adapters.push({
                    vendor: String(info?.vendor ?? ""),
                    architecture: String(info?.architecture ?? ""),
                    description: String(info?.description ?? ""),
                });
                return original.apply(this, args);
            },
    );

    window.addEventListener(
        "pointerdown",
        (event) =>
            void bench.samples.push({
                t: event.timeStamp,
                x: event.clientX,
                y: event.clientY,
                kind: "down",
            }),
        true,
    );
    window.addEventListener(
        "pointermove",
        (event) => {
            const all = event.getCoalescedEvents?.() ?? [];
            for (const sample of all.length > 0 ? all : [event]) {
                bench.samples.push({
                    t: sample.timeStamp,
                    x: sample.clientX,
                    y: sample.clientY,
                    kind: "move",
                });
            }
        },
        true,
    );
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

/** Where the document's texels are on the page. */
interface Layout {
    /** Client position of the viewport element's top-left corner, CSS px. */
    left: number;
    top: number;
    ratio: number;
    view: { scale: number; originX: number; originY: number };
    /** The viewport element's size in device pixels. */
    device: { width: number; height: number };
}

/** The client position of the centre of a texel. */
function clientOf(layout: Layout, texel: Texel): Texel {
    const { ratio, view } = layout;
    const deviceLeft = Math.round(layout.left * ratio);
    const deviceTop = Math.round(layout.top * ratio);
    return {
        x: (deviceLeft + view.originX + (texel.x + 0.5) * view.scale) / ratio,
        y: (deviceTop + view.originY + (texel.y + 0.5) * view.scale) / ratio,
    };
}

/** The texel under a client position. */
function texelOf(layout: Layout, client: Texel): Texel {
    const { ratio, view } = layout;
    const device = {
        x: client.x * ratio - Math.round(layout.left * ratio),
        y: client.y * ratio - Math.round(layout.top * ratio),
    };
    return {
        x: Math.floor((device.x - view.originX) / view.scale),
        y: Math.floor((device.y - view.originY) / view.scale),
    };
}

interface StrokeResult {
    /** Latency of the press, when it was found in a frame. */
    first: number | null;
    /** Latency of every later sample that reached a new texel. */
    moves: number[];
    /** Samples that reached a new texel but no frame was found for. */
    missing: number;
    /** Longest time between two frames that each showed more of the stroke. */
    longestFrameGap: number;
    samples: number;
    frames: number;
    durationMs: number;
}

/** Waits until the stroke is committed and the viewport and overlay are at rest. */
async function quiet(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const hooks = window.__ngneTest;
            const state = hooks?.sessions.getState();
            const document = state?.documents.find((entry) => entry.id === state.activeId);
            return (
                document !== undefined &&
                document.history.transaction === null &&
                hooks?.viewport?.settled === true &&
                hooks.overlay?.pending === false
            );
        },
        undefined,
        { polling: 20, timeout: 30_000 },
    );
}

/**
 * Draws one stroke along `path` (a press on its first texel, one report per texel after it,
 * a release on its last) with the mouse at `RATE` Hz; returns the latencies found.
 */
async function strokeAlong(
    page: Page,
    cdp: CDPSession,
    layout: Layout,
    path: readonly Texel[],
): Promise<StrokeResult> {
    await quiet(page);
    await page.evaluate(
        (path) => {
            const bench = window.__se015bench!;
            bench.path = path;
            bench.samples = [];
            bench.frames = [];
        },
        [...path],
    );
    const errors: unknown[] = [];
    const send = (params: Record<string, unknown>) =>
        void cdp.send("Input.dispatchMouseEvent", params as never).catch((error: unknown) => {
            errors.push(error);
        });
    const start = clientOf(layout, path[0]!);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
    await sleep(100);
    const period = 1000 / RATE;
    const began = performance.now();
    send({
        type: "mousePressed",
        x: start.x,
        y: start.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
    });
    for (let index = 1; index < path.length; index++) {
        await sleep(began + index * period - performance.now());
        const client = clientOf(layout, path[index]!);
        send({ type: "mouseMoved", x: client.x, y: client.y, button: "left", buttons: 1 });
    }
    await sleep(began + path.length * period - performance.now());
    const end = clientOf(layout, path.at(-1)!);
    await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: end.x,
        y: end.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
    });
    const durationMs = performance.now() - began;
    if (errors.length > 0) throw new Error(`se-015: input failed: ${String(errors[0])}`);
    await quiet(page);
    const { samples, frames } = await page.evaluate(() => {
        const bench = window.__se015bench!;
        const result = { samples: bench.samples, frames: bench.frames };
        bench.path = null;
        return result;
    });

    const indexOf = new Map(path.map((texel, index) => [`${texel.x},${texel.y}`, index]));
    let reached = -1;
    let first: number | null = null;
    const moves: number[] = [];
    let missing = 0;
    // From the press on: the pointer hovered over the first texel before it.
    const press = samples.findIndex((sample) => sample.kind === "down");
    if (press === -1) throw new Error("se-015: the page saw no press");
    for (const sample of samples.slice(press)) {
        const texel = texelOf(layout, sample);
        const index = indexOf.get(`${texel.x},${texel.y}`);
        if (index === undefined || index <= reached) continue;
        reached = index;
        const frame = frames.find((entry) => entry.t >= sample.t && entry.prefix > index);
        if (!frame) {
            missing++;
            continue;
        }
        if (sample.kind === "down") first = frame.t - sample.t;
        else moves.push(frame.t - sample.t);
    }
    let longestFrameGap = 0;
    let shown = 0;
    let lastAdvance: number | null = null;
    for (const frame of frames) {
        if (frame.prefix <= shown) continue;
        if (lastAdvance !== null)
            longestFrameGap = Math.max(longestFrameGap, frame.t - lastAdvance);
        lastAdvance = frame.t;
        shown = frame.prefix;
    }
    if (shown !== path.length) {
        throw new Error(
            `se-015: the frames showed ${shown} of the ${path.length} texels of a stroke`,
        );
    }
    return {
        first,
        moves,
        missing,
        longestFrameGap,
        samples: samples.length,
        frames: frames.length,
        durationMs,
    };
}

/** Opens the benchmark document: 256 × 256, 8 layers with half-transparent content, at 8×. */
async function openBenchmarkDocument(page: Page): Promise<void> {
    await page.evaluate(
        async ({ side, layers, scale }) => {
            const path = "/src/core/model/index.ts";
            // Not `import()` itself: Vitest rewrites it in this file, and the function runs in
            // the page.
            const load = new Function("path", "return import(path)") as (
                path: string,
            ) => Promise<typeof CoreModel>;
            const core = await load(path);
            const session = core.createDocument({ name: "benchmark", width: side, height: side });
            const { doc } = session;
            const frameId = doc.frames[0]!.id;
            let seed = 7;
            const next = (below: number) => {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return Math.floor((seed / 2 ** 32) * below);
            };
            doc.layers = Array.from({ length: layers }, (_, index) => ({
                id: `bench-layer-${index}`,
                name: `Layer ${index + 1}`,
                kind: "pixel" as const,
                visible: true,
                locked: false,
                opacity: 255 - index,
                blend: "normal" as const,
            }));
            doc.cels.clear();
            doc.images.clear();
            for (const layer of doc.layers) {
                const data = new Uint8ClampedArray(side * side * 4);
                for (let at = 0; at < data.length; at += 4) {
                    data[at] = next(256);
                    // Never 0: no composite pixel is the paint colour before it is painted.
                    data[at + 1] = 1 + next(255);
                    data[at + 2] = next(256);
                    data[at + 3] = 1 + next(254);
                }
                const imageId = `bench-image-${layer.id}`;
                doc.images.set(imageId, { width: side, height: side, data });
                doc.cels.set(`${layer.id}:${frameId}`, { imageId, opacity: 255 });
            }
            // The top layer is painted on: opaque paint there is the composite's colour.
            doc.layers[layers - 1]!.opacity = 255;
            session.activeLayerId = doc.layers[layers - 1]!.id;
            session.activeFrameId = frameId;
            doc.settings.pixelGrid = true;
            window.__ngneTest!.sessions.getState().open(session, {
                view: { scale, originX: 16, originY: 16 },
            });
            window.__ngneTest!.assertInvariants();
        },
        { side: SIDE, layers: LAYERS, scale: SCALE },
    );
}

it.skipIf(!gpu)(
    `SE-015: stroke latency, ${SIDE}×${SIDE} with ${LAYERS} layers and the pixel grid at ${SCALE}× (${gpuId || "set PERF_GPU"})`,
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
            await page.addInitScript(installBench);
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
            const matches = (found: AdapterInfo | null | undefined) =>
                !!found && found.vendor === gpu.vendor && gpu.architecture.test(found.architecture);
            if (!matches(adapter)) {
                throw new Error(
                    `WRONG WEBGPU ADAPTER: requested ${gpu.label}, got ${JSON.stringify(adapter)} ` +
                        `with ${args.join(" ")}. Nothing was measured.`,
                );
            }

            await openBenchmarkDocument(page);
            await page.evaluate(
                ([r, g, b, a]) => {
                    const editor = window.__ngneTest!.editor.getState();
                    editor.setTool("pencil");
                    editor.setForeground(((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
                    const bench = window.__se015bench!;
                    bench.width = 256;
                    bench.colour = [r, g, b, a];
                },
                [...PAINT],
            );
            await quiet(page);
            const used = await page.evaluate(() => window.__se015bench!.adapters);
            for (const device of used) {
                if (!matches(device)) {
                    throw new Error(
                        `WRONG WEBGPU ADAPTER for NGNE's device: ${JSON.stringify(device)}`,
                    );
                }
            }
            if (used.length === 0) throw new Error("se-015: NGNE created no device");

            const layout: Layout = await page.evaluate(() => {
                const host = document.querySelector("[data-viewport-canvas]")!;
                const box = host.getBoundingClientRect();
                const state = window.__ngneTest!.sessions.getState();
                const document_ = state.documents.find((entry) => entry.id === state.activeId)!;
                const size = window.__ngneTest!.viewport!.canvasSize!;
                return {
                    left: box.left,
                    top: box.top,
                    ratio: devicePixelRatio,
                    view: { ...document_.view },
                    device: { width: size.width, height: size.height },
                };
            });
            // The texels on screen, less a margin.
            const columns = Math.min(
                SIDE,
                Math.floor((layout.device.width - layout.view.originX - 16) / SCALE),
            );
            const rows = Math.min(
                SIDE,
                Math.floor((layout.device.height - layout.view.originY - 16) / SCALE),
            );
            const cdp = await context.newCDPSession(page);

            // Short strokes: the first sample of each, on rows of their own.
            const firsts: number[] = [];
            const shortMoves: number[] = [];
            let missing = 0;
            const strokesPerRow = Math.floor(columns / (SHORT_MOVES + 3));
            for (let stroke = 0; stroke < SHORT_STROKES; stroke++) {
                const y = 2 * Math.floor(stroke / strokesPerRow);
                const x0 = (stroke % strokesPerRow) * (SHORT_MOVES + 3);
                const path = Array.from({ length: SHORT_MOVES + 1 }, (_, index) => ({
                    x: x0 + index,
                    y,
                }));
                const result = await strokeAlong(page, cdp, layout, path);
                if (result.first !== null) firsts.push(result.first);
                else missing++;
                shortMoves.push(...result.moves);
                missing += result.missing;
            }
            const usedRows = 2 * Math.ceil(SHORT_STROKES / strokesPerRow) + 2;

            // One continuous stroke: a serpentine over the rows below, one texel per report.
            const length = Math.ceil((CONTINUOUS_MS / 1000) * RATE);
            const path: Texel[] = [];
            let y = usedRows;
            let rightwards = true;
            while (path.length < length) {
                if (y >= rows) throw new Error("se-015: the viewport is too small for the stroke");
                for (let step = 0; step < columns && path.length < length; step++) {
                    path.push({ x: rightwards ? step : columns - 1 - step, y });
                }
                const x = rightwards ? columns - 1 : 0;
                path.push({ x, y: y + 1 });
                y += 2;
                path.push({ x, y });
                rightwards = !rightwards;
            }
            path.length = length;
            const continuous = await strokeAlong(page, cdp, layout, path);
            missing += continuous.missing;

            const browserVersion = browser.version();
            const overlayRedraws = await page.evaluate(() => window.__ngneTest!.overlay!.redraws);
            const stroke = summary(continuous.moves);
            const first = summary(firsts);
            const all = summary([...continuous.moves, ...shortMoves, ...firsts]);
            const resultMs = Math.max(stroke.p95Ms, first.p95Ms);
            if (pageErrors.length > 0) throw new Error(`se-015: page errors: ${pageErrors[0]}`);
            const entry: PerfEntry = {
                id: `se-015-stroke-latency-${gpuId}`,
                ticket: "SE-015",
                measurement:
                    "Pointer event to the submit of the frame containing that sample, for pencil " +
                    `strokes of real mouse input on a ${SIDE}×${SIDE} document with ${LAYERS} ` +
                    `layers and the pixel grid shown, at ${SCALE}× (SPEC §6.6), on ${gpu.label}.`,
                statistic:
                    "the larger of two p95s: every sample of one continuous stroke of " +
                    `${CONTINUOUS_MS / 1000} s, and the first sample of ${SHORT_STROKES} strokes`,
                budgetMs: BUDGET_MS,
                resultMs,
                details: {
                    continuousStroke: {
                        ...stroke,
                        longestPointerToSubmittedMs: stroke.maxMs,
                        longestGapBetweenFramesShowingMoreMs:
                            Math.round(continuous.longestFrameGap * 100) / 100,
                        durationMs: Math.round(continuous.durationMs),
                        texels: path.length,
                        samples: continuous.samples,
                        framesSubmitted: continuous.frames,
                    },
                    firstSample: first,
                    allSamples: all,
                    samplesWithoutFrame: missing,
                    echo: "off",
                    input: `mouse at ${RATE} Hz, one texel (${SCALE} device px) per report, ${(RATE * SCALE) / RATIO} CSS px/s`,
                    document: `${SIDE}×${SIDE}, ${LAYERS} layers with half-transparent content, pixel grid on`,
                    zoom: SCALE,
                    devicePixelRatio: layout.ratio,
                    window: `${WINDOW.width}×${WINDOW.height} CSS px`,
                    viewportDevicePx: `${layout.device.width}×${layout.device.height}`,
                    overlayRedraws,
                    adapter: `${adapter?.vendor} / ${adapter?.architecture} (${adapter?.description})`,
                    chrome: `${browserVersion}, new headless, ${args.join(" ")}`,
                },
            };
            record(entry);
            console.log(JSON.stringify(entry.details, null, 4));
        } finally {
            await browser?.close();
            await server?.close();
        }
    },
);
