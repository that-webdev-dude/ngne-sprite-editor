import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { it } from "vitest";
// Declares `window.__ngneTest` (development builds).
import type {} from "../../src/app/testing/testHooks";
import type * as DialogRequestsModule from "../../src/app/dialogs/dialogRequests";
import type { ImportRequest } from "../../src/app/import/importDialog";
import type * as ImportWorkflowModule from "../../src/app/import/importWorkflow";
import type * as CorePng from "../../src/core/png";
import { record } from "./record";

// SE-044: "Changing a setting updates the preview within 300 ms for a 1024×1024 source"
// (recorded). The app runs from a Vite dev server in installed Chrome, new headless; the Import
// PNG dialog is opened on a 1024 × 1024 PNG of smooth colour with an x XOR y blue channel
// (about 220 000 colours). Two records, each against 300 ms (SE-044 review A):
//
// - `se-044-preview`: the dialog's defaults (32 × 32 contain, area average, smart alpha and
//   colours: threshold, reduce to 16).
// - `se-044-preview-1024-target`: target 1024 × 1024 contain, Reduce to 256 colours (REVIEW
//   D14 left `runImport` at that size to this measurement).
//
// Controls are clicked or stepped (arrow keys of a number field) as a user does, one change at
// a time, so that every kept result of the pipeline is made again at least once: dither (the
// mapping), count (the palette), fit, alpha and size (the frames), crop and grid (the cells).
// A sample is the time from the input event (`event.timeStamp`, in the page's clock) to the
// second animation frame after the preview's store shows the answer to that change: the
// frames are then drawn in the result pane. The result is the largest sample; median and p95
// by kind of change are in the details.
//
//     npx vitest run --config vitest.perf.config.ts tests/perf/se-044-preview.perf.ts --silent=false
//
// The computation runs in a worker and uses no GPU; run it alone on the reference machine.

const WINDOW = { width: 1600, height: 1000 };
const SIDE = 1024;
const ROUNDS = 3;

declare global {
    interface Window {
        __se044bench?: { start: number | null; samples: number[] };
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

/** Opens the dialog on the 1024 × 1024 source and starts recording changes. */
async function openDialog(page: Page): Promise<void> {
    await page.evaluate(async (side) => {
        const load = new Function("path", "return import(path)") as (
            path: string,
        ) => Promise<unknown>;
        const png = (await load("/src/core/png/index.ts")) as typeof CorePng;
        const workflow = (await load(
            "/src/app/import/importWorkflow.ts",
        )) as typeof ImportWorkflowModule;
        const { commandDialogs } = (await load(
            "/src/app/dialogs/dialogRequests.ts",
        )) as typeof DialogRequestsModule;
        const data = new Uint8ClampedArray(side * side * 4);
        for (let y = 0; y < side; y++) {
            for (let x = 0; x < side; x++) {
                data.set(
                    [(x * 255) / side, (y * 255) / side, ((x ^ y) * 255) / side, 255],
                    (y * side + x) * 4,
                );
            }
        }
        const bytes = png.encodePng({ width: side, height: side, data });
        void workflow.importImages([{ name: "large.png", read: async () => bytes }]);
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const deadline = performance.now() + 60_000;
        let request: ImportRequest | null = null;
        while (!request) {
            if (performance.now() > deadline) throw new Error("se-044: no Import PNG dialog");
            const open = commandDialogs.store.getState().request;
            if (open?.kind === "import-png") request = open as ImportRequest;
            else await frame();
        }
        const bench = { start: null as number | null, samples: [] as number[] };
        window.__se044bench = bench;
        const mark = (event: Event) => {
            if (bench.start === null) bench.start = event.timeStamp;
        };
        document.addEventListener("pointerdown", mark, { capture: true });
        document.addEventListener("keydown", mark, { capture: true });
        request.preview.store.subscribe((state, previous) => {
            if (state.revision === previous.revision || bench.start === null) return;
            const start = bench.start;
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    bench.samples.push(performance.now() - start);
                    bench.start = null;
                }),
            );
        });
    }, SIDE);
}

