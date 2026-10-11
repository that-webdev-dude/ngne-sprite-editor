// SE-002 spike runner: one command per GPU.
//
//   node spikes/ngne/runner/run.ts --gpu=intel-uhd
//   node spikes/ngne/runner/run.ts --gpu=rtx-4060
//   node spikes/ngne/runner/run.ts --gpu=swiftshader
//
// It serves the spike pages with Vite, drives installed Chrome through Playwright, checks
// that the WebGPU adapter is the one requested, runs every question and writes the raw data
// to docs/spikes/data/se-002-<gpu>.json. `node spikes/ngne/runner/tables.ts` then rebuilds
// the result tables of docs/spikes/SE-002-ngne-integration.md from those files.
//
// Options: --only=1,4 (a subset; not written unless --out is given), --quick (short runs for
// debugging; never written to docs/spikes/data), --out=<file>, --headed, --probe (adapter
// check only), --chrome-arg=<flag> (an extra Chrome flag, repeatable). The GPU can also come
// from SPIKE_GPU and the port from PORT.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { cpus, release, totalmem, type as osType } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { decode, encode } from "fast-png";
import { createServer } from "vite";
import { blit, diffImages, expectedImage, isUniform, makeDoc, solidDoc } from "../lib/pattern.ts";
import {
    Q4_CLEAR,
    Q4_REGION,
    Q7_BARE,
    Q7_CLEAR,
    Q7_GAME,
    Q7_GAME_BG,
    Q8_CANVAS,
    Q8_CLEAR,
    q4Docs,
    q4Placements,
    q7BarePlacements,
    q7GamePlacements,
    q8Placements,
} from "../lib/scenes.ts";
import type {
    AdapterRecord,
    Check,
    GpuId,
    PageResult,
    QuestionRecord,
    SpikeData,
} from "../lib/types.ts";
import { QUESTIONS } from "./questions.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PAGES = "/spikes/ngne/pages";

// ---- GPU selection -------------------------------------------------------------------------
// NGNE calls requestAdapter() without a power preference, so the adapter is chosen by Chrome.
// Verified on the reference machine (Windows 11, Chrome 154, Intel UHD + RTX 4060 Laptop):
// --force-low-power-gpu gives the Intel adapter, --force-high-performance-gpu the NVIDIA one.
// On Windows the SwiftShader adapter needs only the three flags below; NGNE's Linux CI list
// (with --use-angle=vulkan) leaves Chrome on Windows without any adapter.

interface GpuConfig {
    readonly label: string;
    readonly args: readonly string[];
    readonly vendor: string;
    readonly architecture: RegExp;
}

const SWIFTSHADER_LINUX = [
    "--use-webgpu-adapter=swiftshader",
    "--enable-unsafe-webgpu",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--enable-features=Vulkan",
    "--use-angle=vulkan",
    "--use-vulkan=swiftshader",
    "--disable-vulkan-surface",
];
const SWIFTSHADER_WINDOWS = [
    "--use-webgpu-adapter=swiftshader",
    "--enable-unsafe-webgpu",
    "--enable-unsafe-swiftshader",
];

const GPUS: Record<GpuId, GpuConfig> = {
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
        args: process.platform === "win32" ? SWIFTSHADER_WINDOWS : SWIFTSHADER_LINUX,
        vendor: "google",
        architecture: /^swiftshader$/,
    },
};

const ALIASES: Record<string, GpuId> = {
    intel: "intel-uhd",
    uhd: "intel-uhd",
    "intel-uhd": "intel-uhd",
    rtx: "rtx-4060",
    nvidia: "rtx-4060",
    rtx4060: "rtx-4060",
    "rtx-4060": "rtx-4060",
    swiftshader: "swiftshader",
    software: "swiftshader",
};

// ---- Arguments -----------------------------------------------------------------------------

function option(name: string): string | undefined {
    const prefix = `--${name}=`;
    const found = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
    return found?.slice(prefix.length);
}
const flag = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);

const requested = (option("gpu") ?? process.env.SPIKE_GPU ?? "").toLowerCase();
const gpuId = ALIASES[requested];
if (!gpuId) {
    console.error(
        `Missing or unknown GPU "${requested}". Use --gpu=intel-uhd, --gpu=rtx-4060 or ` +
            "--gpu=swiftshader (or SPIKE_GPU).",
    );
    process.exit(64);
}
const gpu = GPUS[gpuId];
const quick = flag("quick");
const headed = flag("headed");
const probeOnly = flag("probe");
const only = option("only")
    ?.split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value));
