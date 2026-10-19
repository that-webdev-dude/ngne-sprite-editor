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
// PNG dialog is opened on a 1024 × 1024 PNG of smooth colour (many colours, so the smart
// defaults reduce to 16 and threshold) with the preference defaults: 32 × 32, contain, area
// average. Then controls of the dialog are clicked or stepped as a user does, one change at a
// time: dither, fit, alpha, target width (arrow keys of the field), resampling is left alone.
// A sample is the time from the input event (`event.timeStamp`, in the page's clock) to the
// second animation frame after the preview's store shows the answer to that change: the
// frames are then drawn in the result pane. The result is the largest sample, against the
// budget of 300 ms; median and p95 by kind of change are in the details.
//
//     npx vitest run --config vitest.perf.config.ts tests/perf/se-044-preview.perf.ts
//
// The computation runs in a worker and uses no GPU; run it alone on the reference machine.

const WINDOW = { width: 1600, height: 1000 };
const SIDE = 1024;
const ROUNDS = 4;

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

it("SE-044: the Import PNG preview updates after a change of a setting, 1024 × 1024 source", async () => {
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
        const summaryLine = dialog.locator("[data-import-summary]");
        await summaryLine.filter({ hasText: /frame/ }).waitFor({ timeout: 60_000 });
        const firstPreviewMs = Date.now() - opened;
        await sleep(500);

        const radio = (group: string, name: string): Locator =>
            dialog
                .getByRole("radiogroup", { name: group, exact: true })
                .getByRole("radio", { name, exact: true });
        const width = dialog.getByRole("spinbutton", { name: "Width", exact: true });
        const changes: { kind: string; act(): Promise<void> }[] = [
            { kind: "dither", act: () => radio("Dither", "Ordered").click() },
            { kind: "dither", act: () => radio("Dither", "Floyd–Steinberg").click() },
            { kind: "dither", act: () => radio("Dither", "None").click() },
            { kind: "fit", act: () => radio("Fit", "Cover").click() },
            { kind: "fit", act: () => radio("Fit", "Contain").click() },
            { kind: "alpha", act: () => radio("Alpha", "Keep").click() },
            { kind: "alpha", act: () => radio("Alpha", "Threshold").click() },
            { kind: "size", act: () => width.press("ArrowUp") },
            { kind: "size", act: () => width.press("ArrowDown") },
        ];
        const byKind = new Map<string, number[]>();
        const samples: number[] = [];
        for (let round = 0; round < ROUNDS; round++) {
            for (const change of changes) {
                await change.act();
                const sample = await sampleOf(page, samples.length);
                samples.push(sample);
                byKind.set(change.kind, [...(byKind.get(change.kind) ?? []), sample]);
                // Idle between changes, as between a user's clicks.
                await sleep(150);
            }
        }
        if (pageErrors.length > 0) throw new Error(`se-044: page errors: ${pageErrors[0]}`);

        const details = {
            all: summary(samples),
            byKind: Object.fromEntries(
                [...byKind].map(([kind, values]) => [kind, summary(values)]),
            ),
            firstPreviewAfterOpenMs: firstPreviewMs,
            source: `${SIDE}×${SIDE} PNG, smooth colour; target 32×32 contain, area average, smart alpha and colours (threshold, 16 colours)`,
            sample: "input event timeStamp to the second animation frame after the preview store's answer",
            window: `${WINDOW.width}×${WINDOW.height} CSS px`,
            chrome: `${browser.version()}, new headless, ${args.join(" ")}`,
        };
        record({
            id: "se-044-preview",
            ticket: "SE-044",
            measurement:
                "Import PNG dialog on a 1024×1024 source: time from the input event of a " +
                "setting change (dither, fit, alpha, target width) to the result pane drawn " +
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
});
