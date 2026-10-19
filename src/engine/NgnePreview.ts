import { BrowserGame } from "@ngne/core";
import type { Frame, FrameScheduler, SceneDefinition } from "@ngne/core";
import { animationFrame, spriteAtTopLeft } from "../core/export/sprite-runtime";
import type { SpriteAtlas } from "../core/export/sprite-runtime";
import type { PixelBuffer } from "../core/model";
import { bitmapFromPixels } from "./bitmaps";
import { DemandScheduler, frameDelay, TICK_MS } from "./preview/demandScheduler";
import { readCanvas } from "./testing/readCanvas";
import { UploadQueue } from "./UploadQueue";
import { oncePerMessage } from "./viewport/diagnostics";

// The preview panel's engine side (SPEC §6.5): a `BrowserGame` on its own canvas that plays
// the atlas the exporter makes, in memory. The app hands it the packed atlas, the animation
// to play and whether it should run; this module owns the game's lifecycle and the upload.
//
//   app: atlas (pixels + metadata) → UploadQueue("pv:atlas") → published tag → render reads it
//
// - Lifecycle calls (create, start, stop, dispose) run one at a time for the whole page, in
//   one serialized chain. A game is rebuilt on a new canvas when the document's size changes
//   or when it failed.
// - The atlas is uploaded by the host after `start()` resolved (the game's renderer exists
//   only then), through the upload queue of SE-011. Its metadata travels in the upload's tag,
//   so what is drawn always pairs metadata with the texture it describes. Nothing is drawn
//   from the atlas before the first upload of the game resolved.
// - The queue of a game is disposed before the game.
// - Frames run on demand (`preview/demandScheduler.ts`): after a change and when the playing
//   animation reaches its next entry; not at the display's rate. A still preview draws nothing,
//   and a device that was lost and recovered (status read once a second) draws again.

/** What runs the game's frames: NGNE's `FrameScheduler` (`requestAnimationFrame` by default). */
export type PreviewScheduler = FrameScheduler;

/** The texture slot of the atlas (SPEC §6.5). */
export const PREVIEW_ATLAS_SLOT = "pv:atlas";

/** After a failure that follows another, the next game is made after this long. */
const RETRY_MS = 1000;

/**
 * Ticks one frame may run (NGNE's `maxTicks`, 5 by default): while playing, frames come at the
 * entries, and an entry may last 65 535 ms at a quarter of the speed. A tick only advances the
 * age.
 */
const MAX_TICKS = Math.ceil((4 * 65_535) / TICK_MS) + 1;

/** Interval of the renderer's status read while a game runs (as the viewport's, SPEC §6.4). */
const STATUS_CHECK_MS = 1000;

/** An atlas for the preview: the packed image and the sheet that describes it. */
export interface PreviewAtlas {
    /** The atlas image, straight-alpha RGBA8. It is not written to once handed over. */
    readonly pixels: PixelBuffer;
    /** Its frames and the animations the preview can play, by key. */
    readonly sheet: SpriteAtlas;
}

/** What the app sets on a preview (SE-054). `NgnePreview` implements it. */
export interface PreviewPort {
    /** The document's size, which is the game's logical size; null while none is open. */
    setSize(size: { width: number; height: number } | null): void;
    /** The canvas size on the page, in CSS pixels. */
    setDisplaySize(size: { width: number; height: number }): void;
    /** Whether the game should run: the panel shows it, the tab is visible, a document is open. */
    setRunning(running: boolean): void;
    /** The atlas to draw from; null draws none (only the background). */
    setAtlas(atlas: PreviewAtlas | null): void;
    /** The key of the sheet's animation to play; the age starts at 0 again. */
    setAnimation(key: string): void;
    setPlaying(playing: boolean): void;
    /** Game milliseconds per real millisecond. */
    setSpeed(speed: number): void;
    /** The background, 0xRRGGBB, drawn as a rect under the frame. */
    setBackground(colour: number): void;
}