const selected = QUESTIONS.filter((question) => !only || only.includes(question.number));
const partial = selected.length !== QUESTIONS.length;
const defaultOut = resolve(root, `docs/spikes/data/se-002-${gpuId}.json`);
const outOption = option("out");
const out = outOption ? resolve(outOption) : partial || quick ? undefined : defaultOut;
if (quick && out === defaultOut) {
    console.error("--quick results are not written to docs/spikes/data. Give another --out.");
    process.exit(64);
}

const log = (text: string): void => console.log(`[se-002 ${gpuId}] ${text}`);

// ---- Helpers -------------------------------------------------------------------------------

function freePort(): Promise<number> {
    return new Promise((done, fail) => {
        const server = createNetServer();
        server.once("error", fail);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() =>
                typeof address === "object" && address
                    ? done(address.port)
                    : fail(new Error("no port")),
            );
        });
    });
}

interface SpikeWindow {
    __spikeResult?: PageResult;
    __spikeStage?: string;
    __spikeControl?: {
        swap?: (index: number) => Promise<unknown>;
        afterResize?: (index: number) => Promise<{
            viewport: { width: number; height: number };
            diff: number;
        }>;
        finish: () => void;
    };
}

interface Opened {
    readonly page: Page;
    readonly console: string[];
    close(): Promise<void>;
}

interface Env {
    readonly base: string;
    /** Chrome started with `--force-device-scale-factor=<scale>`; one instance per scale. */
    browserAt(scale: number): Promise<Browser>;
}

// Device pixel ratio. Playwright's `deviceScaleFactor` alone changes `devicePixelRatio` but
// not `devicePixelContentBoxSize`, which keeps the browser's real scale (measured: 801×601 for
// an 801×601 CSS px box at an emulated DPR of 1.5). So a DPR is set on the browser with
// --force-device-scale-factor and matched by the context. Question 7 also records the
// emulation-only case through `emulatedScale`.
interface PageOptions {
    readonly scale?: number;
    readonly emulatedScale?: number;
    readonly viewport?: { width: number; height: number };
    readonly screen?: { width: number; height: number };
}

async function open(env: Env, url: string, options: PageOptions = {}): Promise<Opened> {
    const scale = options.scale ?? 1;
    const browser = await env.browserAt(scale);
    const contextOptions: BrowserContextOptions = {
        viewport: options.viewport ?? { width: 1280, height: 800 },
        deviceScaleFactor: options.emulatedScale ?? scale,
    };
    if (options.screen) contextOptions.screen = options.screen;
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const messages: string[] = [];
    page.on("console", (message) => {
        const type = message.type();
        // The dev server has no favicon; that 404 is not a finding.
        const favicon = /favicon/.test(message.text() + message.location().url);
        if ((type === "error" || type === "warning") && !favicon)
            messages.push(`${type}: ${message.text()}`);
    });
    page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));
    await page.goto(url);
    return { page, console: messages, close: () => context.close() };
}

function failedResult(question: number, variant: string, detail: string): PageResult {
    return {
        question,
        variant,
        pass: false,
        checks: [{ name: "Page produced a result", pass: false, binding: true, detail }],
        summary: [],
        metrics: {},
        samples: {},
        uncaught: [],
        adapters: [],
        notes: [],
        page: { url: "", devicePixelRatio: 0, viewport: [0, 0], screen: [0, 0], visibility: "" },
        durationMs: 0,
    };
}

async function waitForStage(page: Page, stage: string, timeout: number): Promise<void> {
    await page.waitForFunction(
        (name) => {
            const scope = window as unknown as SpikeWindow;
            return scope.__spikeStage === name || scope.__spikeResult !== undefined;
        },
        stage,
        { timeout, polling: 100 },
    );
}

async function waitForResult(page: Page, timeout: number): Promise<PageResult> {
    await page.waitForFunction(
        () => (window as unknown as SpikeWindow).__spikeResult !== undefined,
        undefined,
        { timeout, polling: 250 },
    );
    const result = await page.evaluate(() => (window as unknown as SpikeWindow).__spikeResult);
    if (!result) throw new Error("The page published no result");
    return result;
}

function addCheck(result: PageResult, check: Check): void {
    result.checks.push(check);
    result.pass = result.checks.every((entry) => entry.pass || !entry.binding);
}

interface Shot {
    readonly exact: boolean;
    readonly blank: boolean;
    readonly detail: string;
}

