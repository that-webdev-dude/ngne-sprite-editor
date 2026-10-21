import type { Browser } from "@playwright/test";
import { it } from "vitest";
import { record } from "./record";
import {
    checkAdapter,
    environmentDetails,
    launch,
    newContext,
    percentile,
    selectedGpu,
    startProductionServer,
} from "./se-070-harness";
import type { AdapterInfo } from "./se-070-harness";

// SE-070, SPEC §6.6: "Cold load to interactive (production build, local) ≤ 2 s". Run alone,
// one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts tests/perf/se-070-cold-load.perf.ts
//
// (`rtx-4060`, or `swiftshader`, which is no reference.) Without PERF_GPU it is skipped.
//
// Production build: `vite build` with the project's configuration into a folder of its own,
// served by `vite preview` on 127.0.0.1 ("local"). Cold: every load is a new Chrome with an
// empty profile (no HTTP, code or shader cache, no service worker), 10 loads.
//
// "Interactive" is the moment the editor first answers its first action. The app is
// interactive when the user can start work: past the WebGPU check that gates the editor
// (SPEC §3, `useWebGpuSupport`), the shell is on screen with the empty state, whose first
// action is New sprite (DESIGN §6), and that action responds. The page measures it from its
// own navigation start (time origin 0) with a script that runs before the app's:
// - `shell`: the first animation frame in which the empty state's New sprite button is in
//   the document and has a box;
// - from then on, at every animation frame until the dialog is there, it clicks the button
//   (`click()`, as a press does, at most every 50 ms) — a click that comes before the app can
//   answer it is lost, as a user's would be;
// - `interactive`: the first animation frame in which the New sprite dialog
//   (`role="dialog"`, named "New sprite") is in the document with a box. That frame paints it.
// The result is the largest `interactive` of the 10 loads against 2000 ms; the median, the
// shell times, the navigation timings and the long tasks are in the details.
//
// Beside it, not part of the result (SE-070 review D): the first draw of the editor, which
// "interactive" does not include, since nothing starts the viewport's NGNE device, pipelines
// and shaders before a document is open. In the same load, at the animation frame after the
// dialog was seen, the probe clicks its Create button (again every 50 ms while the dialog
// stays), and records "Create → first viewport frame on screen": from that first click to the
// first animation frame in which the viewport's canvas is in the document with a box. The
// production build has no test hook, so the signal is one the DOM shows: the NGNE viewport
// puts its canvas into the document only once that canvas has drawn its first frame
// (`NgneViewport`: "a canvas that has not drawn does not go on screen"), and the animation
// frame that finds it there paints it. A load whose
// page has the development test hook or Vite's client is no production build and fails the
// run, as does a wrong WebGPU adapter (checked in each load's page after it was measured).

const LOADS = 10;
const BUDGET_MS = 2000;
const gpu = selectedGpu();

interface LoadTimes {
    shell: number | null;
    interactive: number | null;
    clicks: number;
    created: number | null;
    firstViewportFrame: number | null;
    createClicks: number;
    domContentLoaded: number;
    load: number;
    firstContentfulPaint: number | null;
    longTasks: { start: number; duration: number }[];
    production: boolean;
}

declare global {
    interface Window {
        __se070load?: {
            shell: number | null;
            interactive: number | null;
            clicks: number;
            /** The first click on the dialog's Create button. */
            created: number | null;
            /** The first animation frame with the viewport's canvas in the document. */
            firstViewportFrame: number | null;
            createClicks: number;
            longTasks: { start: number; duration: number }[];
        };
    }
}