/** Waits for the sample of the change just made. */
async function sampleOf(page: Page, count: number): Promise<number> {
    await page.waitForFunction(
        (count) => (window.__se044bench?.samples.length ?? 0) > count,
        count,
        {
            polling: 10,
            timeout: 30_000,
        },
    );
    return page.evaluate((count) => window.__se044bench!.samples[count]!, count);
}

/** One measured change of a setting: its kind (for the details) and how it is made. */
interface Change {
    kind: string;
    act(dialog: Locator, page: Page): Promise<void>;
}

const radio = (dialog: Locator, group: string, name: string): Locator =>
    dialog
        .getByRole("radiogroup", { name: group, exact: true })
        .getByRole("radio", { name, exact: true });
const field = (dialog: Locator, name: string): Locator =>
    dialog.getByRole("spinbutton", { name, exact: true });
const click = (group: string, name: string) => (dialog: Locator) =>
    radio(dialog, group, name).click();
const step = (name: string, key: "ArrowUp" | "ArrowDown") => (dialog: Locator) =>
    field(dialog, name).press(key);

/**
 * Changes that between them invalidate every kept result of the pipeline at least once:
 * the mapping (dither), the palette (count), the frames (fit, alpha, target size), the cells
 * (crop, grid).
 */
const DEFAULT_CHANGES: readonly Change[] = [
    { kind: "dither", act: click("Dither", "Ordered") },
    { kind: "dither", act: click("Dither", "Floyd–Steinberg") },
    { kind: "dither", act: click("Dither", "None") },
    { kind: "count", act: step("Count", "ArrowDown") },
    { kind: "count", act: step("Count", "ArrowUp") },
    { kind: "fit", act: click("Fit", "Cover") },
    { kind: "fit", act: click("Fit", "Contain") },
    { kind: "alpha", act: click("Alpha", "Keep") },
    { kind: "alpha", act: click("Alpha", "Threshold") },
    { kind: "size", act: step("Width", "ArrowUp") },
    { kind: "size", act: step("Width", "ArrowDown") },
    { kind: "crop", act: click("Region", "Crop") },
    { kind: "crop", act: step("W", "ArrowDown") },
    { kind: "crop", act: click("Region", "Whole image") },
    // The preference's cell size, 32 × 32: 1024 cells of the 1024 × 1024 source.
    { kind: "cells", act: click("Cells", "Grid") },
    { kind: "cells", act: click("Cells", "Single sprite") },
];

const LARGE_TARGET_CHANGES: readonly Change[] = [
    { kind: "dither", act: click("Dither", "Ordered") },
    { kind: "dither", act: click("Dither", "Floyd–Steinberg") },
    { kind: "dither", act: click("Dither", "None") },
    { kind: "count", act: step("Count", "ArrowDown") },
    { kind: "count", act: step("Count", "ArrowUp") },
    { kind: "fit", act: click("Fit", "Cover") },
    { kind: "fit", act: click("Fit", "Contain") },
    { kind: "crop", act: click("Region", "Crop") },
    { kind: "crop", act: step("W", "ArrowDown") },
    { kind: "crop", act: click("Region", "Whole image") },
];

interface Benchmark {
    id: string;
    target: string;
    /** Settings made before the measurement, not measured. */
    prepare(dialog: Locator, page: Page): Promise<void>;
    changes: readonly Change[];
}