/** Compares a PNG screenshot with an expected RGBA image of the given size. */
function compareShot(
    png: Buffer,
    expected: Uint8ClampedArray,
    width: number,
    height: number,
): Shot {
    const image = decode(png);
    const pixels = image.width * image.height;
    const data = new Uint8ClampedArray(pixels * 4);
    for (let index = 0; index < pixels; index++) {
        const from = index * image.channels;
        data[index * 4] = image.data[from] ?? 0;
        data[index * 4 + 1] = image.data[from + 1] ?? 0;
        data[index * 4 + 2] = image.data[from + 2] ?? 0;
        data[index * 4 + 3] = image.channels === 4 ? (image.data[from + 3] ?? 0) : 255;
    }
    const blank = isUniform(data);
    if (image.width !== width || image.height !== height)
        return {
            exact: false,
            blank,
            detail: `screenshot is ${image.width}x${image.height}, expected ${width}x${height}`,
        };
    const diff = diffImages(data, expected, width);
    return {
        exact: diff.count === 0,
        blank,
        detail: diff.count ? `${diff.count} pixels differ; ${diff.first}` : "",
    };
}

interface RunOptions extends PageOptions {
    readonly timeoutMs?: number;
    /** Variant label of the result if the page produces none. */
    readonly label?: string;
    /** Runs after the result is published, while the page is still open. */
    readonly after?: (page: Page, result: PageResult) => Promise<void>;
}

/** Opens a page that runs by itself and returns its result. */
async function runPage(
    env: Env,
    question: number,
    path: string,
    options: RunOptions = {},
): Promise<PageResult> {
    const opened = await open(env, env.base + path, options);
    try {
        const result = await waitForResult(opened.page, options.timeoutMs ?? 600_000);
        await options.after?.(opened.page, result);
        if (opened.console.length) result.metrics.console = opened.console.slice(0, 20);
        return result;
    } catch (error) {
        return failedResult(
            question,
            options.label ?? "",
            `${path}: ${String(error)}; console: ${opened.console.join(" | ")}`,
        );
    } finally {
        await opened.close();
    }
}

// ---- Questions -----------------------------------------------------------------------------

type QuestionRunner = (env: Env) => Promise<PageResult[]>;

const q1: QuestionRunner = async (env) => [
    await runPage(env, 1, `${PAGES}/q01-upload.html${quick ? "?samples=20&streamMs=1000" : ""}`, {
        timeoutMs: 1_500_000,
    }),
];

const q2: QuestionRunner = async (env) => [
    await runPage(
        env,
        2,
        `${PAGES}/q02-single-flight.html${quick ? "?streamMs=1000&pairs=10" : ""}`,
    ),
];

const q3: QuestionRunner = async (env) => {
    const results: PageResult[] = [];
    for (const scale of [1, 1.25, 1.5, 2])
        results.push(
            await runPage(env, 3, `${PAGES}/q03-placement.html`, { scale, label: `DPR ${scale}` }),
        );
    return results;
};

const Q4_STAGES = ["detached", "detached-redraw", "stacked"] as const;

/** 4(a), runner-driven: a screenshot after every swap and as many as possible in between. */
async function q4Step(env: Env, stage: string, swaps: number): Promise<PageResult> {
    const url = `${env.base}${PAGES}/q04-sizing.html?mode=a&stage=${stage}&drive=step`;
    const opened = await open(env, url, { viewport: { width: 1680, height: 940 } });
    try {
        const { page } = opened;
        await waitForStage(page, "ready", 120_000);
        const docs = q4Docs();
        const want = expectedImage(
            Q4_REGION.width,
            Q4_REGION.height,
            Q4_CLEAR,
            q4Placements(docs).map((entry) => entry.placement),
        );
        const clip = { x: 0, y: 0, width: Q4_REGION.width, height: Q4_REGION.height };
        const bad: string[] = [];
        let shots = 0;
        let blank = 0;
        const take = async (label: string) => {
            const shot = compareShot(
                await page.screenshot({ clip }),
                want,
                clip.width,
                clip.height,
            );
            shots++;
            if (shot.blank) blank++;
            if (!shot.exact && bad.length < 5) bad.push(`${label}: ${shot.detail}`);
            return shot.exact;
        };
        let inexact = 0;
        if (!(await take("before the first swap"))) inexact++;
        let swapping = true;
        const sampling = (async () => {
            while (swapping) if (!(await take("during a swap"))) inexact++;
        })();
        for (let index = 0; index < swaps; index++) {
            await page.evaluate(
                (swap) => (window as unknown as SpikeWindow).__spikeControl?.swap?.(swap),
                index,
            );
            if (!(await take(`after swap ${index}`))) inexact++;
        }
        swapping = false;
        await sampling;
        await page.evaluate(() => (window as unknown as SpikeWindow).__spikeControl?.finish());
        const result = await waitForResult(page, 60_000);
        const detail =
            `${shots - inexact}/${shots} screenshots show the exact image, ${blank} blank` +
            (bad.length ? `; ${bad.join("; ")}` : "");
        if (stage === "control")
            addCheck(result, {
                name: "Control (old canvas removed before the new one draws): screenshots see a blank viewport",
                pass: blank > 0,
                binding: false,
                detail,
            });
        else
            addCheck(result, {
                name: "Never a blank viewport (screenshot after every swap and during swaps)",
                pass: inexact === 0,
                binding: true,
                detail,
            });
        result.metrics.screenshots = { taken: shots, inexact, blank, swaps };
        result.summary.push({
            label: `(a) ${stage}: screenshots exact / taken (blank)`,
            value: `${shots - inexact} / ${shots} (${blank})`,
        });
        if (opened.console.length) result.metrics.console = opened.console.slice(0, 20);
        return result;
    } catch (error) {
        return failedResult(4, `a ${stage} step`, String(error));
    } finally {
        await opened.close();
    }
}