/** Runs in the page before its scripts: watches for the shell and opens New sprite. */
function installLoadProbe(): void {
    const state = {
        shell: null as number | null,
        interactive: null as number | null,
        clicks: 0,
        created: null as number | null,
        firstViewportFrame: null as number | null,
        createClicks: 0,
        longTasks: [] as { start: number; duration: number }[],
    };
    window.__se070load = state;
    try {
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                state.longTasks.push({
                    start: Math.round(entry.startTime),
                    duration: Math.round(entry.duration),
                });
            }
        }).observe({ type: "longtask", buffered: true });
    } catch {
        // Long tasks are details only.
    }
    const hasBox = (element: Element | null) => {
        if (!element) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
    };
    const newSpriteButton = () =>
        Array.from(
            document.querySelectorAll<HTMLButtonElement>(
                '[data-region="viewport"] [data-empty-state] button',
            ),
        ).find((button) => button.textContent?.trim() === "New sprite") ?? null;
    const newSpriteDialog = () =>
        Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) => {
            const labelId = dialog.getAttribute("aria-labelledby");
            const label = labelId ? document.getElementById(labelId)?.textContent : null;
            return (label ?? dialog.getAttribute("aria-label"))?.trim() === "New sprite";
        }) ?? null;
    const createButton = (dialog: Element) =>
        Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(
            (button) => button.textContent?.trim() === "Create",
        ) ?? null;
    const viewportCanvas = () =>
        document.querySelector('[data-region="viewport"] [data-viewport-canvas] canvas');
    let lastClick = -Infinity;
    let lastCreate = -Infinity;
    // After "interactive": Create, then the first frame of the viewport (review D).
    const afterInteractive = (time: number) => {
        if (hasBox(viewportCanvas())) {
            state.firstViewportFrame = performance.now();
            return;
        }
        const dialog = newSpriteDialog();
        const create = dialog && createButton(dialog);
        if (create && time - lastCreate >= 50) {
            lastCreate = time;
            state.created ??= performance.now();
            state.createClicks++;
            create.click();
        }
        requestAnimationFrame(afterInteractive);
    };
    const frame = (time: number) => {
        if (newSpriteDialog() && hasBox(newSpriteDialog())) {
            state.interactive = performance.now();
            requestAnimationFrame(afterInteractive);
            return;
        }
        const button = newSpriteButton();
        if (button && hasBox(button)) {
            state.shell ??= performance.now();
            if (time - lastClick >= 50) {
                lastClick = time;
                state.clicks++;
                button.click();
            }
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

async function coldLoad(
    url: string,
): Promise<{ times: LoadTimes; adapter: AdapterInfo; browser: string; details: object }> {
    if (!gpu) throw new Error("no GPU");
    let browser: Browser | null = null;
    try {
        browser = await launch(gpu);
        const context = await newContext(browser);
        await context.addInitScript(installLoadProbe);
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => void pageErrors.push(String(error)));
        await page.goto(url);
        await page.waitForFunction(
            () => window.__se070load?.firstViewportFrame != null,
            undefined,
            { polling: 50, timeout: 60_000 },
        );
        const times = await page.evaluate((): LoadTimes => {
            const probe = window.__se070load!;
            const navigation = performance.getEntriesByType(
                "navigation",
            )[0] as PerformanceNavigationTiming;
            const paint = performance
                .getEntriesByType("paint")
                .find((entry) => entry.name === "first-contentful-paint");
            return {
                shell: probe.shell,
                interactive: probe.interactive,
                clicks: probe.clicks,
                created: probe.created,
                firstViewportFrame: probe.firstViewportFrame,
                createClicks: probe.createClicks,
                domContentLoaded: navigation.domContentLoadedEventEnd,
                load: navigation.loadEventEnd,
                firstContentfulPaint: paint?.startTime ?? null,
                longTasks: probe.longTasks,
                production:
                    !("__ngneTest" in window) &&
                    document.querySelector('script[src*="/@vite/client"]') === null,
            };
        });
        if (!times.production) {
            throw new Error("se-070: the page is a development build. Nothing was measured.");
        }
        if (pageErrors.length > 0) throw new Error(`se-070: page errors: ${pageErrors[0]}`);
        const adapter = await checkAdapter(page, gpu);
        return {
            times,
            adapter,
            browser: browser.version(),
            details: environmentDetails(browser, gpu, adapter),
        };
    } finally {
        await browser?.close();
    }
}

it.skipIf(!gpu)(
    `SE-070: cold load to interactive, production build (${gpu?.id ?? "set PERF_GPU"})`,
    async () => {
        if (!gpu) return;
        const server = await startProductionServer();
        try {
            const loads: LoadTimes[] = [];
            let environment: object = {};
            for (let index = 0; index < LOADS; index++) {
                const { times, details } = await coldLoad(server.url);
                loads.push(times);
                environment = details;
            }
            const interactive = loads.map((load) => load.interactive!);
            const sorted = [...interactive].sort((a, b) => a - b);
            const round = (value: number) => Math.round(value * 10) / 10;
            const firstFrame = loads.map((load) => load.firstViewportFrame! - load.created!);
            const firstFrameSorted = [...firstFrame].sort((a, b) => a - b);
            const details = {
                interactiveMs: interactive.map(round),
                medianInteractiveMs: round(percentile(sorted, 0.5)),
                shellMs: loads.map((load) => (load.shell === null ? null : round(load.shell))),
                clicksUntilAnswered: loads.map((load) => load.clicks),
                domContentLoadedMs: loads.map((load) => round(load.domContentLoaded)),
                loadEventMs: loads.map((load) => round(load.load)),
                firstContentfulPaintMs: loads.map((load) =>
                    load.firstContentfulPaint === null ? null : round(load.firstContentfulPaint),
                ),
                longTasks: loads.map((load) => load.longTasks),
                createToFirstViewportFrameMs: firstFrame.map(round),
                medianCreateToFirstViewportFrameMs: round(percentile(firstFrameSorted, 0.5)),
                largestCreateToFirstViewportFrameMs: round(firstFrameSorted.at(-1)!),
                createClicksUntilAnswered: loads.map((load) => load.createClicks),
                firstViewportFrameDefinition:
                    "Create → first viewport frame on screen, not part of the result: from the " +
                    "first click on the New sprite dialog's Create button (at the animation " +
                    "frame after the dialog was seen, again every 50 ms while it stays) to the " +
                    "first animation frame in which the viewport's canvas is in the document " +
                    "with a box; the NGNE viewport inserts its canvas only after it has drawn",
                interactiveDefinition:
                    "navigation start to the first animation frame showing the New sprite " +
                    "dialog, the empty state's New sprite button being clicked at every frame " +
                    "(at most every 50 ms) from the first frame it is on screen",
                server: "vite build (project configuration) served by vite preview on 127.0.0.1",
                cold: "a new Chrome with an empty profile for every load",
                ...environment,
            };
            record({
                id: `se-070-cold-load-${gpu.id}`,
                ticket: "SE-070",
                measurement:
                    `Cold load of the production build served locally to interactive (the New ` +
                    `sprite dialog on screen after the empty state's first action), Chrome on ` +
                    `${gpu.label}, each load in a new browser with an empty profile.`,
                statistic: `largest of ${LOADS} cold loads, from navigation start`,
                budgetMs: BUDGET_MS,
                resultMs: sorted.at(-1)!,
                details,
            });
            console.log(JSON.stringify(details, null, 4));
        } finally {
            await server.close();
        }
    },
);
