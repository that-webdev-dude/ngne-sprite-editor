import type { RendererResourceInspection, RendererStatus } from "@ngne/core";
import { readCanvas } from "./testing/readCanvas";
import { oncePerMessage } from "./viewport/diagnostics";
import { backingSize } from "./viewport/geometry";
import { ReferenceSources } from "./viewport/referenceSources";
import { createStage, RendererInstance } from "./viewport/rendererInstance";
import { isHealthy, swapDecision } from "./viewport/replacement";
import type { SwapDecision } from "./viewport/replacement";
import { replaceSceneDocument } from "./viewport/viewportSlots";
import type { Scene } from "./viewport/viewportSlots";
import type {
    DeviceSize,
    ViewportChecker,
    ViewportDocument,
    ViewportGhost,
    ViewportPort,
    ViewportReference,
    ViewportView,
} from "./viewport/types";

export { frameKey, parseFrameKey } from "./viewport/types";
export type {
    DeviceSize,
    FrameVariant,
    ViewportChecker,
    ViewportDocument,
    ViewportGhost,
    ViewportPort,
    ViewportReference,
    ViewportView,
} from "./viewport/types";

/** A size change replaces the renderer after this long without another one (SPEC §6.4). */
export const RESIZE_QUIET_MS = 120;
/** Interval of the status check while the page is visible (SPEC §6.4). */
export const STATUS_CHECK_MS = 1000;
/** How often a replacement that waits for its device to be recovered looks again. */
const RECOVERY_POLL_MS = 20;

export interface NgneViewportOptions {
    /**
     * An NGNE diagnostic or a failed upload, once per distinct message. The viewport has
     * already written it to the console.
     */
    onError?(message: string, error: unknown): void;
    /** The viewport element's size in device pixels changed. */
    onResize?(size: DeviceSize): void;
    /**
     * A frame was submitted, in the task of its submit: the frame key it drew and the
     * document's `version` of those pixels (SE-015), or null when it drew no frame image.
     */
    onDrawn?(frame: { key: string; version: number | undefined } | null): void;
}

/**
 * What tests read of a viewport and how they script it (SE-011). `app` puts the probe of the
 * mounted viewport on the page's test hook in development builds.
 */
export interface ViewportProbe {
    /** Frames submitted to NGNE by the viewport since it was created. */
    readonly submittedFrames: number;
    /** `texture()` calls made by the viewport since it was created. */
    readonly textureCalls: number;
    /** Renderers alive in the page: created by any viewport and not disposed. */
    readonly liveRenderers: number;
    /** Backing size of the canvas on screen; null before the first renderer. */
    readonly canvasSize: DeviceSize | null;
    /** Status of the renderer on screen; null before the first renderer. */
    readonly status: RendererStatus | null;
    /** True while nothing is under way: no upload, no draw, no renderer replacement. */
    readonly settled: boolean;
    /** The frame key each cache slot of the renderer on screen shows. */
    readonly slots: readonly (string | null)[];
    /**
     * The `ed:play` grid of the renderer on screen (SE-024): its size, its number of cells and
     * the frame keys whose cells are current; null while it shows none.
     */
    readonly playGrid: { width: number; height: number; cells: number; keys: string[] } | null;
    /**
     * The reference slots `ed:ref:0..3` of the renderer on screen (SE-045): the layer each one's
     * texture is of and the texture's size, or null for none or the placeholder.
     */
    readonly references: readonly ({ layerId: string; width: number; height: number } | null)[];
    /** Display sources of references the viewport keeps (SE-045): one per decoded image shown. */
    readonly referenceSources: number;
    /**
     * The onion skins the last frame drawn on the renderer on screen had (SE-025), in draw
     * order: the frame key, the opacity and the NGNE layer of each.
     */
    readonly onion: readonly { key: string; alpha: number; layer: number }[];
    /**
     * Draws the scene again and reads the canvas back in the same task (SPEC §6.7), at
     * backing resolution. The draw is not counted in `submittedFrames`. Null while there is
     * no renderer, or it is not ready.
     */
    readCanvas(): ImageData | null;
    /** `renderer.inspect()` of the renderer on screen. */
    inspect(): RendererResourceInspection | null;
    /**
     * Called in the task of every submitted frame, after it: `read()` returns that frame's
     * image.
     */
    onFrame: ((read: () => ImageData) => void) | null;
    /** While set, the upload of a slot starts when the promise it returns has resolved. */
    uploadGate: ((slot: string) => Promise<void>) | null;
}

