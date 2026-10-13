import { Camera, Frame, WebGPURenderer } from "@ngne/core";
import type { RendererResourceInspection, RendererStatus } from "@ngne/core";
import type { PixelBuffer } from "../../core/model";
import { bitmapFromPixels, placeholderBitmap } from "../bitmaps";
import { UploadQueue } from "../UploadQueue";
import type { Upload } from "../UploadQueue";
import { checkerPixels, checkerSpec } from "./checker";
import { FrameSlots } from "./frameSlots";
import { imageQuad, QUAD_LAYER } from "./geometry";
import type { Quad } from "./geometry";
import type { DeviceSize, ViewportChecker, ViewportDocument, ViewportView } from "./types";

// One renderer of the viewport with everything that lives and dies with it (SPEC §6.4): its
// own canvas element, its upload queue and the state of its texture slots. The viewport
// replaces the whole instance when the size changes or the renderer fails.

/** The checkerboard slot. Slot IDs are fixed for the life of a renderer. */
export const CHECKER_SLOT = "ed:checker";
/** Number of frame cache slots, `ed:f:0` to `ed:f:7`. */
export const FRAME_SLOT_COUNT = 8;

/** The texture ID of a frame cache slot. */
export function frameSlotId(index: number): string {
    return `ed:f:${index}`;
}

function frameSlotIndex(slot: string): number {
    const match = /^ed:f:(\d+)$/.exec(slot);
    return match ? Number(match[1]) : -1;
}

/** What the viewport shows. One object, shared by the viewport and its renderer instances. */
export interface Scene {
    document: ViewportDocument | null;
    /** Raised when `document` is replaced: an image of an earlier document is never drawn. */
    epoch: number;
    /** The frame key to draw. */
    current: string | null;
    view: ViewportView;
    checker: ViewportChecker;
    /** Workspace colour, 0xRRGGBB. */
    background: number;
}

/**
 * The one `Frame` and the one `Camera` of a viewport. Every renderer instance builds its
 * draws in them; draws are synchronous, so two instances never use them at once.
 */
export interface Stage {
    readonly frame: Frame;
    readonly camera: Camera;
}

export function createStage(): Stage {
    const camera = new Camera();
    // Quads are placed from an integer top-left; snapping would round their centres
    // (SPEC §6.2 #7).
    camera.pixelSnap = false;
    return { frame: new Frame(), camera };
}

/** What an upload put into a slot. */
interface SlotTag {
    epoch: number;
    /** A frame key, the spec of a checker image, or null for the 1×1 placeholder. */
    key: string | null;
    /** Size of the image, in document pixels. */
    width: number;
    height: number;
}

/** What an instance tells its viewport. */
export interface InstanceHooks {
    /** A `texture()` call is about to be made. */
    onTexture(slot: string): void;
    /** A slot changed what it shows: the scene has to be drawn again. */
    onChange(): void;
    /** An NGNE diagnostic or a failed upload. */
    onError(error: unknown): void;
    /** Test hook: when it returns a promise, the upload of `slot` starts after it. */
    gate(slot: string): Promise<void> | undefined;
}

/** A renderer on its own canvas, with its upload queue and slot state. */
export class RendererInstance {
    readonly canvas: HTMLCanvasElement;
    readonly renderer: WebGPURenderer;
    readonly queue: UploadQueue<SlotTag>;
    readonly slots = new FrameSlots(FRAME_SLOT_COUNT);
    /** `renderer.sprites` after the last draw; NGNE zeroes the counter on device loss. */
    drewSprites = 0;
    /** The status seen at the last read, to notice the way back to `ready`. */
    lastStatus: RendererStatus = "ready";
    readonly #scene: Scene;
    readonly #stage: Stage;
    readonly #hooks: InstanceHooks;
    /** Spec of the checker image last asked for; null while the slot holds nothing. */
    #checker: string | null = null;
    /** The frame key drawn last: it stays on screen while the current one loads. */
    #displayed: string | null = null;
    #disposed = false;