export interface NgnePreviewOptions {
    /**
     * An NGNE diagnostic other than a dropped-tick notice, or a failed upload, create or
     * start: once per distinct message.
     */
    onDiagnostic?(message: string, error: unknown): void;
    /** The scheduler of the next game created; NGNE's own (`requestAnimationFrame`) when none. */
    scheduler?(): PreviewScheduler | undefined;
}

/** What a frame of the preview showed. */
export interface PreviewDrawn {
    /** The ID of the atlas frame drawn. */
    frame: string;
    /** The age of the animation it was resolved at, in game milliseconds. */
    ageMs: number;
    /** `PreviewProbe.serial` of the atlas it was drawn from. */
    serial: number;
}

/** What tests read of the preview and how they script it (SE-054). */
export interface PreviewProbe {
    /** Games alive in the page: created and not disposed. */
    readonly liveGames: number;
    /** Frames rendered by every game of the page (`afterFrame` calls). */
    readonly frames: number;
    /** Every diagnostic reported by a preview of the page, in order (not dropped ticks). */
    readonly diagnostics: readonly string[];
    /** The lifecycle of this preview's game; null while it has none. */
    readonly lifecycle: string | null;
    /** The backing size of this preview's canvas; null while it has none. */
    readonly canvasSize: { width: number; height: number } | null;
    /** True while nothing is under way: no lifecycle call, no upload, the newest atlas shown. */
    readonly settled: boolean;
    /** Serial of the newest atlas set (counted from 1); 0 before any. */
    readonly serial: number;
    /** Serial of the atlas whose upload resolved last on the current game; null before one. */
    readonly published: number | null;
    /** The atlas size of the published upload; null before one. */
    readonly publishedSize: { width: number; height: number } | null;
    /** The age of the playing animation, in game milliseconds. */
    readonly ageMs: number;
    /** Sets the age, as a pause on a chosen moment. */
    seek(ageMs: number): void;
    /**
     * Called after every frame of this preview's game, in its task: `read()` returns that
     * frame's image at backing resolution, `drawn` what it showed of the atlas.
     */
    onFrame: ((read: () => ImageData, drawn: PreviewDrawn | null) => void) | null;
    /** While set, an upload starts when the promise it returns has resolved. */
    uploadGate: ((slot: string) => Promise<void>) | null;
    /** While true, frames run at every animation frame instead of on demand. */
    continuous: boolean;
    /** Asks for a frame at the next animation frame. */
    wake(): void;
}

/** Lifecycle calls run one at a time for every preview of the page (SPEC §6.2 #12, §6.5). */
let lifecycle: Promise<unknown> = Promise.resolve();
function serialized<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = lifecycle.then(task, task);
    lifecycle = result.catch(() => undefined);
    return result;
}

/** Page-wide counters, for the probe. */
const page = { liveGames: 0, frames: 0, diagnostics: [] as string[] };

/** The tag of an atlas upload: the atlas and the serial it was set with. */
interface AtlasTag {
    atlas: PreviewAtlas;
    serial: number;
}

type Game = BrowserGame<Record<string, never>, never>;

/** One `BrowserGame` on its own canvas. */
interface Instance {
    readonly game: Game;
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    /** Created after the first `start()` resolved; disposed before the game. */
    queue: UploadQueue<AtlasTag> | null;
    /** `start()` resolved and no `stop()` since. */
    running: boolean;
    /** `start()` has resolved once: later starts resume the scene. */
    started: boolean;
    /** The game or its renderer failed, or an upload failed for good: rebuild it. */
    failed: boolean;
    /** What the last frame drew. */
    drawn: PreviewDrawn | null;
    /** Runs the game's frames on demand; null under a scheduler the options gave. */
    demand: DemandScheduler | null;
    /** Sprites the last frame submitted, and the renderer's status at the last read. */
    drewSprites: number;
    lastStatus: string | null;
}

/** NGNE reports dropped ticks through the diagnostic callback; they are not errors. */
function isOverloadNotice(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as { type?: unknown }).type === "overload"
    );
}

