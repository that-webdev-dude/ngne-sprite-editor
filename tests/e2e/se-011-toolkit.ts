// Declares `window.__ngneTest` and its `viewport` probe, the development-only test hooks.
import type {} from "../../src/app/viewport/mountViewport";
// Declares `window.se011`, the harness page's handle on its viewport.
import type {} from "./harness/se-011-viewport";

// The page side of the SE-011 specs: `installToolkit` runs in the page before any of its
// scripts and puts `window.__se011` there. It reads canvases, records the frames the viewport
// submits, and watches the page's WebGPU objects from outside the code under test: devices
// (the method of SE-002 question 8), uploads, and which canvas has drawn.

export type Rgb = readonly [number, number, number];

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

/** A canvas that entered the viewport element. */
export interface CanvasEntry {
    /** Whether NGNE had drawn on it (`getCurrentTexture`) before it entered the document. */
    drawn: boolean;
    /** Canvases in the viewport element once it was in. */
    canvases: number;
}

/** What is alive in the page; counted only when the toolkit was installed with `track`. */
export interface Alive {
    /** `setInterval` timers not cleared. */
    intervals: number;
    /** `setTimeout` timers neither run nor cleared. */
    timeouts: number;
    /** `requestAnimationFrame` requests neither run nor cancelled. */
    frames: number;
    /** `focus` listeners on the window. */
    focusListeners: number;
    /** `visibilitychange` listeners on the document. */
    visibilityListeners: number;
    /** `ResizeObserver`s that observe something. */
    resizeObservers: number;
}

export interface ToolkitOptions {
    /**
     * Wraps the page's timers, `focus` and `visibilitychange` listeners and `ResizeObserver`
     * so that `alive()` counts them and intervals can be held. Off unless a spec needs it:
     * the wrappers sit under everything the page does.
     */
    track?: boolean;
}

export interface Toolkit {
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

    /**
     * Renderers the viewport code holds, by its own count. It is read from the probe on the
     * page, or from the last one this toolkit saw when the viewport is gone; -1 when it never
     * saw one.
     */
    liveRenderers(): number;
    /** Devices created by the page and not destroyed or lost. */
    liveDevices(): number;
    devicesCreated(): number;
    /** `requestDevice` calls that have not settled: devices being created. */
    creatingDevices(): number;
    /** The most devices that were being created at once, and that were alive at once. */
    peaks(): { creating: number; live: number };
    /** `destroy()` on the newest live device, as a driver reset would (SE-002 question 8). */
    loseDevice(): void;
    /** Makes the next `count` `requestDevice` calls reject. */
    refuseDevices(count: number): void;
    /** `requestDevice` calls made from now on wait for `releaseDevices`. */
    holdDevices(): void;
    releaseDevices(): void;

    /**
     * `GPUQueue.copyExternalImageToTexture` calls: NGNE makes one per upload, so this counts
     * `texture()` calls without asking the viewport.
     */
    copies(): number;
    /** Makes the next `count` uploads fail inside NGNE, as a rejected `texture()` call. */
    failCopies(count: number): void;

    /** Logs every canvas that enters the viewport element from now on. */
    watchCanvases(): void;
    canvasLog: CanvasEntry[];

    /** Uploads wait while the gate is closed. */
    closeUploadGate(): void;
    openUploadGate(): void;

