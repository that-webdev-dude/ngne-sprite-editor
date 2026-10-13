import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest` and its `viewport` probe, the development-only test hooks.
import type {} from "../../src/app/viewport/mountViewport";
// Modules the page imports from the dev server, for the types of what they export.
import type * as CoreFrames from "../../src/core/frames";
import { openEditor, openSession } from "./se-007-support";

// Shared helpers of the SE-011 specs: a page-side toolkit (canvas crops, a recorder of the
// frames the viewport submits, the device tracker of SE-002 question 8), test documents
// painted through the real history, and the image a document must produce.

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A rectangle of a canvas readback, RGBA bytes row by row. */
export interface Crop extends Rect {
    data: number[];
}

/** One frame the viewport submitted, as the recorder saw it in the task of its draw. */
export interface Capture {
    /** `submittedFrames` after this frame. */
    serial: number;
    /** Time of the animation frame the draw ran in (`document.timeline.currentTime`). */
    stamp: number;
    /** Milliseconds since the page loaded. */
    at: number;
    crop: Crop;
}

/** The animation frame an action ran in and the ones that followed. */
export interface FrameTimes {
    start: number;
    stamps: number[];
}

interface Toolkit {
    crop(image: ImageData, rect: Rect): Crop;
    /** Pixels outside `rect` that are not exactly `colour`. */
    outside(image: ImageData, rect: Rect, colour: Rgb): number;
    /** Records a crop of every frame the viewport submits from now on. */
    record(rect: Rect): void;
    captures: Capture[];
    /**
     * Runs `action` at the start of an animation frame, where input events are handled, and
     * resolves with the time of that frame and of the `frames` animation frames after it.
     */
    atFrameStart(action: () => void, frames: number): Promise<FrameTimes>;
    /** Devices created by the page and not destroyed or lost. */
    liveDevices(): number;
    devicesCreated(): number;
    /** `destroy()` on the newest live device, as a driver reset would (SE-002 question 8). */
    loseDevice(): void;
    /** Makes the next `count` `requestDevice` calls reject. */
    refuseDevices(count: number): void;
    /** Uploads wait while the gate is closed. */
    closeUploadGate(): void;
    openUploadGate(): void;
}

declare global {
    interface Window {
        __se011: Toolkit;
    }
}

// The DOM library of the pinned TypeScript has no WebGPU types; only these fields are used.
interface DeviceLike {
    destroy(): void;
    readonly lost: Promise<unknown>;
}
interface AdapterLike {
    requestDevice(...args: unknown[]): Promise<DeviceLike>;
}

/** Runs in the page before the app loads. Self-contained: it is sent as source text. */
function installToolkit(): void {
    const devices: { device: DeviceLike; live: boolean }[] = [];
    let refuse = 0;
    const scope = globalThis as unknown as { GPUAdapter?: { prototype: AdapterLike } };
    const prototype = scope.GPUAdapter?.prototype;
    if (prototype) {
        const original = prototype.requestDevice;
        prototype.requestDevice = async function (this: AdapterLike, ...args: unknown[]) {
            if (refuse > 0) {
                refuse--;
                throw new Error("se-011: requestDevice refused");
            }
            const device = await original.apply(this, args);
            const entry = { device, live: true };
            const destroy = device.destroy.bind(device);
            device.destroy = () => {
                entry.live = false;
                destroy();
            };
            void device.lost.then(() => {
                entry.live = false;
            });
            devices.push(entry);
            return device;
        };
    }

    let release: (() => void) | null = null;
    const toolkit: Toolkit = {
        crop(image, rect) {
            const data: number[] = [];
            for (let y = rect.y; y < rect.y + rect.height; y++) {
                const start = (y * image.width + rect.x) * 4;
                for (let at = start; at < start + rect.width * 4; at++) {
                    data.push(image.data[at] ?? -1);
                }
            }
            return { ...rect, data };
        },
        outside(image, rect, colour) {
            let count = 0;
            for (let y = 0; y < image.height; y++) {
                for (let x = 0; x < image.width; x++) {
                    const inside =
                        x >= rect.x &&
                        x < rect.x + rect.width &&
                        y >= rect.y &&
                        y < rect.y + rect.height;
                    if (inside) continue;
                    const at = (y * image.width + x) * 4;
                    if (
                        image.data[at] !== colour[0] ||
                        image.data[at + 1] !== colour[1] ||
                        image.data[at + 2] !== colour[2] ||
                        image.data[at + 3] !== 255
                    ) {
                        count++;
                    }
                }
            }
            return count;
        },
        captures: [],
        record(rect) {
            const probe = window.__ngneTest?.viewport;
            if (!probe) throw new Error("se-011: no viewport to record");
            toolkit.captures = [];
            probe.onFrame = (read) => {
                toolkit.captures.push({
                    serial: probe.submittedFrames,
                    stamp: Number(document.timeline.currentTime),
                    at: performance.now(),
                    crop: toolkit.crop(read(), rect),
                });
            };
        },
        atFrameStart(action, frames) {
            return new Promise((resolve) => {
                requestAnimationFrame((start) => {
                    action();
                    const stamps: number[] = [];
                    const next = (stamp: number) => {
                        stamps.push(stamp);
                        if (stamps.length < frames) requestAnimationFrame(next);
                        else resolve({ start, stamps });
                    };
                    requestAnimationFrame(next);
                });
            });
        },
        liveDevices: () => devices.filter((entry) => entry.live).length,
        devicesCreated: () => devices.length,
        loseDevice() {
            const entry = [...devices].reverse().find((candidate) => candidate.live);
            if (!entry) throw new Error("se-011: no live device to destroy");
            entry.device.destroy();
        },
        refuseDevices(count) {
            refuse = count;
        },
        closeUploadGate() {
            const probe = window.__ngneTest?.viewport;
            if (!probe) throw new Error("se-011: no viewport to gate");
            const opened = new Promise<void>((resolve) => {
                release = resolve;
            });
            probe.uploadGate = () => opened;
        },
        openUploadGate() {
            const probe = window.__ngneTest?.viewport;
            if (probe) probe.uploadGate = null;
            release?.();
            release = null;
        },
    };
    window.__se011 = toolkit;
}

/** Opens the app with the toolkit installed and waits for the shell and the test hook. */
export async function openViewportEditor(page: Page): Promise<void> {
    await page.addInitScript(installToolkit);
    await openEditor(page);
}

/** The element the viewport fills with its canvas. */
export const viewportHost = (page: Page) => page.locator("[data-viewport-canvas]");

/**
 * Waits until the viewport is at rest: a renderer whose canvas has the host's size in device
 * pixels, and no upload, draw or renderer replacement under way.
 */
export async function settle(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const probe = window.__ngneTest?.viewport;
            const host = document.querySelector("[data-viewport-canvas]");
            const size = probe?.canvasSize;
            if (!probe || !host || !size || !probe.settled) return false;
            const box = host.getBoundingClientRect();
            return (
                Math.abs(size.width - box.width * devicePixelRatio) < 1 &&
                Math.abs(size.height - box.height * devicePixelRatio) < 1
            );
        },
        undefined,
        { polling: 50 },
    );
}

export interface TestDocument {
    id: string;
    width: number;
    height: number;
    /** The id of the frame the document was opened with. */
    frameId: string;
    layerId: string;
}

/** Opens a document as the active session and sets its view. */
export async function openDocument(
    page: Page,
    options: { name?: string; width: number; height: number },
    view?: { scale: number; originX: number; originY: number },
): Promise<TestDocument> {
    const { width, height } = options;
    const id = await openSession(page, { name: options.name ?? "viewport", width, height });
    if (view) await setView(page, id, view);
    const ids = await page.evaluate((id) => {
        const { documents } = window.__ngneTest!.sessions.getState();
        const { session } = documents.find((entry) => entry.id === id)!;
        return { frameId: session.activeFrameId, layerId: session.activeLayerId };
    }, id);
    return { id, width, height, ...ids };
}

export function setView(
    page: Page,
    id: string,
    view: { scale: number; originX: number; originY: number },
): Promise<void> {
    return page.evaluate(
        ({ id, view }) => window.__ngneTest!.sessions.getState().setView(id, view),
        { id, view },
    );
}

/**
 * Writes a whole image into the cel of the active layer at a frame, through a transaction of
 * the document's history (one undo step). `pixels` are RGBA bytes, row by row.
 */
export function paint(
    page: Page,
    id: string,
    pixels: readonly number[],
    frameId?: string,
): Promise<void> {
    return page.evaluate(
        ({ id, pixels, frameId }) => {
            const { documents } = window.__ngneTest!.sessions.getState();
            const { session, history } = documents.find((entry) => entry.id === id)!;
            const transaction = history.begin({
                layerId: session.activeLayerId,
                frameId: frameId ?? session.activeFrameId,
            });
            transaction.image.data.set(pixels);
            const { width, height } = transaction.image;
            transaction.markDirty({ x: 0, y: 0, width, height });
            transaction.commit("Paint");
        },
        { id, pixels: [...pixels], frameId },
    );
}

/** Adds an empty frame after the active one through the history; returns its id. */
export function addFrame(page: Page, id: string): Promise<string> {
    return page.evaluate(async (id) => {
        const path = "/src/core/frames/index.ts";
        const frames = (await import(/* @vite-ignore */ path)) as typeof CoreFrames;
        const { documents } = window.__ngneTest!.sessions.getState();
        const { session, history } = documents.find((entry) => entry.id === id)!;
        history.execute(frames.addFrameCommand(session.doc, session.activeFrameId));
        return session.activeFrameId;
    }, id);
}

/** Makes a frame the active one, as the timeline will: session state, outside the history. */
export function showFrame(page: Page, id: string, frameId: string): Promise<void> {
    return page.evaluate(
        ({ id, frameId }) => {
            const sessions = window.__ngneTest!.sessions.getState();
            const { session } = sessions.documents.find((entry) => entry.id === id)!;
            session.activeFrameId = frameId;
            sessions.touch(id);
        },
        { id, frameId },
    );
}

/** A `width` × `height` image of one colour, as RGBA bytes. */
export function solid(width: number, height: number, colour: Rgba): number[] {
    return Array.from({ length: width * height }, () => [...colour]).flat();
}

/**
 * An opaque test image: every texel differs from its neighbours, and images of different
 * seeds differ in every texel.
 */
export function pattern(width: number, height: number, seed: number): number[] {
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            pixels.push((x * 37 + seed * 61 + 11) & 255, (y * 53 + seed * 17 + 7) & 255);
            pixels.push((seed * 23 + (x + y) * 2) & 255, 255);
        }
    }
    return pixels;
}

/** The frames the recorder has captured since `record`. */
export function captures(page: Page): Promise<Capture[]> {
    return page.evaluate(() => window.__se011.captures);
}

/**
 * How many animation frames after the one of the action the frame at `stamp` came: 1 is the
 * next animation frame.
 */
export function framesUntil(times: FrameTimes, stamp: number): number {
    return times.stamps.filter((value) => value <= stamp + 0.01).length;
}

/** Which of `images` a crop of the document rectangle shows in full; -1 when none. */
export function shows(
    crop: Crop,
    images: readonly (readonly number[])[],
    width: number,
    scale: number,
    checker: Checker = DARK_CHECKER,
): number {
    return images.findIndex((pixels) => compare(crop, pixels, width, scale, checker).length === 0);
}

/** The colours the dark theme gives the viewport (DESIGN §3.1): the default of the tests. */
export const DARK = {
    workspace: [0x0f, 0x0f, 0x10] as Rgb,
    checkerA: [0x3a, 0x3a, 0x3a] as Rgb,
    checkerB: [0x4a, 0x4a, 0x4a] as Rgb,
    checkerSize: 8,
};

export interface Checker {
    a: Rgb;
    b: Rgb;
    size: number;
}

export const DARK_CHECKER: Checker = { a: DARK.checkerA, b: DARK.checkerB, size: DARK.checkerSize };

/** The document rectangle of SPEC §6.4 in device pixels. */
export function documentRect(
    document: { width: number; height: number },
    view: { scale: number; originX: number; originY: number },
): Rect {
    return {
        x: view.originX,
        y: view.originY,
        width: document.width * view.scale,
        height: document.height * view.scale,
    };
}

/** What `probe.readCanvas()` shows inside `rect`, and how much outside it is not workspace. */
export async function readback(
    page: Page,
    rect: Rect,
    workspace: Rgb = DARK.workspace,
): Promise<{ size: { width: number; height: number }; crop: Crop; outside: number }> {
    return page.evaluate(
        ({ rect, workspace }) => {
            const image = window.__ngneTest!.viewport!.readCanvas();
            if (!image) throw new Error("se-011: the viewport has no ready renderer");
            return {
                size: { width: image.width, height: image.height },
                crop: window.__se011.crop(image, rect),
                outside: window.__se011.outside(image, rect, workspace),
            };
        },
        { rect, workspace },
    );
}

export interface Mismatch {
    /** Device pixel, relative to the canvas. */
    x: number;
    y: number;
    /** Document pixel it belongs to. */
    texel: [number, number];
    expected: number[];
    actual: number[];
    tolerance: number;
}

/** The checkerboard colour behind a document pixel. */
export function checkerAt(checker: Checker, x: number, y: number): Rgb {
    const first = (Math.floor(x / checker.size) + Math.floor(y / checker.size)) % 2 === 0;
    return first ? checker.a : checker.b;
}

/**
 * Compares a crop of the document rectangle with the image the document must produce at an
 * integer `scale`: every texel covers exactly `scale` × `scale` device pixels. An opaque
 * texel has its exact colour, a transparent one the exact checkerboard colour, and a
 * semi-transparent one the blend over the checkerboard within ±1 per channel (SE-011).
 * Returns the device pixels that differ.
 */
export function compare(
    crop: Crop,
    pixels: readonly number[],
    width: number,
    scale: number,
    checker: Checker = DARK_CHECKER,
): Mismatch[] {
    const mismatches: Mismatch[] = [];
    for (let y = 0; y < crop.height; y++) {
        for (let x = 0; x < crop.width; x++) {
            const tx = Math.floor(x / scale);
            const ty = Math.floor(y / scale);
            const at = (ty * width + tx) * 4;
            const alpha = pixels[at + 3] ?? 0;
            const under = checkerAt(checker, tx, ty);
            const expected = [0, 1, 2].map(
                (channel) =>
                    ((pixels[at + channel] ?? 0) * alpha + (under[channel] ?? 0) * (255 - alpha)) /
                    255,
            );
            const tolerance = alpha === 255 || alpha === 0 ? 0 : 1;
            const from = (y * crop.width + x) * 4;
            const actual = crop.data.slice(from, from + 4);
            const same =
                actual[3] === 255 &&
                expected.every(
                    (value, channel) => Math.abs((actual[channel] ?? -9) - value) <= tolerance,
                );
            if (!same) {
                mismatches.push({
                    x: crop.x + x,
                    y: crop.y + y,
                    texel: [tx, ty],
                    expected,
                    actual,
                    tolerance,
                });
            }
        }
    }
    return mismatches;
}

/** Asserts that the viewport, read back now, shows the document image and nothing else. */
export async function expectImage(
    page: Page,
    document: { width: number; height: number },
    view: { scale: number; originX: number; originY: number },
    pixels: readonly number[],
    checker: Checker = DARK_CHECKER,
    workspace: Rgb = DARK.workspace,
): Promise<void> {
    const result = await readback(page, documentRect(document, view), workspace);
    expect(compare(result.crop, pixels, document.width, view.scale, checker).slice(0, 5)).toEqual(
        [],
    );
    expect(result.outside).toBe(0);
}

/** The single colour of a crop, or null when its pixels are not all the same. */
export function uniform(crop: Crop): number[] | null {
    const first = crop.data.slice(0, 4);
    for (let at = 0; at < crop.data.length; at += 4) {
        for (let channel = 0; channel < 4; channel++) {
            if (crop.data[at + channel] !== first[channel]) return null;
        }
    }
    return first;
}
