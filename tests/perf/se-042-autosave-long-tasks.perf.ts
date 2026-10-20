import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { it } from "vitest";
import type {} from "../../src/app/testing/testHooks";
import type * as CoreModel from "../../src/core/model";
import { record } from "./record";
import type { PerfEntry } from "./record";

// SE-042: no long task over 50 ms is attributed to autosave for a 16-frame, 256×256 document
// (PerformanceObserver, recorded on the reference machine). Run alone:
//
//     npx vitest run --config vitest.perf.config.ts tests/perf/se-042-autosave-long-tasks.perf.ts
//
// The app runs from a Vite dev server in installed Chrome, new headless, as the E2E specs run
// it. A document of 16 frames, each with a 256×256 cel of opaque noise, is opened; one cel is
// painted through a transaction of its history (one step, as a stroke is), which makes the
// document dirty, and its first snapshot writes all 16 images. Then one cel is painted at a
// time, each followed by its snapshot (one image). Autosave wraps each snapshot in the User
// Timing measure `ngne-autosave` (from the start of its work to the end of its IndexedDB write).
// A long task (the browser's `longtask` entries: tasks over 50 ms) that overlaps one of those
// windows is attributed to autosave; nothing else runs on the page meanwhile (the viewport draws
// on demand, the benchmark waits). The result is the longest such task, 0 when there is none.
// The budget is 50 ms: any long task attributed to autosave is over it.

const SIDE = 256;
const FRAMES = 16;
/** Single-cel edits after the first snapshot. */
const EDITS = 24;
const BUDGET_MS = 50;
const WINDOW = { width: 1280, height: 800 };

declare global {
    interface Window {
        __se042LongTasks?: { startTime: number; duration: number }[];
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

/** Collects the page's long tasks from its first script on. */
function observeLongTasks(): void {
    window.__se042LongTasks = [];
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            window.__se042LongTasks!.push({ startTime: entry.startTime, duration: entry.duration });
        }
    }).observe({ type: "longtask", buffered: true });
}

/** Opens the benchmark document as the active one. */
async function openBenchmarkDocument(page: Page): Promise<void> {
    await page.evaluate(
        async ({ side, frames }) => {
            const load = new Function("path", "return import(path)") as (
                path: string,
            ) => Promise<typeof CoreModel>;
            const core = await load("/src/core/model/index.ts");
            const session = core.createDocument({ name: "autosave", width: side, height: side });
            const { doc } = session;
            const layerId = doc.layers[0]!.id;
            doc.frames = Array.from({ length: frames }, (_, index) => ({
                id: `bench-frame-${index}`,
                durationMs: 100,
            }));
            doc.cels.clear();
            doc.images.clear();
            let seed = 42;
            for (const frame of doc.frames) {
                const data = new Uint8ClampedArray(side * side * 4);
                for (let at = 0; at < data.length; at += 4) {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    data[at] = seed >>> 24;
                    data[at + 1] = (seed >>> 16) & 255;
                    data[at + 2] = (seed >>> 8) & 255;
                    data[at + 3] = 255;
                }
                const imageId = `bench-image-${frame.id}`;
                doc.images.set(imageId, { width: side, height: side, data });
                doc.cels.set(core.celKey(layerId, frame.id), { imageId, opacity: 255 });
            }
            session.activeLayerId = layerId;
            session.activeFrameId = doc.frames[0]!.id;
            window.__ngneTest!.sessions.getState().open(session, {
                view: { scale: 2, originX: 16, originY: 16 },
            });
            window.__ngneTest!.assertInvariants();
        },
        { side: SIDE, frames: FRAMES },
    );
}