/** Creates run one at a time, across every viewport of the page (SPEC §6.2 #12). */
let creating: Promise<unknown> = Promise.resolve();
function serialized<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = creating.then(task, task);
    creating = result.catch(() => undefined);
    return result;
}

/** Renderers created and not disposed, in the whole page. */
let liveRenderers = 0;

/**
 * The editing viewport (SPEC §6.4): one `WebGPURenderer` on its own canvas inside `host`,
 * drawing the workspace colour, the checkerboard, the reference layers, the onion skins and the
 * current frame of a document, on demand; in tiled mode the checkerboard and the frame again
 * around it (SE-062).
 *
 * - The canvas backing size is the host's size in device pixels. A new size replaces the
 *   renderer after `RESIZE_QUIET_MS` of quiet: a new instance is created on a new canvas,
 *   every slot uploaded, one frame drawn, the canvases swapped, the old instance disposed.
 * - Nothing is drawn unless something changed: a dirty flag and one animation frame.
 * - NGNE signals neither a lost device nor its recovery, so the status and the sprite counter
 *   are read on window focus, on `visibilitychange` and once a second while visible.
 */
export class NgneViewport implements ViewportPort {
    readonly probe: ViewportProbe;
    readonly #host: HTMLElement;
    readonly #options: NgneViewportOptions;
    readonly #scene: Scene = {
        document: null,
        epoch: 0,
        current: null,
        view: { scale: 1, originX: 0, originY: 0 },
        checker: { a: 0x3a3a3a, b: 0x4a4a4a, size: 8 },
        background: 0x0f0f10,
    };
    /** What the reference images are uploaded from (SE-045), for every renderer instance. */
    readonly #referenceSources = new ReferenceSources();
    /** The viewport's one `Frame` and one `Camera` (`pixelSnap` off). */
    readonly #stage = createStage();
    readonly #report: (error: unknown) => void;
    readonly #observer: ResizeObserver;
    /** The instance whose canvas is in the host. */
    #live: RendererInstance | null = null;
    /** The instance being prepared to replace it; it follows every scene change too. */
    #next: RendererInstance | null = null;
    /** The host's size in device pixels as last observed. */
    #size: DeviceSize = { width: 0, height: 0 };
    #replacing = false;
    #replaceAgain = false;
    #quiet: ReturnType<typeof setTimeout> | undefined;
    #statusTimer: ReturnType<typeof setInterval> | undefined;
    #dirty = false;
    #frameRequest = 0;
    #submittedFrames = 0;
    #textureCalls = 0;
    #disposed = false;

    constructor(host: HTMLElement, options: NgneViewportOptions = {}) {
        this.#host = host;
        this.#options = options;
        this.#report = oncePerMessage((message, error) => {
            console.error("NGNE viewport:", error);
            options.onError?.(message, error);
        });
        this.probe = this.#createProbe();

        this.#observer = new ResizeObserver((entries) => this.#observed(entries));
        try {
            this.#observer.observe(host, { box: "device-pixel-content-box" });
        } catch {
            // Not supported: the content box times the pixel ratio is used instead.
            this.#observer.observe(host);
        }
        window.addEventListener("focus", this.#checkStatus);
        document.addEventListener("visibilitychange", this.#visibilityChanged);
        this.#watchStatus();
    }

    /** The viewport element's size in device pixels, which is the canvas backing size. */
    get deviceSize(): DeviceSize {
        return { ...this.#size };
    }

    setDocument(document: ViewportDocument | null): void {
        if (document === this.#scene.document) return;
        // The frame key goes with the document: `setCurrent` names the new one's.
        replaceSceneDocument(this.#scene, document);
        // The references went with the document (`replaceSceneDocument`); so do their sources.
        this.#referenceSources.retain(new Set());
        for (const instance of this.#instances()) instance.slots.documentChanged();
        this.#markDirty();
    }

    setCurrent(key: string | null): void {
        if (key === this.#scene.current) return;
        this.#scene.current = key;
        for (const instance of this.#instances()) instance.slots.sync();
        this.#markDirty();
    }

    invalidate(keys: readonly string[] | "all"): void {
        for (const instance of this.#instances()) instance.slots.invalidate(keys);
    }

    setView(view: ViewportView): void {
        const now = this.#scene.view;
        if (
            view.scale === now.scale &&
            view.originX === now.originX &&
            view.originY === now.originY
        ) {
            return;
        }
        this.#scene.view = { scale: view.scale, originX: view.originX, originY: view.originY };
        // A reference is resampled to its new size on screen once the zoom settles (SE-045).
        for (const instance of this.#instances()) instance.slots.references.sync();
        this.#markDirty();
    }

    setReferences(references: readonly ViewportReference[]): void {
        // Before the comparison: a document without references after one with them leaves the
        // list as `setDocument` emptied it, and its display sources go all the same.
        this.#referenceSources.retain(new Set(references.map((reference) => reference.image)));
        const now = this.#scene.references ?? [];
        const same =
            references.length === now.length &&
            references.every((reference, index) => {
                const before = now[index];
                return (
                    before !== undefined &&
                    reference.id === before.id &&
                    reference.image === before.image &&
                    reference.x === before.x &&
                    reference.y === before.y &&
                    reference.scale === before.scale &&
                    reference.opacity === before.opacity &&
                    reference.placement === before.placement
                );
            });
        if (same) return;
        this.#scene.references = references.map((reference) => ({ ...reference }));
        for (const instance of this.#instances()) instance.slots.references.sync();
        this.#markDirty();
    }

    setChecker(checker: ViewportChecker): void {
        const now = this.#scene.checker;
        if (checker.a === now.a && checker.b === now.b && checker.size === now.size) return;
        this.#scene.checker = { a: checker.a, b: checker.b, size: checker.size };
        for (const instance of this.#instances()) instance.slots.sync();
    }

    setBackground(colour: number): void {
        if (colour === this.#scene.background) return;
        this.#scene.background = colour;
        this.#markDirty();
    }

    setOnion(ghosts: readonly ViewportGhost[]): void {
        const now = this.#scene.onion ?? [];
        const same =
            ghosts.length === now.length &&
            ghosts.every((ghost, index) => {
                const before = now[index];
                return (
                    before !== undefined &&
                    ghost.key === before.key &&
                    ghost.alpha === before.alpha &&
                    ghost.placement === before.placement
                );
            });
        if (same) return;
        this.#scene.onion = ghosts.map((ghost) => ({ ...ghost }));
        for (const instance of this.#instances()) instance.slots.sync();
        this.#markDirty();
    }

    setTiled(tiled: "none" | "x" | "y" | "both"): void {
        if (tiled === (this.#scene.tiled ?? "none")) return;
        this.#scene.tiled = tiled;
        this.#markDirty();
    }

    setPlayback(keys: readonly string[] | null): void {
        const now = this.#scene.playing ?? null;
        if (keys === now || (keys && now && keys.join("\n") === now.join("\n"))) return;
        this.#scene.playing = keys ? [...keys] : null;
        for (const instance of this.#instances()) instance.slots.sync();
        this.#markDirty();
    }

    /** Ends the viewport: listeners and timers stopped, every renderer disposed. */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#observer.disconnect();
        window.removeEventListener("focus", this.#checkStatus);
        document.removeEventListener("visibilitychange", this.#visibilityChanged);
        clearTimeout(this.#quiet);
        clearInterval(this.#statusTimer);
        if (this.#frameRequest) cancelAnimationFrame(this.#frameRequest);
        const instances = this.#instances();
        this.#live = null;
        this.#next = null;
        for (const instance of instances) this.#disposeInstance(instance);
    }

    #instances(): RendererInstance[] {
        return [this.#live, this.#next].filter((instance) => instance !== null);
    }

    #disposeInstance(instance: RendererInstance): void {
        if (instance.disposed) return;
        instance.dispose();
        liveRenderers--;
    }

    // --- Size and renderer replacement ---------------------------------------------------

    #observed(entries: readonly ResizeObserverEntry[]): void {
        const entry = entries[entries.length - 1];
        if (!entry || this.#disposed) return;
        const box = entry.devicePixelContentBoxSize?.[0];
        const size = box
            ? backingSize(box.inlineSize, box.blockSize)
            : backingSize(
                  entry.contentRect.width * devicePixelRatio,
                  entry.contentRect.height * devicePixelRatio,
              );
        if (size.width === this.#size.width && size.height === this.#size.height) return;
        this.#size = size;
        this.#options.onResize?.({ ...size });
        clearTimeout(this.#quiet);
        this.#quiet = undefined;
        if (!this.#live && !this.#replacing) {
            // Nothing on screen yet: the first renderer is created at once.
            void this.#replace();
            return;
        }
        this.#quiet = setTimeout(() => {
            this.#quiet = undefined;
            void this.#replace();
        }, RESIZE_QUIET_MS);
    }

    /**
     * True when the instance on screen fits the host, its renderer still works and none of
     * its slots has failed for good.
     */
    #fits(instance: RendererInstance | null): boolean {
        return (
            instance !== null &&
            instance.width === this.#size.width &&
            instance.height === this.#size.height &&
            instance.status !== "failed" &&
            instance.status !== "disposed" &&
            !instance.stuck
        );
    }

    /**
     * An instance cannot show the scene in full any more: an upload failed for good on it
     * (SPEC §6.4: retried only on a fresh renderer). The one on screen is replaced; it asks
     * once, and when the replacement cannot be made the status check tries again. One that
     * is still being loaded is judged when it is loaded (`swapDecision`).
     */
    #stuck(instance: RendererInstance): void {
        if (instance === this.#live) void this.#replace();
    }

    /**
     * Brings the renderer in line with the host's size: one replacement at a time, and again
     * when the size changed or the renderer failed while one was under way. An attempt that
     * ends without a new renderer on screen is not repeated here: the status check does that,
     * once a second at most.
     */
    async #replace(): Promise<void> {
        if (this.#replacing) {
            this.#replaceAgain = true;
            return;
        }
        this.#replacing = true;
        try {
            do {
                this.#replaceAgain = false;
                const size = this.#size;
                // A host that is not laid out (the shell is hidden) keeps what it has.
                if (this.#disposed || size.width === 0 || size.height === 0) break;
                if (this.#fits(this.#live)) break;
                if (!(await this.#replaceOnce(size))) break;
            } while (this.#replaceAgain && !this.#disposed);
        } catch (error) {
            // The instance that was being prepared is given up; the one on screen stays.
            const abandoned = this.#next;
            this.#next = null;
            if (abandoned) this.#disposeInstance(abandoned);
            this.#report(error);
        } finally {
            this.#replacing = false;
        }
    }

    /**
     * SPEC §6.4 replacement order: create on a new canvas, upload every slot, draw once, swap
     * the canvases, dispose the old instance. Returns false when no new renderer got on
     * screen: none could be made, or the one made could not draw. The canvases are swapped
     * only after NGNE has submitted a frame on the new one.
     */
    async #replaceOnce(size: DeviceSize): Promise<boolean> {
        let next: RendererInstance | null;
        try {
            next = await serialized(async () => {
                if (this.#disposed) return null;
                const instance = await RendererInstance.create(size, this.#scene, this.#stage, {
                    onTexture: () => {
                        this.#textureCalls++;
                    },
                    onChange: () => this.#markDirty(),
                    onError: (error) => this.#diagnostic(error),
                    onStuck: (stuck) => this.#stuck(stuck),
                    gate: (slot) => this.probe.uploadGate?.(slot),
                    referenceBitmap: (image, width, height) =>
                        this.#referenceSources.bitmap(image, width, height),
                });
                liveRenderers++;
                return instance;
            });
        } catch (error) {
            this.#report(error);
            return false;
        }
        if (!next) return false;
        if (this.#disposed) {
            this.#disposeInstance(next);
            return false;
        }

        // From here on the new instance follows every scene change, as the one on screen
        // does, and uploads what the old one had cached.
        this.#next = next;
        next.slots.seed(this.#live?.slots.frames.keysByAge() ?? []);
        next.slots.sync();
        const decision = await this.#loaded(next);
        // `dispose` has ended the new instance with the viewport.
        if (this.#disposed) return false;
        this.#next = null;
        if (decision === "abandon") {
            this.#disposeInstance(next);
            return false;
        }

        // One task: the new canvas has drawn before it enters the document, and the old one
        // leaves in the same step, so the viewport is never blank.
        const old = this.#live;
        if (!this.#submit(next)) {
            // NGNE submitted nothing and has reported why: a canvas that has not drawn does
            // not go on screen. The scene is still to be drawn on the old one.
            this.#disposeInstance(next);
            this.#dirty = true;
            if (isHealthy(old)) this.#schedule();
            return false;
        }
        if (old && old.canvas.parentNode === this.#host) {
            this.#host.replaceChild(next.canvas, old.canvas);
        } else {
            this.#host.append(next.canvas);
        }
        this.#live = next;
        if (old) this.#disposeInstance(old);
        return true;
    }

    /**
     * Waits until a new instance is loaded — no upload in flight or waiting, and no device
     * being recovered — and says what to do with it. A device lost while it loads is
     * recovered by NGNE, slots included; until then the instance cannot draw, and the one on
     * screen stays.
     */
    async #loaded(next: RendererInstance): Promise<SwapDecision> {
        for (;;) {
            await next.slots.settle();
            if (this.#disposed || next.disposed) return "abandon";
            const decision = swapDecision(next, this.#live);
            if (decision !== "wait") return decision;
            await new Promise((resolve) => setTimeout(resolve, RECOVERY_POLL_MS));
        }
    }

    // --- Drawing on demand ---------------------------------------------------------------

    #markDirty(): void {
        this.#dirty = true;
        this.#schedule();
    }

    #schedule(): void {
        if (this.#frameRequest || this.#disposed) return;
        this.#frameRequest = requestAnimationFrame(this.#tick);
    }

    readonly #tick = (): void => {
        this.#frameRequest = 0;
        const live = this.#live;
        // Before the first renderer the swap draws; the flag is kept for it.
        if (!this.#dirty || this.#disposed || !live) return;
        const status = live.status;
        live.lastStatus = status;
        if (status === "recovering") {
            // `render()` would be a silent no-op: the flag stays and the draw is tried again
            // next animation frame (SPEC §6.2 #13).
            this.#schedule();
            return;
        }
        if (status !== "ready") {
            // Failed: a fresh renderer, whose swap draws the scene.
            void this.#replace();
            return;
        }
        this.#submit(live);
    };

    /** Draws the scene on `instance`. Returns false when NGNE submitted nothing. */
    #submit(instance: RendererInstance): boolean {
        this.#dirty = false;
        if (!instance.draw()) return false;
        this.#submittedFrames++;
        const drawn = instance.slots.drawnFrame();
        try {
            this.#options.onDrawn?.(drawn && { key: drawn.key, version: drawn.version });
        } catch (error) {
            this.#report(error);
        }
        this.probe.onFrame?.(() => readCanvas(instance.canvas));
        return true;
    }

    // --- Status --------------------------------------------------------------------------

    /**
     * Reading the status submits no frame. A way back to `ready`, or a sprite counter that
     * fell to 0 after a draw with sprites (NGNE zeroes it when the device is lost; recovery
     * usually completes between two reads), marks the view dirty. `failed` asks for a fresh
     * renderer.
     */
    readonly #checkStatus = (): void => {
        if (this.#disposed) return;
        const live = this.#live;
        if (!live) {
            // No renderer could be made earlier: try again.
            if (!this.#replacing) void this.#replace();
            return;
        }
        const status = live.status;
        const before = live.lastStatus;
        live.lastStatus = status;
        if (status === "failed") {
            void this.#replace();
            return;
        }
        // A replacement for a new size that could not be made is tried again.
        if (!this.#replacing && this.#quiet === undefined && !this.#fits(live)) {
            void this.#replace();
        }
        if (status !== "ready") return;
        if (before !== "ready" || (live.drewSprites > 0 && live.renderer.sprites === 0)) {
            this.#markDirty();
        }
    };

    readonly #visibilityChanged = (): void => {
        this.#watchStatus();
        this.#checkStatus();
    };

    /** Runs the status timer while the page is visible. */
    #watchStatus(): void {
        const visible = document.visibilityState === "visible";
        if (visible && this.#statusTimer === undefined) {
            this.#statusTimer = setInterval(this.#checkStatus, STATUS_CHECK_MS);
        } else if (!visible && this.#statusTimer !== undefined) {
            clearInterval(this.#statusTimer);
            this.#statusTimer = undefined;
        }
    }

    /** An NGNE diagnostic: shown once per message; `failed` arrives this way too. */
    #diagnostic(error: unknown): void {
        this.#report(error);
        // Not inside NGNE's own call: the status is read once it has returned.
        queueMicrotask(this.#checkStatus);
    }

    // --- Test hooks ----------------------------------------------------------------------

    #createProbe(): ViewportProbe {
        const read = <Value>(get: () => Value) => ({ get, enumerable: true });
        return Object.defineProperties(
            {
                onFrame: null,
                uploadGate: null,
                readCanvas: () => {
                    const live = this.#live;
                    if (!live || live.status !== "ready") return null;
                    live.draw();
                    return readCanvas(live.canvas);
                },
                inspect: () => this.#live?.inspect() ?? null,
            } as ViewportProbe,
            {
                submittedFrames: read(() => this.#submittedFrames),
                textureCalls: read(() => this.#textureCalls),
                liveRenderers: read(() => liveRenderers),
                canvasSize: read(() =>
                    this.#live ? { width: this.#live.width, height: this.#live.height } : null,
                ),
                status: read(() => this.#live?.status ?? null),
                settled: read(
                    () =>
                        this.#live !== null &&
                        !this.#dirty &&
                        !this.#replacing &&
                        this.#quiet === undefined &&
                        !this.#live.slots.queue.busy() &&
                        !this.#live.slots.references.waiting,
                ),
                slots: read(() => this.#live?.slots.shownKeys() ?? []),
                references: read(() => this.#live?.slots.references.shown() ?? []),
                referenceSources: read(() => this.#referenceSources.size),
                onion: read(() =>
                    (this.#live?.slots.drawnGhosts() ?? []).map((ghost) => ({ ...ghost })),
                ),
                playGrid: read(() => {
                    const grid = this.#live?.slots.playGrid();
                    if (!grid) return null;
                    const { width, height, count } = grid.layout;
                    return { width, height, cells: count, keys: grid.keys };
                }),
            },
        );
    }
}