/** Deterministic window sizes inside the screen, including its full size and odd sizes. */
function windowSizes(count: number, maxWidth: number, maxHeight: number): [number, number][] {
    const sizes: [number, number][] = [[maxWidth, maxHeight]];
    let seed = 12345;
    const next = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed / 4294967296;
    };
    while (sizes.length < count)
        sizes.push([
            640 + Math.floor(next() * (maxWidth - 640 + 1)),
            480 + Math.floor(next() * (maxHeight - 480 + 1)),
        ]);
    return sizes;
}

/** 4(b): the window is resized; the runner screenshots the visible part after each resize. */
async function q4Oversized(
    env: Env,
    scale: number,
    screen: { width: number; height: number },
    resizes: number,
    binding: boolean,
): Promise<PageResult> {
    const opened = await open(env, `${env.base}${PAGES}/q04-sizing.html?mode=b`, {
        viewport: { width: 1280, height: 720 },
        screen,
        scale,
    });
    try {
        const { page } = opened;
        await waitForStage(page, "ready", 120_000);
        const docs = q4Docs();
        const bad: string[] = [];
        let exact = 0;
        const sizes = windowSizes(resizes, screen.width, screen.height);
        for (const [index, [width, height]] of sizes.entries()) {
            await page.setViewportSize({ width, height });
            await page.waitForFunction(
                ([w, h]) => innerWidth === w && innerHeight === h,
                [width, height] as const,
                { polling: 50 },
            );
            const record = await page.evaluate(
                (resize) =>
                    (window as unknown as SpikeWindow).__spikeControl?.afterResize?.(resize),
                index,
            );
            if (!record) throw new Error("afterResize returned nothing");
            const view = record.viewport;
            const want = expectedImage(
                view.width,
                view.height,
                Q4_CLEAR,
                q4Placements(docs, view).map((entry) => entry.placement),
            );
            const shot = compareShot(await page.screenshot(), want, view.width, view.height);
            if (shot.exact) exact++;
            else if (bad.length < 5) bad.push(`${width}x${height}: ${shot.detail}`);
        }
        await page.evaluate(() => (window as unknown as SpikeWindow).__spikeControl?.finish());
        const result = await waitForResult(page, 60_000);
        addCheck(result, {
            name: "Correct image on screen after every resize (screenshot of the window)",
            pass: exact === sizes.length,
            binding,
            detail:
                `${exact}/${sizes.length} screenshots exact` +
                (bad.length ? `; ${bad.join("; ")}` : ""),
        });
        result.metrics.screenshots = { taken: sizes.length, exact };
        result.summary.push({
            label: `(b) DPR ${scale}: screenshots exact / resizes`,
            value: `${exact} / ${sizes.length}`,
        });
        if (opened.console.length) result.metrics.console = opened.console.slice(0, 20);
        return result;
    } catch (error) {
        return failedResult(4, `b DPR ${scale}`, String(error));
    } finally {
        await opened.close();
    }
}

const q4: QuestionRunner = async (env) => {
    const swaps = quick ? 10 : 50;
    const results: PageResult[] = [];
    for (const stage of Q4_STAGES) {
        results.push(
            await runPage(
                env,
                4,
                `${PAGES}/q04-sizing.html?mode=a&stage=${stage}&drive=auto&swaps=${swaps}`,
                { viewport: { width: 1680, height: 940 }, label: `a ${stage} auto` },
            ),
        );
        results.push(await q4Step(env, stage, quick ? 5 : swaps));
    }
    // Recorded only: shows that the screenshots would catch a blank viewport.
    results.push(await q4Step(env, "control", quick ? 5 : 10));
    results.push(await q4Oversized(env, 1, { width: 1920, height: 1080 }, swaps, true));
    results.push(await q4Oversized(env, 1.5, { width: 1707, height: 1067 }, quick ? 5 : 10, false));
    return results;
};

const q5: QuestionRunner = async (env) => [
    await runPage(
        env,
        5,
        `${PAGES}/q05-two-renderers.html${quick ? "?durationMs=12000&cycles=3" : ""}`,
    ),
];