async function measure(benchmark: Benchmark): Promise<void> {
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
        const args = ["--force-color-profile=srgb", "--force-device-scale-factor=1"];
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

        const opened = Date.now();
        await openDialog(page);
        const dialog = page.getByRole("dialog", { name: "Import PNG" });
        const result = dialog.locator("[data-import-result]");
        const settled = async () => {
            await dialog
                .locator("[data-import-summary]")
                .filter({ hasText: /frame/ })
                .waitFor({ timeout: 60_000 });
            await page.waitForFunction(
                () =>
                    document.querySelector("[data-import-result]")?.getAttribute("aria-busy") ===
                    "false",
                undefined,
                { polling: 20, timeout: 60_000 },
            );
        };
        await settled();
        const firstPreviewMs = Date.now() - opened;
        await benchmark.prepare(dialog, page);
        await settled();
        await sleep(500);
        // Nothing measured so far.
        await page.evaluate(() => {
            window.__se044bench!.samples.length = 0;
            window.__se044bench!.start = null;
        });

        const byKind = new Map<string, number[]>();
        const samples: number[] = [];
        for (let round = 0; round < ROUNDS; round++) {
            for (const change of benchmark.changes) {
                await change.act(dialog, page);
                const sample = await sampleOf(page, samples.length);
                samples.push(sample);
                byKind.set(change.kind, [...(byKind.get(change.kind) ?? []), sample]);
                // Idle between changes, as between a user's clicks.
                await sleep(150);
            }
        }
        if (pageErrors.length > 0) throw new Error(`se-044: page errors: ${pageErrors[0]}`);
        if ((await result.locator("[data-import-error]").count()) > 0) {
            throw new Error("se-044: the preview failed. Nothing was measured.");
        }

        const kinds = [...new Set(benchmark.changes.map((change) => change.kind))];
        const details = {
            all: summary(samples),
            byKind: Object.fromEntries(
                [...byKind].map(([kind, values]) => [kind, summary(values)]),
            ),
            firstPreviewAfterOpenMs: firstPreviewMs,
            source: `${SIDE}×${SIDE} PNG, smooth colour with an x XOR y blue channel (about 220 000 colours)`,
            target: benchmark.target,
            sample: "input event timeStamp to the second animation frame after the preview store's answer",
            window: `${WINDOW.width}×${WINDOW.height} CSS px`,
            chrome: `${browser.version()}, new headless, ${args.join(" ")}`,
        };
        record({
            id: benchmark.id,
            ticket: "SE-044",
            measurement:
                `Import PNG dialog on a 1024×1024 source, ${benchmark.target}: time from the ` +
                `input event of a setting change (${kinds.join(", ")}) to the result pane drawn ` +
                "with the preview's answer, Chrome, preview computed in a worker.",
            statistic: `largest of ${samples.length} changes`,
            budgetMs: 300,
            resultMs: Math.max(...samples),
            details,
        });
        console.log(JSON.stringify(details, null, 4));
    } finally {
        await browser?.close();
        await server?.close();
    }
}

it("SE-044: the Import PNG preview after a change of a setting, 1024 × 1024 source, the dialog's defaults", async () => {
    await measure({
        id: "se-044-preview",
        target:
            "the dialog's defaults: target 32×32 contain, area average, smart alpha and colours " +
            "(threshold 128, reduce to 16)",
        prepare: async () => {},
        changes: DEFAULT_CHANGES,
    });
});

it("SE-044: the Import PNG preview after a change of a setting, 1024 × 1024 source and target, 256 colours", async () => {
    await measure({
        id: "se-044-preview-1024-target",
        target: "target 1024×1024 contain, area average, Reduce to 256 colours",
        prepare: async (dialog, page) => {
            for (const [name, value] of [
                ["Width", 1024],
                ["Height", 1024],
            ] as const) {
                await field(dialog, name).fill(String(value));
                await field(dialog, name).blur();
            }
            const colours = dialog.getByRole("combobox", { name: "Colours", exact: true });
            await colours.click();
            const listbox = page.getByRole("listbox");
            await listbox.waitFor();
            await listbox.getByRole("option", { name: "Reduce", exact: true }).click();
            await listbox.waitFor({ state: "detached" });
            await field(dialog, "Count").fill("256");
            await field(dialog, "Count").blur();
        },
        changes: LARGE_TARGET_CHANGES,
    });
});