    alive(): Alive;
    /** From now on `setInterval` timers are not run by the clock; `fireIntervals` runs them. */
    holdIntervals(): void;
    fireIntervals(): void;
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
interface QueueLike {
    copyExternalImageToTexture(...args: unknown[]): unknown;
}
interface CanvasContextLike {
    readonly canvas: unknown;
    getCurrentTexture(...args: unknown[]): unknown;
}
interface GpuScope {
    GPUAdapter?: { prototype: AdapterLike };
    GPUQueue?: { prototype: QueueLike };
    GPUCanvasContext?: { prototype: CanvasContextLike };
}

/** Runs in the page before its scripts. Self-contained: it is sent as source text. */
export function installToolkit(options: ToolkitOptions = {}): void {
    const scope = globalThis as unknown as GpuScope;

    // --- Devices -------------------------------------------------------------------------
    const devices: { device: DeviceLike; live: boolean }[] = [];
    const liveDevices = () => devices.filter((entry) => entry.live).length;
    let refuse = 0;
    let creating = 0;
    const peaks = { creating: 0, live: 0 };
    let held: Promise<void> | null = null;
    let releaseHeld: (() => void) | null = null;
    const adapter = scope.GPUAdapter?.prototype;
    if (adapter) {
        const original = adapter.requestDevice;
        adapter.requestDevice = async function (this: AdapterLike, ...args: unknown[]) {
            if (refuse > 0) {
                refuse--;
                throw new Error("se-011: requestDevice refused");
            }
            creating++;
            peaks.creating = Math.max(peaks.creating, creating);
            try {
                if (held) await held;
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
                peaks.live = Math.max(peaks.live, liveDevices());
                return device;
            } finally {
                creating--;
            }
        };
    }

    // --- Uploads -------------------------------------------------------------------------
    let copies = 0;
    let failCopies = 0;
    const queue = scope.GPUQueue?.prototype;
    if (queue) {
        const original = queue.copyExternalImageToTexture;
        queue.copyExternalImageToTexture = function (this: QueueLike, ...args: unknown[]) {
            copies++;
            if (failCopies > 0) {
                failCopies--;
                throw new Error("se-011: copyExternalImageToTexture refused");
            }
            return original.apply(this, args);
        };
    }

    // --- Canvases that have drawn ---------------------------------------------------------
    const drawn = new WeakSet<object>();
    const context = scope.GPUCanvasContext?.prototype;
    if (context) {
        const original = context.getCurrentTexture;
        context.getCurrentTexture = function (this: CanvasContextLike, ...args: unknown[]) {
            if (typeof this.canvas === "object" && this.canvas !== null) drawn.add(this.canvas);
            return original.apply(this, args);
        };
    }

    // --- Timers, listeners and observers --------------------------------------------------
    const intervals = new Set<number>();
    const heldIntervals = new Map<number, () => void>();
    const timeouts = new Set<number>();
    const frames = new Set<number>();
    const focusListeners = new Set<unknown>();
    const visibilityListeners = new Set<unknown>();
    const observers = new Set<object>();
    let holdingIntervals = false;
    if (options.track) {
        const setIntervalNow = window.setInterval.bind(window);
        const clearIntervalNow = window.clearInterval.bind(window);
        let nextHeld = -1;
        window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
            if (holdingIntervals && typeof handler === "function") {
                const id = nextHeld--;
                heldIntervals.set(id, () => handler(...args));
                intervals.add(id);
                return id;
            }
            const id = setIntervalNow(handler, delay, ...args);
            intervals.add(id);
            return id;
        }) as typeof window.setInterval;
        window.clearInterval = ((id?: number) => {
            if (id === undefined) return;
            intervals.delete(id);
            if (!heldIntervals.delete(id)) clearIntervalNow(id);
        }) as typeof window.clearInterval;