const q6: QuestionRunner = async (env) => [await runPage(env, 6, `${PAGES}/q06-not-ready.html`)];

const q7: QuestionRunner = async (env) => {
    const results: PageResult[] = [];
    // "DPR 1.5 emulated" is the ticket's "DPR 1.5 emulation": Playwright's deviceScaleFactor on
    // a browser whose own scale is 1. "DPR 1.5" sets the browser's scale as well.
    const modes = [
        { variant: "DPR 1", scale: 1, emulatedScale: 1 },
        { variant: "DPR 1.5 emulated", scale: 1, emulatedScale: 1.5 },
        { variant: "DPR 1.5", scale: 1.5, emulatedScale: 1.5 },
    ];
    for (const mode of modes)
        results.push(
            await runPage(
                env,
                7,
                `${PAGES}/q07-readback.html?variant=${encodeURIComponent(mode.variant)}`,
                {
                    scale: mode.scale,
                    emulatedScale: mode.emulatedScale,
                    label: mode.variant,
                    after: async (page, result) => {
                        const k = Q7_GAME.k;
                        const shots = [
                            {
                                name: "bare renderer canvas",
                                selector: "#bare",
                                width: Q7_BARE.width,
                                height: Q7_BARE.height,
                                want: expectedImage(
                                    Q7_BARE.width,
                                    Q7_BARE.height,
                                    Q7_CLEAR,
                                    q7BarePlacements(),
                                ),
                            },
                            {
                                name: "BrowserGame canvas",
                                selector: "#game",
                                width: Q7_GAME.width * k,
                                height: Q7_GAME.height * k,
                                want: expectedImage(
                                    Q7_GAME.width * k,
                                    Q7_GAME.height * k,
                                    Q7_GAME_BG,
                                    q7GamePlacements(k),
                                ),
                            },
                        ];
                        for (const shot of shots) {
                            const png = await page.locator(shot.selector).screenshot();
                            const compared = compareShot(png, shot.want, shot.width, shot.height);
                            addCheck(result, {
                                name: `Playwright screenshot of the ${shot.name} is exact`,
                                pass: compared.exact,
                                // The threshold is "screenshot exact at DPR 1"; DPR 1.5 is recorded.
                                binding: mode.emulatedScale === 1,
                                detail: compared.detail,
                            });
                            result.summary.push({
                                label: `Screenshot of the ${shot.name}`,
                                value: compared.exact ? "exact" : `not exact (${compared.detail})`,
                            });
                        }
                    },
                },
            ),
        );
    return results;
};

const q8: QuestionRunner = async (env) => [
    await runPage(
        env,
        8,
        `${PAGES}/q08-device-loss.html${quick ? "?phases=250,750&trials=1" : ""}`,
        {
            after: async (page, result) => {
                // The page ends with the device lost, NGNE ready again and nothing redrawn.
                const want = expectedImage(
                    Q8_CANVAS.width,
                    Q8_CANVAS.height,
                    Q8_CLEAR,
                    q8Placements().map((entry) => entry.placement),
                );
                const png = await page.locator("#viewport-canvas").screenshot();
                const shot = compareShot(png, want, Q8_CANVAS.width, Q8_CANVAS.height);
                const shows = shot.exact
                    ? "the image from before the loss"
                    : shot.blank
                      ? "blank"
                      : "other";
                addCheck(result, {
                    name: "After a loss and recovery without a redraw the canvas is blank (recorded)",
                    pass: shot.blank,
                    binding: false,
                    detail: `canvas shows: ${shows}${shot.detail ? ` (${shot.detail})` : ""}`,
                });
                result.summary.push({
                    label: "Canvas after loss and recovery, before any redraw (screenshot)",
                    value: shows,
                });
            },
        },
    ),
];

const q9: QuestionRunner = async (env) => [await runPage(env, 9, `${PAGES}/q09-odd-sizes.html`)];