/**
 * The preview panel's `BrowserGame` (SPEC §6.5), inside `host`. Logical size = document size;
 * `pixelSnap` off; the frame is placed by the sprite runtime's top-left placement with the
 * source frame's corner at the canvas origin; the background is a rect.
 */
export class NgnePreview implements PreviewPort {
    readonly probe: PreviewProbe;
    readonly #host: HTMLElement;
    readonly #options: NgnePreviewOptions;
    readonly #report: (error: unknown) => void;
    #instance: Instance | null = null;
    // Wanted state.
    #size: { width: number; height: number } | null = null;
    #display = { width: 0, height: 0 };
    #running = false;
    #disposed = false;
    #atlas: PreviewAtlas | null = null;
    /** Serial of the newest atlas set. */
    #serial = 0;
    /** The lowest serial that may be drawn: a null atlas hides every one set before it. */
    #floor = 1;
    #animation = "";
    #playing = true;
    #speed = 1;
    #background = 0x202020;
    #ageMs = 0;
    /** Test hook: frames at every animation frame. */
    #continuous = false;
    // Lifecycle work.
    #working = false;
    #again = false;
    #retryTimer: ReturnType<typeof setTimeout> | undefined;
    #retryAt = 0;
    /** Failures since a game last drew from its atlas. */
    #failures = 0;
    #disposal: Promise<void> | null = null;
    #resolveDisposal: (() => void) | null = null;
    readonly #statusTimer: ReturnType<typeof setInterval>;