        const setTimeoutNow = window.setTimeout.bind(window);
        const clearTimeoutNow = window.clearTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
            const id: number = setTimeoutNow(
                (...inner: unknown[]) => {
                    timeouts.delete(id);
                    if (typeof handler === "function") handler(...inner);
                },
                delay,
                ...args,
            );
            timeouts.add(id);
            return id;
        }) as typeof window.setTimeout;
        window.clearTimeout = ((id?: number) => {
            if (id !== undefined) timeouts.delete(id);
            clearTimeoutNow(id);
        }) as typeof window.clearTimeout;

        const requestFrameNow = window.requestAnimationFrame.bind(window);
        const cancelFrameNow = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => {
            const id = requestFrameNow((time) => {
                frames.delete(id);
                callback(time);
            });
            frames.add(id);
            return id;
        };
        window.cancelAnimationFrame = (id) => {
            frames.delete(id);
            cancelFrameNow(id);
        };

        const follow = (target: EventTarget, type: string, listeners: Set<unknown>) => {
            const add = target.addEventListener.bind(target);
            const remove = target.removeEventListener.bind(target);
            target.addEventListener = (
                name: string,
                listener: EventListenerOrEventListenerObject | null,
                how?: boolean | AddEventListenerOptions,
            ) => {
                if (name === type && listener) listeners.add(listener);
                add(name, listener, how);
            };
            target.removeEventListener = (
                name: string,
                listener: EventListenerOrEventListenerObject | null,
                how?: boolean | EventListenerOptions,
            ) => {
                if (name === type && listener) listeners.delete(listener);
                remove(name, listener, how);
            };
        };
        follow(window, "focus", focusListeners);
        follow(document, "visibilitychange", visibilityListeners);

        const Observer = window.ResizeObserver;
        const targets = new WeakMap<object, Set<Element>>();
        window.ResizeObserver = class extends Observer {
            override observe(target: Element, how?: ResizeObserverOptions): void {
                const mine = targets.get(this) ?? new Set<Element>();
                targets.set(this, mine);
                mine.add(target);
                observers.add(this);
                super.observe(target, how);
            }
            override unobserve(target: Element): void {
                const mine = targets.get(this);
                mine?.delete(target);
                if (!mine?.size) observers.delete(this);
                super.unobserve(target);
            }
            override disconnect(): void {
                targets.get(this)?.clear();
                observers.delete(this);
                super.disconnect();
            }
        };
    }

    /** The viewport's probe: of the app, or of the harness page. */
    let remembered: NonNullable<typeof window.se011>["probe"] = null;
    const probe = () => {
        const found = window.__ngneTest?.viewport ?? window.se011?.probe ?? null;
        if (found) remembered = found;
        return found;
    };
    let openGate: (() => void) | null = null;

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
            const viewport = probe();
            if (!viewport) throw new Error("se-011: no viewport to record");
            toolkit.captures = [];
            viewport.onFrame = (read) => {
                toolkit.captures.push({
                    serial: viewport.submittedFrames,
                    stamp: Number(document.timeline.currentTime),
                    at: performance.now(),
                    crop: toolkit.crop(read(), rect),
                });
            };
        },
        atFrameStart(action, count) {
            return new Promise((resolve) => {
                requestAnimationFrame((start) => {
                    action();
                    const stamps: number[] = [];
                    const next = (stamp: number) => {
                        stamps.push(stamp);
                        if (stamps.length < count) requestAnimationFrame(next);
                        else resolve({ start, stamps });
                    };
                    requestAnimationFrame(next);
                });
            });
        },

        liveRenderers: () => (probe() ?? remembered)?.liveRenderers ?? -1,
        liveDevices,
        devicesCreated: () => devices.length,
        creatingDevices: () => creating,
        peaks: () => ({ ...peaks }),
        loseDevice() {
            const entry = [...devices].reverse().find((candidate) => candidate.live);
            if (!entry) throw new Error("se-011: no live device to destroy");
            entry.device.destroy();
        },
        refuseDevices(count) {
            refuse = count;
        },
        holdDevices() {
            held ??= new Promise<void>((resolve) => {
                releaseHeld = resolve;
            });
        },
        releaseDevices() {
            releaseHeld?.();
            releaseHeld = null;
            held = null;
        },

        copies: () => copies,
        failCopies(count) {
            failCopies = count;
        },

        canvasLog: [],
        watchCanvases() {
            const host = document.querySelector("[data-viewport-canvas], #host");
            if (!host) throw new Error("se-011: no viewport element to watch");
            toolkit.canvasLog = [];
            new MutationObserver((records) => {
                for (const record of records) {
                    for (const node of record.addedNodes) {
                        if (!(node instanceof HTMLCanvasElement)) continue;
                        toolkit.canvasLog.push({
                            drawn: drawn.has(node),
                            canvases: host.querySelectorAll("canvas").length,
                        });
                    }
                }
            }).observe(host, { childList: true });
        },

        closeUploadGate() {
            const viewport = probe();
            if (!viewport) throw new Error("se-011: no viewport to gate");
            const opened = new Promise<void>((resolve) => {
                openGate = resolve;
            });
            viewport.uploadGate = () => opened;
        },
        openUploadGate() {
            const viewport = probe();
            if (viewport) viewport.uploadGate = null;
            openGate?.();
            openGate = null;
        },

        alive: () => ({
            intervals: intervals.size,
            timeouts: timeouts.size,
            frames: frames.size,
            focusListeners: focusListeners.size,
            visibilityListeners: visibilityListeners.size,
            resizeObservers: observers.size,
        }),
        holdIntervals() {
            if (!options.track) throw new Error("se-011: the toolkit does not track timers");
            holdingIntervals = true;
        },
        fireIntervals() {
            for (const run of [...heldIntervals.values()]) run();
        },
    };
    window.__se011 = toolkit;
}
