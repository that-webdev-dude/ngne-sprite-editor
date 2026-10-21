import type { Browser, Page } from "@playwright/test";
import type { ViteDevServer } from "vite";
import type * as ViewportLinkModule from "../../src/app/viewport/viewportLink";
import {
    checkAdapter,
    environmentDetails,
    expectPreviewExpanded,
    launch,
    newContext,
    openApp,
    openReferenceDocument,
    sleep,
    startDevServer,
    viewportSettled,
} from "./se-070-harness";
import type { AdapterInfo, GpuConfig } from "./se-070-harness";

// SE-070: the two frame-switch rows of SPEC §6.6, measured the same way. A switch is a real
// ArrowRight key press (sent through the DevTools protocol, a trusted event) with the
// viewport focused: the registered "Next Frame (Canvas)" command, as a user steps through
// the frames. The page records, from outside the code under test:
// - the key's `timeStamp` and the animation frame it arrived in (a requestAnimationFrame loop
//   of the page counts frames; it was registered before anything the key causes, so in each
//   frame it runs first);
// - the first frame the viewport submits (`viewportLink.onDrawn`: handed to NGNE, not known to
//   be presented) that draws the new active frame, its time and its animation frame;
// - the viewport's `texture()` calls between the key and that submit (`probe.textureCalls`).
// Each switch waits for the one before to be drawn and the viewport to be at rest.

/** What the page records of one switch. */
export interface SwitchSample {
    /** From the key's `timeStamp` to the submit of the frame showing the new frame, ms. */
    latencyMs: number;
    /** Animation frames from the key to that submit: 1 is the next animation frame. */
    frames: number;
    /** `texture()` calls of the viewport from the key to that submit. */
    uploads: number;
    /** The frame number switched to, from 1. */
    to: number;
}

interface SwitchRecorder {
    frame: number;
    pending: { t: number; frame: number; uploads: number; from: string } | null;
    samples: SwitchSample[];
    errors: string[];
}

declare global {
    interface Window {
        __se070switch?: SwitchRecorder;
    }
}

/** Installs the recorder in the page (after the app has loaded). */
export function installSwitchRecorder(page: Page): Promise<void> {
    return page.evaluate(async () => {
        const load = new Function("path", "return import(path)") as (
            path: string,
        ) => Promise<unknown>;
        const { viewportLink } = (await load(
            "/src/app/viewport/viewportLink.ts",
        )) as typeof ViewportLinkModule;
        const hooks = window.__ngneTest!;
        const recorder: SwitchRecorder = { frame: 0, pending: null, samples: [], errors: [] };
        window.__se070switch = recorder;
        const tick = () => {
            recorder.frame++;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const active = () => {
            const state = hooks.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId);
            if (!document) return null;
            const { doc, activeFrameId } = document.session;
            return {
                id: activeFrameId,
                number: doc.frames.findIndex((f) => f.id === activeFrameId) + 1,
            };
        };
        window.addEventListener(
            "keydown",
            (event) => {
                if (!event.isTrusted || event.key !== "ArrowRight") return;
                if (recorder.pending)
                    recorder.errors.push("a key came before the last switch was drawn");
                recorder.pending = {
                    t: event.timeStamp,
                    frame: recorder.frame,
                    uploads: hooks.viewport!.textureCalls,
                    from: active()?.id ?? "",
                };
            },
            true,
        );
        viewportLink.onDrawn((drawn) => {
            const pending = recorder.pending;
            if (!pending || !drawn) return;
            const now = performance.now();
            const target = active();
            if (!target || target.id === pending.from) return;
            const frameId = drawn.key.slice(0, drawn.key.lastIndexOf(":"));
            if (frameId !== target.id) return;
            recorder.samples.push({
                latencyMs: now - pending.t,
                frames: recorder.frame - pending.frame,
                uploads: hooks.viewport!.textureCalls - pending.uploads,
                to: target.number,
            });
            recorder.pending = null;
        });
    });
}

/** Presses ArrowRight on the viewport and waits for the switch to be drawn and to settle. */
export async function switchOnce(page: Page): Promise<SwitchSample> {
    const before = await page.evaluate(() => window.__se070switch!.samples.length);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((count) => window.__se070switch!.samples.length > count, before, {
        polling: 10,
        timeout: 30_000,
    });
    await viewportSettled(page);
    // Two animation frames of rest, so the next key does not land in this switch's frames.
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
    );
    return page.evaluate((index) => window.__se070switch!.samples[index]!, before);
}

/**
 * Throws unless every sample counted at least one animation frame from its key to its submit:
 * a count below 1 means the page's frame counter and the submit were out of order, and the
 * sample measured nothing (SE-070 review G).
 */
export function expectFramesCounted(samples: readonly SwitchSample[]): void {
    const uncounted = samples.filter((sample) => sample.frames < 1);
    if (uncounted.length > 0) {
        throw new Error(
            `se-070: ${uncounted.length} switches counted fewer than 1 animation frame (first ` +
                `to frame ${uncounted[0]!.to}: ${uncounted[0]!.frames}). Nothing was measured.`,
        );
    }
}

/** Makes frame `number` (from 1) active, as the timeline does; not measured. */
export async function showFrame(page: Page, number: number): Promise<void> {
    await page.evaluate((number) => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        document.session.activeFrameId = document.session.doc.frames[number - 1]!.id;
        state.touch(document.id);
    }, number);
    await viewportSettled(page);
}

/** The frame keys of the viewport's cache slots. */
export function slotKeys(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        window.__ngneTest!.viewport!.slots.filter((key): key is string => key !== null),
    );
}

export interface Session {
    page: Page;
    browser: Browser;
    adapter: AdapterInfo;
    pageErrors: string[];
    details(): Record<string, unknown>;
}

/**
 * Starts the dev server and Chrome, opens the reference document with `frames` frames, focuses
 * the viewport and installs the recorder; runs `measure`, then closes everything.
 */
export async function withReferenceDocument(
    gpu: GpuConfig,
    frames: number,
    measure: (session: Session) => Promise<void>,
): Promise<void> {
    let server: ViteDevServer | null = null;
    let browser: Browser | null = null;
    try {
        const started = await startDevServer();
        server = started.server;
        browser = await launch(gpu);
        const page = await (await newContext(browser)).newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => void pageErrors.push(String(error)));
        await openApp(page, started.url);
        const adapter = await checkAdapter(page, gpu);
        await openReferenceDocument(page, frames);
        await expectPreviewExpanded(page);
        await viewportSettled(page);
        await page.focus("[data-viewport]");
        await installSwitchRecorder(page);
        await sleep(500);
        const opened = browser;
        await measure({
            page,
            browser: opened,
            adapter,
            pageErrors,
            details: () => environmentDetails(opened, gpu, adapter),
        });
        const errors = await page.evaluate(() => window.__se070switch!.errors);
        if (errors.length > 0) throw new Error(`se-070: recorder: ${errors[0]}`);
        if (pageErrors.length > 0) throw new Error(`se-070: page errors: ${pageErrors[0]}`);
    } finally {
        await browser?.close();
        await server?.close();
    }
}