    constructor(host: HTMLElement, options: NgnePreviewOptions = {}) {
        this.#host = host;
        this.#options = options;
        this.#report = oncePerMessage((message, error) => {
            console.error("NGNE preview:", error);
            page.diagnostics.push(message);
            options.onDiagnostic?.(message, error);
        });
        this.probe = this.#createProbe();
        this.#statusTimer = setInterval(() => this.#checkStatus(), STATUS_CHECK_MS);
    }

    setSize(size: { width: number; height: number } | null): void {
        const now = this.#size;
        if (size?.width === now?.width && size?.height === now?.height) return;
        this.#size = size ? { width: size.width, height: size.height } : null;
        this.#kick();
    }

    setDisplaySize(size: { width: number; height: number }): void {
        this.#display = { width: size.width, height: size.height };
        if (this.#instance) this.#style(this.#instance.canvas);
    }

    setRunning(running: boolean): void {
        if (running === this.#running) return;
        this.#running = running;
        this.#kick();
    }

    setAtlas(atlas: PreviewAtlas | null): void {
        if (atlas === this.#atlas) return;
        this.#atlas = atlas;
        if (!atlas) {
            this.#floor = this.#serial + 1;
            this.#wake();
            return;
        }
        this.#serial++;
        this.#upload(this.#instance);
    }

    setAnimation(key: string): void {
        if (key === this.#animation) return;
        this.#catchUp();
        this.#animation = key;
        this.#ageMs = 0;
        this.#wake();
    }

    setPlaying(playing: boolean): void {
        if (playing === this.#playing) return;
        this.#catchUp();
        this.#playing = playing;
        this.#wake();
    }

    setSpeed(speed: number): void {
        if (speed === this.#speed) return;
        this.#catchUp();
        this.#speed = speed;
        this.#wake();
    }

    /**
     * Before a change of the rate: the age the animation has now, at the rate until now. The
     * game ticks the time between two frames at its next frame, which on demand can be long
     * after the change; that time is counted here instead, and the game's clock skips it.
     */
    #catchUp(): void {
        const instance = this.#instance;
        const demand = instance?.demand;
        if (!demand) return;
        const now = performance.now();
        const last = demand.lastFrameAt;
        if (last !== null && instance.running && this.#playing) {
            this.#ageMs += Math.max(now - last, 0) * this.#speed;
        }
        demand.skip(now);
    }

    /**
     * NGNE signals neither a lost device nor its recovery: as the viewport does, the status
     * and the sprite counter are read (no frame is drawn for it), and a renderer back to
     * `ready`, or one whose sprites were zeroed after a frame that had some, draws again.
     */
    #checkStatus(): void {
        const instance = this.#instance;
        const renderer = instance?.game.renderer;
        if (!instance?.running || !renderer) return;
        const status = renderer.status;
        const before = instance.lastStatus;
        instance.lastStatus = status;
        if (status !== "ready") return;
        if (before !== "ready" || (instance.drewSprites > 0 && renderer.sprites === 0)) {
            instance.demand?.wake();
        }
    }

    setBackground(colour: number): void {
        if (colour === this.#background) return;
        this.#background = colour;
        this.#wake();
    }

    /** Something drawn changed: a frame at the next animation frame. */
    #wake(): void {
        this.#instance?.demand?.wake();
    }

    /**
     * Milliseconds until the next frame can differ from the last: when the playing animation
     * shows its next entry; Infinity while paused or with nothing to show.
     */
    #due(): number {
        if (this.#continuous) return 0;
        const tag = this.#instance?.queue?.published(PREVIEW_ATLAS_SLOT);
        if (!this.#playing || !this.#atlas || !tag || tag.serial < this.#floor) return Infinity;
        const animation = tag.atlas.sheet.animations[this.#animation];
        if (!animation) return Infinity;
        return frameDelay(animation, this.#ageMs, this.#speed);
    }

    /** Ends the preview: its game is stopped and disposed in the serialized chain. */
    dispose(): Promise<void> {
        if (!this.#disposal) {
            this.#disposed = true;
            clearTimeout(this.#retryTimer);
            clearInterval(this.#statusTimer);
            this.#disposal = new Promise((resolve) => {
                this.#resolveDisposal = resolve;
            });
            this.#kick();
        }
        return this.#disposal;
    }

    // --- Lifecycle -------------------------------------------------------------------------

    /** Brings the game in line with the wanted state, one lifecycle call at a time. */
    #kick(): void {
        if (this.#working) {
            this.#again = true;
            return;
        }
        this.#working = true;
        void serialized(async () => {
            do {
                this.#again = false;
                for (let step = this.#nextStep(); step; step = this.#nextStep()) {
                    try {
                        await step();
                    } catch (error) {
                        this.#report(error);
                        await this.#failed();
                    }
                }
            } while (this.#again);
        }).finally(() => {
            this.#working = false;
            if (this.#again) this.#kick();
            else if (this.#disposed && !this.#instance) this.#resolveDisposal?.();
        });
    }

    /** The next lifecycle call the wanted state needs, or null when there is none. */
    #nextStep(): (() => Promise<void>) | null {
        const instance = this.#instance;
        const size = this.#size;
        if (this.#disposed) return instance ? () => this.#end(instance) : null;
        if (instance) {
            if (instance.failed) return () => this.#rebuild(instance);
            // No document: no game, as the viewport has no renderer then (SPEC §6.4). A new
            // size needs a new game: the logical size is fixed at creation.
            if (!size || size.width !== instance.width || size.height !== instance.height) {
                return () => this.#end(instance);
            }
            if (!this.#running) return instance.running ? () => this.#stop(instance) : null;
            return instance.running ? null : () => this.#start(instance);
        }
        if (!size || !this.#running) return null;
        // A game that keeps failing is made again after a pause, not in a loop.
        if (performance.now() < this.#retryAt) return null;
        return () => this.#create(size);
    }

    /** A step threw: the game it was made for is given up, and a new one is made. */
    async #failed(): Promise<void> {
        const instance = this.#instance;
        if (instance) await this.#rebuild(instance).catch(() => undefined);
        else this.#delayNext();
    }

    /** Disposes a failed game; the next one is made at once, or after a pause when it fails too. */
    async #rebuild(instance: Instance): Promise<void> {
        try {
            await this.#end(instance);
        } finally {
            this.#delayNext();
        }
    }

    #delayNext(): void {
        if (this.#failures++ === 0 || this.#disposed) return;
        this.#retryAt = performance.now() + RETRY_MS;
        clearTimeout(this.#retryTimer);
        this.#retryTimer = setTimeout(() => this.#kick(), RETRY_MS);
    }

    async #create(size: { width: number; height: number }): Promise<void> {
        const canvas = document.createElement("canvas");
        canvas.className = "ngne-preview__canvas";
        this.#style(canvas);
        // Frames on demand, unless the options give a scheduler (a test's).
        const given = this.#options.scheduler?.();
        const demand = given ? null : new DemandScheduler(() => this.#due());
        const scheduler = given ?? demand!;
        let instance: Instance | null = null;
        const game: Game = new BrowserGame<Record<string, never>, never>({
            canvas,
            width: size.width,
            height: size.height,
            clear: this.#background,
            seed: "ngne-sprite-editor-preview",
            state: {},
            transition: (state) => state,
            scheduler,
            ...(demand ? { maxTicks: MAX_TICKS } : {}),
            diagnostic: (error) => {
                if (isOverloadNotice(error)) return;
                this.#report(error);
                // Not inside NGNE's own call: the lifecycle is read once it has returned.
                queueMicrotask(() => {
                    if (instance) this.#check(instance);
                });
            },
            afterFrame: (stats) => {
                page.frames++;
                if (!instance || instance !== this.#instance) return;
                instance.drewSprites = stats.sprites;
                const { onFrame } = this.probe;
                if (!onFrame) return;
                try {
                    onFrame(() => readCanvas(canvas), instance.drawn);
                } catch (error) {
                    console.error("NGNE preview: probe.onFrame threw.", error);
                }
            },
        });
        instance = {
            game,
            canvas,
            width: size.width,
            height: size.height,
            queue: null,
            running: false,
            started: false,
            failed: false,
            drawn: null,
            demand,
            drewSprites: 0,
            lastStatus: null,
        };
        page.liveGames++;
        this.#instance = instance;
        this.#host.append(canvas);
    }

    async #start(instance: Instance): Promise<void> {
        if (!instance.started) {
            const prepared = await instance.game.game.prepare(this.#scene(instance), {
                key: "preview",
            });
            await instance.game.start(prepared);
            instance.started = true;
        } else {
            await instance.game.start();
        }
        instance.running = true;
        if (!instance.queue) {
            // The renderer exists once `start()` has resolved (SPEC §6.2 #14).
            const renderer = instance.game.renderer;
            if (!renderer) throw new Error("The preview's renderer is missing after start().");
            instance.queue = new UploadQueue<AtlasTag>({
                target: renderer,
                // The new atlas is drawn at the next animation frame.
                onPublish: () => instance.demand?.wake(),
                onError: (_slot, error) => {
                    this.#report(error);
                    // A rejected `texture()` is retried only on a fresh renderer (SPEC §6.4).
                    if (instance.queue?.failed(PREVIEW_ATLAS_SLOT)) {
                        instance.failed = true;
                        this.#kick();
                    }
                },
            });
            this.#upload(instance);
        }
    }

    async #stop(instance: Instance): Promise<void> {
        instance.running = false;
        await instance.game.stop();
    }

    /** Disposes a game: its upload queue first, then the game; its canvas leaves the page. */
    async #end(instance: Instance): Promise<void> {
        if (this.#instance === instance) this.#instance = null;
        instance.running = false;
        instance.queue?.dispose();
        try {
            await instance.game.dispose();
        } finally {
            instance.canvas.remove();
            page.liveGames--;
        }
    }

    /** A game whose lifecycle or renderer failed is rebuilt (SPEC §6.5). */
    #check(instance: Instance): void {
        if (instance !== this.#instance || instance.failed) return;
        const failed =
            instance.game.game.lifecycle === "Failed" ||
            instance.game.renderer?.status === "failed";
        if (!failed) return;
        instance.failed = true;
        this.#kick();
    }

    /** Asks for the newest atlas on `instance`, once its queue exists. */
    #upload(instance: Instance | null): void {
        const atlas = this.#atlas;
        const queue = instance?.queue;
        if (!atlas || !queue) return;
        const tag: AtlasTag = { atlas, serial: this.#serial };
        queue.request(PREVIEW_ATLAS_SLOT, async () => {
            await this.probe.uploadGate?.(PREVIEW_ATLAS_SLOT);
            return { bitmap: await bitmapFromPixels(atlas.pixels), tag };
        });
    }

    #style(canvas: HTMLCanvasElement): void {
        canvas.style.width = `${this.#display.width}px`;
        canvas.style.height = `${this.#display.height}px`;
    }

    // --- The scene -------------------------------------------------------------------------

    #scene(instance: Instance): SceneDefinition<Record<string, never>, never> {
        return {
            id: "ngne-sprite-editor-preview",
            setup: (setup) => {
                // Top-left placement at the canvas origin, for odd and even sizes (SPEC §6.5).
                setup.camera.pixelSnap = false;
                setup.system(({ dt }) => {
                    if (this.#playing) this.#ageMs += dt * 1000 * this.#speed;
                });
                setup.render((frame) => this.#draw(frame, instance));
            },
        };
    }

    /** The render callback. It never throws: a throw would fail the game (SPEC §6.2 #14). */
    #draw(frame: Frame, instance: Instance): void {
        instance.drawn = null;
        try {
            const { width, height } = instance;
            frame.rect(width / 2, height / 2, width, height, this.#background, 1, 0);
            // Nothing from the atlas before its first upload on this game resolved.
            const tag = instance.queue?.published(PREVIEW_ATLAS_SLOT);
            if (!this.#atlas || !tag || tag.serial < this.#floor) return;
            const { sheet } = tag.atlas;
            const key = this.#animation;
            if (!Object.hasOwn(sheet.animations, key)) return;
            const ageMs = this.#ageMs;
            const id = animationFrame(sheet, key, ageMs);
            spriteAtTopLeft(frame, sheet, PREVIEW_ATLAS_SLOT, id, 0, 0, { layer: 1 });
            instance.drawn = { frame: id, ageMs, serial: tag.serial };
            this.#failures = 0;
        } catch (error) {
            this.#report(error);
        }
    }

    // --- Test hooks ------------------------------------------------------------------------

    #createProbe(): PreviewProbe {
        const read = <Value>(get: () => Value) => ({ get, enumerable: true });
        return Object.defineProperties(
            {
                onFrame: null,
                uploadGate: null,
                seek: (ageMs: number) => {
                    this.#catchUp();
                    this.#ageMs = ageMs;
                    this.#wake();
                },
                wake: () => this.#wake(),
            } as unknown as PreviewProbe,
            {
                liveGames: read(() => page.liveGames),
                frames: read(() => page.frames),
                diagnostics: read(() => [...page.diagnostics]),
                lifecycle: read(() => this.#instance?.game.game.lifecycle ?? null),
                canvasSize: read(() =>
                    this.#instance
                        ? {
                              width: this.#instance.canvas.width,
                              height: this.#instance.canvas.height,
                          }
                        : null,
                ),
                settled: read(() => {
                    const instance = this.#instance;
                    if (this.#working) return false;
                    if (!instance) return !this.#size || !this.#running;
                    if (instance.running !== this.#running) return false;
                    if (instance.queue?.busy()) return false;
                    return !this.#atlas || this.#published(instance) === this.#serial;
                }),
                serial: read(() => this.#serial),
                published: read(() => (this.#instance ? this.#published(this.#instance) : null)),
                publishedSize: read(() => {
                    const tag = this.#instance?.queue?.published(PREVIEW_ATLAS_SLOT);
                    return tag
                        ? { width: tag.atlas.sheet.width, height: tag.atlas.sheet.height }
                        : null;
                }),
                ageMs: read(() => this.#ageMs),
                continuous: {
                    get: () => this.#continuous,
                    set: (continuous: boolean) => {
                        this.#continuous = continuous;
                        this.#wake();
                    },
                    enumerable: true,
                },
            },
        );
    }

    #published(instance: Instance): number | null {
        return instance.queue?.published(PREVIEW_ATLAS_SLOT)?.serial ?? null;
    }
}
