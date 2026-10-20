import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest.preview`, `previewState` and `previewScheduler`.
import type {} from "../../src/app/preview/mountPreview";
import type * as CoreTags from "../../src/core/tags";
import type { PreviewDrawn } from "../../src/engine/NgnePreview";
import { openViewportEditor } from "./se-011-support";
import type { ToolkitOptions } from "./se-011-toolkit";

// Shared helpers of the SE-054 specs: the preview panel's game read back in `afterFrame`
// (SPEC §6.7), its state, and a scheduler that runs its frames one at a time.

/** The ALL_FRAMES key of `app/preview/previewState`. */
export const ALL_FRAMES = "*";
/** The colours of the background chip (`PREVIEW_BACKGROUNDS`), as RGB. */
export const BACKGROUNDS = {
    dark: [0x20, 0x20, 0x20],
    light: [0xe0, 0xe0, 0xe0],
    mid: [0x80, 0x80, 0x80],
} as const;

export type Rgb = readonly [number, number, number];

/** The preview's dock section and its parts. */
export const previewSection = (page: Page) => page.locator('[data-dock-panel="preview"]');
export const previewToggle = (page: Page) =>
    previewSection(page).getByRole("button", { name: "Preview · NGNE" });
export const previewStage = (page: Page) => previewSection(page).locator(".preview-panel__stage");
export const previewCanvas = (page: Page) =>
    previewSection(page).locator("[data-preview-canvas] canvas");

/** Opens the app with the SE-011 toolkit (device and upload counters) installed. */
export async function openPreviewEditor(page: Page, options: ToolkitOptions = {}): Promise<void> {
    await openViewportEditor(page, options);
    await expect(previewSection(page)).toBeVisible();
}

/** Sets the preview panel's choices, as its controls do. */
export function setPreview(
    page: Page,
    choices: {
        chosen?: string | null;
        playing?: boolean;
        speed?: number;
        background?: "dark" | "light" | "mid";
    },
): Promise<void> {
    return page.evaluate((choices) => {
        const state = window.__ngneTest!.previewState;
        if (!state) throw new Error("se-054: the preview panel is not mounted");
        state.setState(choices);
    }, choices);
}

/**
 * Waits until the preview's game runs, shows the newest atlas, and nothing is under way:
 * no lifecycle call, no upload.
 */
export async function previewSettled(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const probe = window.__ngneTest?.preview;
            const state = window.__ngneTest?.previewState?.getState();
            return (
                probe !== undefined &&
                state?.status.kind === "ready" &&
                !state.packing &&
                probe.settled &&
                probe.lifecycle === "Running" &&
                probe.serial > 0 &&
                probe.published === probe.serial
            );
        },
        undefined,
        { polling: 50 },
    );
}

/** One frame of the preview read back in `afterFrame`. */
export interface PreviewRead {
    drawn: PreviewDrawn | null;
    width: number;
    height: number;
    data: number[];
}

/**
 * Resolves with the first frame of the preview, read back in its `afterFrame`, for which
 * `drawn` is a frame of the atlas with serial `serial` or later (the newest when omitted).
 */
export function readPreview(page: Page, frame?: string, serial?: number): Promise<PreviewRead> {
    return page.evaluate(
        ({ frame, serial }) =>
            new Promise<PreviewRead>((resolve, reject) => {
                const probe = window.__ngneTest?.preview;
                if (!probe) {
                    reject(new Error("se-054: no preview"));
                    return;
                }
                const atLeast = serial ?? probe.serial;
                const timer = setTimeout(() => {
                    probe.onFrame = null;
                    reject(new Error(`se-054: no frame ${frame ?? "(any)"} of serial ${atLeast}`));
                }, 15_000);
                probe.onFrame = (read, drawn) => {
                    if (!drawn || drawn.serial < atLeast) return;
                    if (frame !== undefined && drawn.frame !== frame) return;
                    probe.onFrame = null;
                    clearTimeout(timer);
                    const image = read();
                    resolve({
                        drawn,
                        width: image.width,
                        height: image.height,
                        data: Array.from(image.data),
                    });
                };
                // Frames run on demand: one at the next animation frame.
                probe.wake();
            }),
        { frame, serial },
    );
}

/** A frame of the preview recorded by `recordPreview`. */
export interface RecordedFrame extends PreviewRead {
    /** `performance.now()` in the frame's task. */
    at: number;
}

/**
 * Records every frame of the preview from now on, read back in its `afterFrame`. With
 * `continuous` the game draws at every animation frame meanwhile, not only on demand.
 */
export async function recordPreview(page: Page, continuous = false): Promise<void> {
    await page.evaluate((continuous) => {
        const frames: RecordedFrame[] = [];
        (window as unknown as { __se054Frames: RecordedFrame[] }).__se054Frames = frames;
        const probe = window.__ngneTest!.preview!;
        probe.continuous = continuous;
        probe.onFrame = (read, drawn) => {
            const image = read();
            frames.push({
                at: performance.now(),
                drawn: drawn && { ...drawn },
                width: image.width,
                height: image.height,
                data: Array.from(image.data),
            });
        };
    }, continuous);
}

/**
 * While `recordPreview` goes on, waits until it has recorded a frame of the newest atlas.
 * `readPreview` cannot do this: it takes the frame hook from the recorder, so a frame drawn
 * after the atlas is published but before the hook changes hands would be missed.
 */
export function recordedNewest(page: Page): Promise<void> {
    return page.evaluate(
        () =>
            new Promise<void>((resolve, reject) => {
                const probe = window.__ngneTest?.preview;
                const frames = (window as unknown as { __se054Frames?: RecordedFrame[] })
                    .__se054Frames;
                if (!probe || !frames) {
                    reject(new Error("se-054: not recording"));
                    return;
                }
                const atLeast = probe.serial;
                const started = performance.now();
                const check = () => {
                    if (frames.some((frame) => frame.drawn && frame.drawn.serial >= atLeast)) {
                        resolve();
                    } else if (performance.now() - started > 15_000) {
                        reject(new Error(`se-054: no recorded frame of serial ${atLeast}`));
                    } else {
                        // Frames run on demand: ask for one at each animation frame.
                        probe.wake();
                        requestAnimationFrame(check);
                    }
                };
                check();
            }),
    );
}

/** Stops `recordPreview` and returns what it recorded. */
export function recordedPreview(page: Page): Promise<RecordedFrame[]> {
    return page.evaluate(() => {
        const probe = window.__ngneTest?.preview;
        if (probe) {
            probe.onFrame = null;
            probe.continuous = false;
        }
        return (window as unknown as { __se054Frames: RecordedFrame[] }).__se054Frames;
    });
}

/**
 * The texels of a read that differ from `pixels` over `under`: an opaque texel exactly, a
 * transparent one shows `under` exactly, any other the blend over `under` within ±1.
 */
export function previewMismatches(
    read: { width: number; height: number; data: readonly number[] },
    pixels: readonly number[],
    under: Rgb,
): string[] {
    const mismatches: string[] = [];
    for (let at = 0; at < read.width * read.height; at++) {
        const alpha = pixels[at * 4 + 3] ?? 0;
        const tolerance = alpha === 0 || alpha === 255 ? 0 : 1;
        const actual = read.data.slice(at * 4, at * 4 + 4);
        const expected = [0, 1, 2].map(
            (channel) =>
                ((pixels[at * 4 + channel] ?? 0) * alpha + (under[channel] ?? 0) * (255 - alpha)) /
                255,
        );
        const same =
            actual[3] === 255 &&
            expected.every(
                (value, channel) => Math.abs((actual[channel] ?? -9) - value) <= tolerance,
            );
        if (!same) {
            const x = at % read.width;
            const y = Math.floor(at / read.width);
            mismatches.push(
                `(${x}, ${y}): ${actual.join(",")} for ${expected.map((v) => v.toFixed(1))}`,
            );
        }
    }
    return mismatches;
}

/** The atlas frame ID of frame `index` of a document named `name` (SPEC §9.3). */
export const frameIdOf = (name: string, index: number) => `${name}-${index}`;

/** Creates a tag over frames `from`..`to` (indices) through the history; returns its id. */
export function createTag(
    page: Page,
    id: string,
    tag: { name: string; from: number; to: number; direction?: "forward" | "reverse" | "pingpong" },
): Promise<string> {
    return page.evaluate(
        async ({ id, tag }) => {
            const path = "/src/core/tags/index.ts";
            const tags = (await import(/* @vite-ignore */ path)) as typeof CoreTags;
            const { documents } = window.__ngneTest!.sessions.getState();
            const { session, history } = documents.find((entry) => entry.id === id)!;
            const { doc } = session;
            history.execute(
                tags.createTagCommand(doc, {
                    name: tag.name,
                    color: 0x4080c0ff,
                    fromFrameId: doc.frames[tag.from]!.id,
                    toFrameId: doc.frames[tag.to]!.id,
                    direction: tag.direction ?? "forward",
                    repeat: 0,
                }),
            );
            return doc.tags[doc.tags.length - 1]!.id;
        },
        { id, tag },
    );
}

/** Changes a tag's direction through the history. */
export function setTagDirection(
    page: Page,
    id: string,
    tagId: string,
    direction: "forward" | "reverse" | "pingpong",
): Promise<void> {
    return page.evaluate(
        async ({ id, tagId, direction }) => {
            const path = "/src/core/tags/index.ts";
            const tags = (await import(/* @vite-ignore */ path)) as typeof CoreTags;
            const { documents } = window.__ngneTest!.sessions.getState();
            const { session, history } = documents.find((entry) => entry.id === id)!;
            const command = tags.editTagCommand(session.doc, tagId, { direction });
            if (command) history.execute(command);
        },
        { id, tagId, direction },
    );
}

/**
 * Puts a scheduler in place of `requestAnimationFrame` for the preview games made from now on:
 * a frame runs only when `runPreviewFrames` asks, each `ms` milliseconds after the one before.
 */
export async function installManualScheduler(page: Page): Promise<void> {
    await page.evaluate(() => {
        let pending: FrameRequestCallback | undefined;
        let id = 0;
        // NGNE takes a timestamp of 0 for "no frame yet": the clock starts above it.
        let now = 1000;
        const scheduler = {
            request(callback: FrameRequestCallback) {
                pending = callback;
                return ++id;
            },
            cancel(handle: number) {
                if (handle === id) pending = undefined;
            },
            run(ms: number) {
                const callback = pending;
                if (!callback) return false;
                pending = undefined;
                now += ms;
                callback(now);
                return true;
            },
        };
        (window as unknown as { __se054Scheduler: typeof scheduler }).__se054Scheduler = scheduler;
        window.__ngneTest!.previewScheduler = scheduler;
    });
}

/**
 * Runs `count` frames of the preview on the manual scheduler, `ms` apart, and returns what
 * each drew and its image, read back in `afterFrame`. A frame the game has not asked for yet
 * is waited for.
 */
export function runPreviewFrames(page: Page, count: number, ms: number): Promise<PreviewRead[]> {
    return page.evaluate(
        async ({ count, ms }) => {
            const scheduler = (
                window as unknown as { __se054Scheduler: { run(ms: number): boolean } }
            ).__se054Scheduler;
            const probe = window.__ngneTest!.preview!;
            const drawn: PreviewRead[] = [];
            probe.onFrame = (read, frame) => {
                const image = read();
                drawn.push({
                    drawn: frame && { ...frame },
                    width: image.width,
                    height: image.height,
                    data: Array.from(image.data),
                });
            };
            try {
                for (let index = 0; index < count; index++) {
                    const deadline = performance.now() + 5000;
                    while (!scheduler.run(ms)) {
                        if (performance.now() > deadline)
                            throw new Error("se-054: no frame asked for");
                        await new Promise((resolve) => setTimeout(resolve, 5));
                    }
                }
            } finally {
                probe.onFrame = null;
            }
            return drawn;
        },
        { count, ms },
    );
}

/**
 * Collapses the preview section, so the page has no preview game: for tests that count the
 * page's WebGPU devices or texture copies as the viewport's (SE-011). The button is clicked
 * from the page, which moves no focus.
 */
export async function collapsePreview(page: Page): Promise<void> {
    const toggle = previewToggle(page);
    if ((await toggle.getAttribute("aria-expanded")) === "true") {
        await toggle.evaluate((button) => (button as HTMLButtonElement).click());
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.waitForFunction(() => window.__ngneTest?.preview === undefined);
}

/** Collapses or expands the preview section with its header button. */
export async function togglePreview(page: Page): Promise<void> {
    await previewToggle(page).click();
}

/** The preview section's body, which the dock mounts only while expanded. */
export function previewBody(page: Page): Locator {
    return previewSection(page).locator(".dock-section__body");
}