/** Question 10: the installed `ngne-preview` CLI with the hand-written config of q10/. */
const q10: QuestionRunner = async (env) => {
    const started = Date.now();
    const config = "spikes/ngne/q10/hero.preview.config.mjs";
    // The atlas the config describes: two 33×33 frames in even 34×34 rectangles, padding 1.
    const atlas = solidDoc(71, 36, 0, 0);
    blit(atlas, makeDoc(33, 33, 41), 1, 1);
    blit(atlas, makeDoc(33, 33, 42), 36, 1);
    writeFileSync(
        resolve(root, "spikes/ngne/q10/hero.png"),
        encode({ width: atlas.width, height: atlas.height, data: atlas.pixels, channels: 4 }),
    );

    const cli = "node_modules/@ngne/core/dist/preview/cli.js";
    const child = spawn(process.execPath, [cli, config], { cwd: root });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const checks: Check[] = [];
    const summary: PageResult["summary"] = [];
    const metrics: Record<string, unknown> = { command: `node ${cli} ${config}` };
    const adapters: AdapterRecord[] = [];
    let page: Opened | undefined;
    try {
        const url = await new Promise<string>((done, fail) => {
            const timer = setTimeout(() => fail(new Error(`no URL printed: ${output}`)), 20_000);
            const look = () => {
                const match = /NGNE preview: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
                if (!match?.[1]) return;
                clearTimeout(timer);
                done(match[1]);
            };
            child.stdout.on("data", look);
            child.once("exit", (code) => {
                clearTimeout(timer);
                fail(new Error(`ngne-preview exited with ${code}: ${output}`));
            });
            look();
        });
        metrics.url = url;
        page = await open(env, url);
        const status = page.page.locator("#status");
        await page.page.waitForFunction(
            () =>
                /^(Ready|Preview failed)/.test(
                    document.querySelector("#status")?.textContent ?? "",
                ),
            undefined,
            { timeout: 60_000, polling: 100 },
        );
        const read = async () => ({
            status: (await status.textContent()) ?? "",
            error: ((await page?.page.locator("#error").textContent()) ?? "").trim(),
            details: (await page?.page.locator("#details").textContent()) ?? "",
        });
        const initial = await read();
        checks.push({
            name: "Page status starts with Ready",
            pass: initial.status.startsWith("Ready"),
            binding: true,
            detail: initial.status,
        });
        checks.push({
            name: "No error text",
            pass: initial.error === "",
            binding: true,
            detail: initial.error,
        });
        // As SPEC §9.7 item 2 does: every frame selected in turn, then the animation.
        const selections: Record<string, unknown>[] = [];
        for (const frame of ["hero-0", "hero-1"]) {
            await page.page.locator("#frames").selectOption(frame);
            await page.page.waitForFunction(
                (id) =>
                    (document.querySelector("#details")?.textContent ?? "").startsWith(
                        `Frame ${id}`,
                    ),
                frame,
                { timeout: 10_000, polling: 50 },
            );
            selections.push({ frame, ...(await read()) });
        }
        await page.page.locator("#animations").selectOption("walk");
        await page.page.locator("#play").click();
        await page.page.waitForTimeout(500);
        selections.push({ animation: "walk", ...(await read()) });
        const allReady = selections.every(
            (entry) => String(entry.status).startsWith("Ready") && entry.error === "",
        );
        checks.push({
            name: "Status stays Ready with no error text for every frame and the animation",
            pass: allReady,
            binding: true,
            detail: selections
                .map((entry) => `${entry.frame ?? entry.animation}: ${entry.status}`)
                .join("; "),
        });
        metrics.initial = initial;
        metrics.selections = selections;
        const adapter = await page.page.evaluate(async () => {
            const scope = navigator as Navigator & {
                gpu?: { requestAdapter(): Promise<{ info: Record<string, unknown> } | null> };
            };
            const info = (await scope.gpu?.requestAdapter())?.info;
            return info
                ? {
                      vendor: String(info.vendor),
                      architecture: String(info.architecture),
                      device: String(info.device),
                      description: String(info.description),
                      isFallbackAdapter:
                          typeof info.isFallbackAdapter === "boolean"
                              ? info.isFallbackAdapter
                              : null,
                  }
                : null;
        });
        if (adapter) adapters.push(adapter);
        summary.push({ label: "Page status", value: initial.status });
        summary.push({ label: "Error text", value: initial.error || "(empty)" });
        summary.push({
            label: "Frames and animation selected in turn: Ready without error",
            value: allReady ? "yes" : "no",
        });
        if (page.console.length) metrics.console = page.console.slice(0, 20);
    } catch (error) {
        checks.push({
            name: "ngne-preview started and its page loaded",
            pass: false,
            binding: true,
            detail: String(error),
        });
    } finally {
        await page?.close();
        child.kill();
    }
    metrics.cliOutput = output.trim();
    return [
        {
            question: 10,
            variant: "",
            pass: checks.every((check) => check.pass || !check.binding),
            checks,
            summary,
            metrics,
            samples: {},
            uncaught: [],
            adapters,
            notes: [],
            page: {
                url: String(metrics.url ?? ""),
                devicePixelRatio: 1,
                viewport: [1280, 800],
                screen: [1280, 800],
                visibility: "visible",
            },
            durationMs: Date.now() - started,
        },
    ];
};

const q11: QuestionRunner = async (env) => [
    await runPage(env, 11, `${PAGES}/q11-slot-memory.html${quick ? "?size=256&cycles=1" : ""}`),
];