/** Paints the cel of frame `edit % FRAMES` with colours of its own through one history step. */
async function paintCel(page: Page, edit: number): Promise<void> {
    await page.evaluate(
        ({ edit, frames }) => {
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            const { session, history } = document;
            const frameId = session.doc.frames[edit % frames]!.id;
            const transaction = history.begin({ layerId: session.activeLayerId, frameId });
            const { width, height, data } = transaction.image;
            for (let at = 0; at < data.length; at += 4) {
                data[at] = (edit * 53 + at) & 255;
                data[at + 1] = 7;
                data[at + 2] = 99;
                data[at + 3] = 255;
            }
            transaction.markDirty({ x: 0, y: 0, width, height });
            transaction.commit("Paint");
        },
        { edit, frames: FRAMES },
    );
}

/** The number of snapshots autosave has finished (its measures). */
function snapshotsWritten(page: Page): Promise<number> {
    return page.evaluate(() => performance.getEntriesByName("ngne-autosave", "measure").length);
}

async function waitForSnapshots(page: Page, count: number): Promise<void> {
    const deadline = Date.now() + 30_000;
    while ((await snapshotsWritten(page)) < count) {
        if (Date.now() > deadline) throw new Error(`se-042: snapshot ${count} was not written`);
        await sleep(50);
    }
}

it(`SE-042: long tasks attributed to autosave, ${FRAMES} frames of ${SIDE}×${SIDE}`, async () => {
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
        await page.addInitScript(observeLongTasks);
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(() => window.__ngneTest !== undefined, undefined, {
            timeout: 60_000,
        });
        // Vite may reload the page once after optimizing a dependency it found late.
        await sleep(2000);
        await page.waitForFunction(() => window.__ngneTest !== undefined);
        await page.waitForFunction(
            () => performance.getEntriesByName("ngne-autosave:recovery-checked").length > 0,
        );

        await openBenchmarkDocument(page);
        await sleep(500);
        await paintCel(page, 0);
        await waitForSnapshots(page, 1);
        for (let edit = 1; edit <= EDITS; edit++) {
            await paintCel(page, edit);
            await waitForSnapshots(page, 1 + edit);
        }
        // The observer's last entries arrive after their task.
        await sleep(500);

        const { windows, longTasks } = await page.evaluate(() => ({
            windows: performance
                .getEntriesByName("ngne-autosave", "measure")
                .map((entry) => ({ startTime: entry.startTime, duration: entry.duration })),
            longTasks: window.__se042LongTasks ?? [],
        }));
        const attributed = longTasks.filter((task) =>
            windows.some(
                (window) =>
                    task.startTime < window.startTime + window.duration &&
                    task.startTime + task.duration > window.startTime,
            ),
        );
        if (pageErrors.length > 0) throw new Error(`se-042: page errors: ${pageErrors.join("; ")}`);
        const durations = windows.map((window) => window.duration).sort((a, b) => a - b);
        const round = (ms: number) => Math.round(ms * 100) / 100;
        const entry: PerfEntry = {
            id: "se-042-autosave-long-tasks",
            ticket: "SE-042",
            measurement:
                "Longest long task (PerformanceObserver) overlapping an autosave snapshot of a 16-frame 256×256 document: its first snapshot (16 images) and 24 single-cel edits",
            statistic: "max over all snapshots (0 when no long task overlaps one)",
            budgetMs: BUDGET_MS,
            resultMs: round(Math.max(0, ...attributed.map((task) => task.duration))),
            details: {
                snapshots: windows.length,
                attributedLongTasks: attributed.map((task) => round(task.duration)),
                longTasksOnThePage: longTasks.length,
                firstSnapshotMs: round(windows[0]?.duration ?? Number.NaN),
                snapshotMedianMs: round(durations[Math.floor(durations.length / 2)] ?? Number.NaN),
                snapshotMaxMs: round(durations.at(-1) ?? Number.NaN),
                document: `${FRAMES} frames, one layer, ${SIDE}×${SIDE} opaque noise`,
                chrome: `${browser.version()}, new headless, ${args.join(" ")}`,
            },
        };
        record(entry);
        console.log(JSON.stringify(entry.details, null, 4));
    } finally {
        await browser?.close();
        await server?.close();
    }
});