    private constructor(
        canvas: HTMLCanvasElement,
        renderer: WebGPURenderer,
        scene: Scene,
        stage: Stage,
        hooks: InstanceHooks,
    ) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.#scene = scene;
        this.#stage = stage;
        this.#hooks = hooks;
        this.queue = new UploadQueue<SlotTag>({
            target: {
                texture: (id, source, signal) => {
                    hooks.onTexture(id);
                    return renderer.texture(id, source, signal);
                },
            },
            onPublish: (slot, tag) => this.#published(slot, tag),
            onError: (slot, error) => this.#failed(slot, error),
        });
    }

    /**
     * Creates a renderer on a new canvas element of `size` device pixels. The canvas is not
     * in the document: the viewport inserts it once it has drawn.
     */
    static async create(
        size: DeviceSize,
        scene: Scene,
        stage: Stage,
        hooks: InstanceHooks,
    ): Promise<RendererInstance> {
        const canvas = document.createElement("canvas");
        // Callers own the backing size; the renderer's logical size is fixed (SPEC §6.2 #1).
        canvas.width = size.width;
        canvas.height = size.height;
        // Fills the viewport element: one backing pixel per device pixel while the sizes
        // match, stretched while a replacement for a new size is on its way.
        canvas.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%";
        const renderer = await WebGPURenderer.create(canvas, size.width, size.height, (error) =>
            hooks.onError(error),
        );
        return new RendererInstance(canvas, renderer, scene, stage, hooks);
    }

    get width(): number {
        return this.renderer.width;
    }

    get height(): number {
        return this.renderer.height;
    }

    get status(): RendererStatus {
        return this.renderer.status;
    }

    get disposed(): boolean {
        return this.#disposed;
    }

    inspect(): RendererResourceInspection {
        return this.renderer.inspect();
    }

    /** The key each frame slot shows, for tests. */
    shownKeys(): (string | null)[] {
        return Array.from(
            { length: FRAME_SLOT_COUNT },
            (_, index) => this.slots.shown(index)?.key ?? null,
        );
    }

    /** Asks for whatever the scene needs and this instance does not have or expect yet. */
    sync(): void {
        this.#syncChecker();
        this.#syncCurrent();
    }

    /** Reserves slots for the keys of another instance's cache, least recently used first. */
    seed(keys: readonly string[]): void {
        if (!this.#scene.document) return;
        for (const key of keys) {
            if (this.slots.reservedFor(key) < 0) this.#load(key);
        }
    }

    /** The scene's document was replaced: nothing of the earlier one is kept or drawn. */
    documentChanged(): void {
        this.#displayed = null;
        this.#blank(this.slots.release(() => true));
        this.sync();
    }

    /**
     * The pixels behind `keys` changed. The current frame is uploaded again into its slot,
     * which shows the previous pixels until then; every other key is given up and its slot
     * replaced by the placeholder, to be uploaded when it is needed again.
     */
    invalidate(keys: readonly string[] | "all"): void {
        const hit = keys === "all" ? () => true : (key: string) => keys.includes(key);
        const { current } = this.#scene;
        // "all" includes the document's size, which the checker image follows.
        if (keys === "all") this.#syncChecker();
        this.#blank(this.slots.release((key) => key !== current && hit(key)));
        if (current === null || !hit(current)) return;
        const slot = this.slots.reservedFor(current);
        if (slot >= 0) this.#requestFrame(slot, current);
        else this.#syncCurrent();
    }

    /** Resolves when no upload of this instance is in flight or waiting. */
    async settle(): Promise<void> {
        while (this.queue.busy()) await this.queue.idle();
    }

    /**
     * Builds the frame from the slots that are ready and submits it. Returns false when NGNE
     * drew nothing (it reports why through the diagnostic callback).
     */
    draw(): boolean {
        const scene = this.#scene;
        const { frame, camera } = this.#stage;
        frame.reset();
        frame.scene(camera, 1);
        // The workspace as a rect, so that every frame has at least one sprite: the sprite
        // counter then tells a device loss from a frame that had nothing to draw.
        frame.rect(
            this.width / 2,
            this.height / 2,
            this.width,
            this.height,
            scene.background,
            1,
            QUAD_LAYER.workspace,
        );
        for (const quad of this.quads()) frame.sprite(quad);
        this.renderer.render(frame, scene.background);
        this.drewSprites = this.renderer.sprites;
        return this.drewSprites > 0;
    }

    /**
     * The textured quads of the scene: only slots whose upload has resolved, each over the
     * rectangle of the image it actually holds (SPEC §6.2 #5, §6.4).
     */
    quads(): Quad[] {
        const scene = this.#scene;
        if (!scene.document) return [];
        const quads: Quad[] = [];
        const checker = this.queue.published(CHECKER_SLOT);
        if (checker && checker.key !== null && checker.epoch === scene.epoch) {
            quads.push(imageQuad(CHECKER_SLOT, QUAD_LAYER.checker, scene.view, checker));
        }
        const slot = this.#displaySlot();
        const image = this.slots.shown(slot);
        if (image) quads.push(imageQuad(frameSlotId(slot), QUAD_LAYER.frame, scene.view, image));
        return quads;
    }

    /** Ends the instance: uploads aborted, renderer disposed, canvas out of the document. */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.queue.dispose();
        try {
            this.renderer.dispose();
        } catch (error) {
            this.#hooks.onError(error);
        }
        this.canvas.remove();
    }

    /**
     * The slot to draw the frame from: the current key when a slot shows it, otherwise the
     * key drawn last, so a frame switch shows the old frame or the new one, never a slot
     * whose texture is still another frame's.
     */
    #displaySlot(): number {
        const { current } = this.#scene;
        if (current === null) {
            this.#displayed = null;
            return -1;
        }
        const wanted = this.slots.showing(current);
        if (wanted >= 0) {
            this.#displayed = current;
            return wanted;
        }
        const previous = this.#displayed === null ? -1 : this.slots.showing(this.#displayed);
        if (previous < 0) this.#displayed = null;
        return previous;
    }

    #syncChecker(): void {
        const { document: doc, checker, epoch } = this.#scene;
        const spec = doc ? `${epoch}/${checkerSpec(doc.width, doc.height, checker)}` : null;
        if (spec === this.#checker) return;
        this.#checker = spec;
        this.queue.request(CHECKER_SLOT, () =>
            this.#build(CHECKER_SLOT, () => {
                const { document: now, checker: colours } = this.#scene;
                if (!now) return null;
                return {
                    key: checkerSpec(now.width, now.height, colours),
                    pixels: checkerPixels(now.width, now.height, colours),
                };
            }),
        );
    }

    #syncCurrent(): void {
        const { current, document: doc } = this.#scene;
        if (current === null || !doc) return;
        if (this.slots.reservedFor(current) >= 0) this.slots.use(current);
        else this.#load(current);
    }

    /** Reserves a slot for `key` and uploads its image. */
    #load(key: string): void {
        const slot = this.slots.reserve(key, [this.#scene.current, this.#displayed]);
        if (slot >= 0) this.#requestFrame(slot, key);
    }

    #requestFrame(slot: number, key: string): void {
        const id = frameSlotId(slot);
        this.queue.request(id, () =>
            this.#build(id, () => {
                const pixels = this.#scene.document?.pixels(key) ?? null;
                return pixels && { key, pixels };
            }),
        );
    }

    /** Replaces the textures of freed frame slots by the 1×1 placeholder. */
    #blank(slots: readonly number[]): void {
        for (const slot of slots) {
            const id = frameSlotId(slot);
            this.queue.request(id, () => this.#build(id, () => null));
        }
    }

    /**
     * Makes an upload. `image` reads the CPU state when the upload starts; null means the
     * slot has nothing to show and gets the placeholder.
     */
    async #build(
        slot: string,
        image: () => { key: string; pixels: PixelBuffer } | null,
    ): Promise<Upload<SlotTag>> {
        await this.#hooks.gate(slot);
        // Read together, in one task: the tag describes exactly the pixels uploaded.
        const { epoch } = this.#scene;
        const made = image();
        if (!made) {
            return {
                bitmap: await placeholderBitmap(),
                tag: { epoch, key: null, width: 1, height: 1 },
            };
        }
        const { width, height } = made.pixels;
        return {
            bitmap: await bitmapFromPixels(made.pixels),
            tag: { epoch, key: made.key, width, height },
        };
    }

    #published(slot: string, tag: SlotTag): void {
        const index = frameSlotIndex(slot);
        if (index >= 0) {
            const current = tag.key !== null && tag.epoch === this.#scene.epoch;
            this.slots.publish(
                index,
                current && tag.key !== null
                    ? { key: tag.key, width: tag.width, height: tag.height }
                    : null,
                { current: this.#scene.current, newerQueued: this.queue.pending(slot) },
            );
        }
        this.#hooks.onChange();
    }

    #failed(slot: string, error: unknown): void {
        const index = frameSlotIndex(slot);
        if (index >= 0 && this.queue.failed(slot)) {
            // The slot takes no more uploads on this renderer; the current frame moves on
            // to another one.
            this.slots.disable(index);
            this.#syncCurrent();
        }
        this.#hooks.onError(error);
        this.#hooks.onChange();
    }
}