const RUNNERS: Record<number, QuestionRunner> = {
    1: q1,
    2: q2,
    3: q3,
    4: q4,
    5: q5,
    6: q6,
    7: q7,
    8: q8,
    9: q9,
    10: q10,
    11: q11,
};

// ---- Environment ---------------------------------------------------------------------------

function matches(adapter: AdapterRecord | null | undefined): boolean {
    return (
        !!adapter && adapter.vendor === gpu.vendor && gpu.architecture.test(adapter.architecture)
    );
}

const describeAdapter = (adapter: AdapterRecord | null | undefined): string =>
    adapter ? `${adapter.vendor} / ${adapter.architecture}` : "none";

function wrongAdapter(where: string, adapter: AdapterRecord | null | undefined): never {
    console.error(
        [
            "",
            "#".repeat(78),
            `# WRONG WEBGPU ADAPTER in ${where}`,
            `#   requested: ${gpu.label} (vendor ${gpu.vendor}, architecture ${gpu.architecture})`,
            `#   obtained:  ${describeAdapter(adapter)}`,
            `#   Chrome arguments: ${chromeArgs.join(" ")}`,
            "# Nothing was written. Check the Windows graphics setting for chrome.exe and",
            "# the GPU drivers, then run again.",
            "#".repeat(78),
            "",
        ].join("\n"),
    );
    process.exit(2);
}

/** GPU and driver rows of chrome://gpu, and the adapters Dawn lists. */
async function gpuPage(
    browser: Browser,
): Promise<{ rows: Record<string, string>; dawn: string[] }> {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        await page.goto("chrome://gpu");
        await page.waitForTimeout(3000);
        const data = await page.evaluate(() => {
            const view = document.querySelector("info-view")?.shadowRoot;
            if (!view) return { rows: [] as string[][], headings: [] as string[] };
            return {
                rows: [...view.querySelectorAll("tr")].map((row) =>
                    [...row.children].map((cell) => (cell.textContent ?? "").trim()),
                ),
                headings: [...view.querySelectorAll("h3,h4,h5")].map((heading) =>
                    (heading.textContent ?? "").trim(),
                ),
            };
        });
        const wanted =
            /^(GPU\d|Driver D3D12|Driver Vulkan|Display type|GL_RENDERER|Skia Backend|Operating system|Chrome version)/;
        const rows: Record<string, string> = {};
        for (const [key, value] of data.rows) {
            const name = (key ?? "").replace(/\s*:\s*$/, "");
            if (wanted.test(name) && value) rows[name] = value.slice(0, 300);
        }
        const dawn = data.headings
            .filter((heading) => / backend - /.test(heading))
            .map((heading) => (heading.split("\n")[0] ?? "").replace(/\s+/g, " "));
        return { rows, dawn };
    } catch (error) {
        return { rows: { error: String(error) }, dawn: [] };
    } finally {
        await context.close();
    }
}

function versionOf(name: string): string {
    const file = resolve(root, "node_modules", name, "package.json");
    return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
}

function git(...args: string[]): string {
    try {
        return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    } catch {
        return "";
    }
}

// ---- Main ----------------------------------------------------------------------------------

const port = Number(process.env.PORT) || (await freePort());
const server = await createServer({
    configFile: false,
    root,
    appType: "mpa",
    logLevel: "warn",
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null },
    // Bundled before the first page loads, so no page reloads for a newly found dependency.
    optimizeDeps: { include: ["@ngne/core"] },
});
await server.listen();
const base = `http://127.0.0.1:${port}`;
const extraArgs = process.argv
    .slice(2)
    .filter((argument) => argument.startsWith("--chrome-arg="))
    .map((argument) => argument.slice("--chrome-arg=".length));
const chromeArgs = ["--force-color-profile=srgb", ...gpu.args, ...extraArgs];
log(`Chrome ${headed ? "headed" : "headless"} with ${chromeArgs.join(" ")}`);
const browsers = new Map<number, Promise<Browser>>();
const env: Env = {
    base,
    browserAt(scale) {
        let launched = browsers.get(scale);
        if (!launched) {
            launched = chromium.launch({
                channel: "chrome",
                headless: !headed,
                args: [...chromeArgs, `--force-device-scale-factor=${scale}`],
            });
            browsers.set(scale, launched);
        }
        return launched;
    },
};
let exitCode = 0;
try {
    const browser = await env.browserAt(1);
    const probe = await runPage(env, 0, `${PAGES}/probe.html`, { timeoutMs: 60_000 });
    const adapter = probe.metrics.defaultAdapter as AdapterRecord | null | undefined;
    if (!matches(adapter)) wrongAdapter("the adapter probe", adapter);
    for (const used of probe.adapters)
        if (!matches(used)) wrongAdapter("NGNE's device (probe)", used);
    if (!adapter || !probe.pass)
        throw new Error(`Adapter probe failed: ${JSON.stringify(probe.checks)}`);
    const info = await gpuPage(browser);
    log(`adapter ${describeAdapter(adapter)}; ${info.rows.GL_RENDERER ?? ""}`);
    for (const [key, value] of Object.entries(info.rows))
        if (/^GPU\d/.test(key)) log(`${key}: ${value}`);
    if (probeOnly) {
        log("Adapter matches the request. --probe: no question was run.");
    } else {
        const questions: Record<string, QuestionRecord> = {};
        for (const question of selected) {
            log(`Question ${question.number}: ${question.title}`);
            const started = Date.now();
            const run = RUNNERS[question.number];
            if (!run) throw new Error(`No runner for question ${question.number}`);
            const runs = await run(env);
            for (const result of runs)
                for (const used of result.adapters)
                    if (!matches(used)) wrongAdapter(`question ${question.number}`, used);
            const complete = !runs.some((result) =>
                result.checks.some((check) => check.name === "Page produced a result"),
            );
            const record: QuestionRecord = {
                title: question.title,
                threshold: question.threshold,
                pass: runs.every((result) => result.pass),
                complete,
                runs,
            };
            if (question.number === 4) {
                // A part passes when each of its runs is present and passed.
                const passed = (...variants: string[]) =>
                    variants.every((variant) => {
                        const found = runs.filter((result) => result.variant === variant);
                        return found.length === 1 && found[0]?.pass === true;
                    });
                const parts: Record<string, boolean> = {};
                for (const stage of Q4_STAGES)
                    parts[`a ${stage}`] = passed(`a ${stage} auto`, `a ${stage} step`);
                parts.a = Q4_STAGES.some((stage) => parts[`a ${stage}`]);
                parts.b = passed("b DPR 1");
                record.parts = parts;
                record.pass = complete && (parts.a || parts.b);
            }
            questions[String(question.number)] = record;
            if (!complete) exitCode = 1;
            log(
                `  ${record.pass ? "GO" : "NO-GO"}${complete ? "" : " (INCOMPLETE)"} in ` +
                    `${Math.round((Date.now() - started) / 1000)} s`,
            );
            for (const result of runs) {
                for (const line of result.summary)
                    log(
                        `    ${result.variant ? `[${result.variant}] ` : ""}${line.label}: ${line.value}`,
                    );
                for (const check of result.checks)
                    if (!check.pass)
                        log(
                            `    ${check.binding ? "FAILED" : "recorded"} ` +
                                `${result.variant ? `[${result.variant}] ` : ""}${check.name}: ${check.detail}`,
                        );
            }
        }
        const data: SpikeData = {
            format: "se-002-spike-data",
            version: 1,
            gpu: gpuId,
            recordedAt: new Date().toISOString(),
            commit:
                git("rev-parse", "--short", "HEAD") +
                (git("status", "--porcelain") ? "+changes" : ""),
            command: `node spikes/ngne/runner/run.ts ${process.argv.slice(2).join(" ")}`.trim(),
            quick,
            environment: {
                os: `${osType()} ${release()}`,
                cpu: `${cpus()[0]?.model.trim() ?? "unknown"} x${cpus().length}`,
                memoryGb: Math.round(totalmem() / 2 ** 30),
                node: process.version,
                chrome: browser.version(),
                headless: !headed,
                // Every Chrome instance also gets --force-device-scale-factor=<DPR of the run>.
                chromeArgs,
                ngne: versionOf("@ngne/core"),
                playwright: versionOf("@playwright/test"),
                vite: versionOf("vite"),
                adapter,
                gpuPage: info.rows,
                dawnAdapters: info.dawn,
            },
            questions,
        };
        if (out) {
            mkdirSync(dirname(out), { recursive: true });
            writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
            log(`Raw data written to ${out}`);
        } else log("Subset or quick run: nothing written (give --out=<file> to keep it).");
        const noGo = Object.entries(questions).filter(([, record]) => !record.pass);
        log(
            noGo.length
                ? `NO-GO for question(s) ${noGo.map(([number]) => number).join(", ")}`
                : `All ${selected.length} question(s) GO`,
        );
        if (exitCode) console.error("INCOMPLETE RUN: at least one page produced no result.");
    }
} catch (error) {
    console.error(error);
    exitCode = 1;
} finally {
    for (const launched of browsers.values())
        await launched.then(
            (instance) => instance.close(),
            () => undefined,
        );
    await server.close();
}
process.exit(exitCode);
