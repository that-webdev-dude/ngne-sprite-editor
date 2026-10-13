import type { PixelBuffer } from "../../core/model";
import { UploadQueue } from "../UploadQueue";
import type { TextureTarget, Upload } from "../UploadQueue";
import { checkerPixels, checkerSpec } from "./checker";
import { FrameSlots } from "./frameSlots";
import { imageQuad, QUAD_LAYER } from "./geometry";
import type { Quad } from "./geometry";
import type { ViewportChecker, ViewportDocument, ViewportView } from "./types";

// The texture slots of one renderer of the viewport (SPEC §6.4) and what goes into them: the
// upload queue, the frame cache and the checkerboard. It decides what to upload for a scene
// and which quads can be drawn; it has no DOM and no NGNE in it, the renderer is the
// `TextureTarget` it is given.

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
 * Puts another document, or none, on show. The frame key goes with the document it belonged
 * to: the next one is set once the new document is in place, so no slot is reserved for a
 * key of the document left.
 */
export function replaceSceneDocument(scene: Scene, document: ViewportDocument | null): void {
    scene.document = document;
    scene.epoch++;
    scene.current = null;
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

/** What the slots need of the renderer instance they belong to. */
export interface SlotsHost {
    /** The renderer, as far as uploads go. */
    target: TextureTarget;
    /** Makes the upload source of a straight-alpha RGBA8 image. */
    bitmap(pixels: PixelBuffer): Promise<ImageBitmap>;
    /** True once the renderer itself has failed: it rejects every upload from then on. */
    rendererFailed(): boolean;
    /** A slot changed what it shows: the scene has to be drawn again. */
    onChange(): void;
    /** A failed upload or an image that could not be made. */
    onError(error: unknown): void;
    /**
     * An upload failed on this renderer and no other slot can stand in: the scene can be
     * shown in full only by a fresh renderer (SPEC §6.4). Called at most once.
     */
    onStuck(): void;
    /** Test hook: when it returns a promise, the upload of `slot` starts after it. */
    gate(slot: string): Promise<void> | undefined;
}

/** The slots of one renderer: what is uploaded where, and what can be drawn. */
export class ViewportSlots {
    readonly queue: UploadQueue<SlotTag>;
    readonly frames = new FrameSlots(FRAME_SLOT_COUNT);
    readonly #scene: Scene;
    readonly #host: SlotsHost;
    /**
     * Spec of the checker image last asked for; null while the slot holds nothing, undefined
     * when the image asked for could not be made and has to be asked for again.
     */
    #checker: string | null | undefined = null;
    /** The frame key drawn last: it stays on screen while the current one loads. */
    #displayed: string | null = null;
    #stuck = false;

    constructor(scene: Scene, host: SlotsHost) {
        this.#scene = scene;
        this.#host = host;
        this.queue = new UploadQueue<SlotTag>({
            target: host.target,
            onPublish: (slot, tag) => this.#published(slot, tag),
            onError: (slot, error) => this.#failed(slot, error),
        });
    }

    /** True once this renderer cannot show the scene in full any more (see `onStuck`). */
    get stuck(): boolean {
        return this.#stuck;
    }

    /** The key each frame slot shows, for tests. */
    shownKeys(): (string | null)[] {
        return Array.from(
            { length: FRAME_SLOT_COUNT },
            (_, index) => this.frames.shown(index)?.key ?? null,
        );
    }

    /** Asks for whatever the scene needs and these slots do not have or expect yet. */
    sync(): void {
        this.#syncChecker();
        this.#syncCurrent();
    }

    /** Reserves slots for the keys of another renderer's cache, least recently used first. */
    seed(keys: readonly string[]): void {
        if (!this.#scene.document) return;
        for (const key of keys) {
            if (this.frames.reservedFor(key) < 0) this.#load(key);
        }
    }

    /** The scene's document was replaced: nothing of the earlier one is kept or drawn. */
    documentChanged(): void {
        this.#displayed = null;
        this.#blank(this.frames.release(() => true));
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
        this.#blank(this.frames.release((key) => key !== current && hit(key)));
        if (current === null || !hit(current)) return;
        const slot = this.frames.reservedFor(current);
        if (slot >= 0) this.#requestFrame(slot, current);
        else this.#syncCurrent();
    }

    /**
     * Resolves when no upload is in flight or waiting. It also resolves when the queue is
     * disposed: a disposed queue is never busy.
     */
    async settle(): Promise<void> {
        while (this.queue.busy()) await this.queue.idle();
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
        const image = this.frames.shown(slot);
        if (image) quads.push(imageQuad(frameSlotId(slot), QUAD_LAYER.frame, scene.view, image));
        return quads;
    }

    /** Ends the slots with their renderer: nothing more is uploaded or reported. */
    dispose(): void {
        this.queue.dispose();
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
        const wanted = this.frames.showing(current);
        if (wanted >= 0) {
            this.#displayed = current;
            return wanted;
        }
        const previous = this.#displayed === null ? -1 : this.frames.showing(this.#displayed);
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
        if (this.frames.reservedFor(current) >= 0) this.frames.use(current);
        else this.#load(current);
    }

    /** Reserves a slot for `key` and uploads its image. */
    #load(key: string): void {
        const slot = this.frames.reserve(key, [this.#scene.current, this.#displayed]);
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
        await this.#host.gate(slot);
        // Read together, in one task: the tag describes exactly the pixels uploaded.
        const { epoch } = this.#scene;
        const made = image();
        if (!made) {
            const placeholder = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
            return {
                bitmap: await this.#host.bitmap(placeholder),
                tag: { epoch, key: null, width: 1, height: 1 },
            };
        }
        const { width, height } = made.pixels;
        return {
            bitmap: await this.#host.bitmap(made.pixels),
            tag: { epoch, key: made.key, width, height },
        };
    }

    #published(slot: string, tag: SlotTag): void {
        const index = frameSlotIndex(slot);
        if (index >= 0) {
            const current = tag.key !== null && tag.epoch === this.#scene.epoch;
            this.frames.publish(
                index,
                current && tag.key !== null
                    ? { key: tag.key, width: tag.width, height: tag.height }
                    : null,
                { current: this.#scene.current, newerQueued: this.queue.pending(slot) },
            );
        }
        this.#host.onChange();
    }

    #failed(slot: string, error: unknown): void {
        if (this.queue.failed(slot)) this.#uploadFailed(slot);
        else this.#buildFailed(slot);
        this.#host.onError(error);
        this.#host.onChange();
    }

    /**
     * `texture()` rejected: the slot takes no more uploads on this renderer. A frame moves on
     * to another slot; the checkerboard has no other, and neither has a frame once every
     * slot is taken out, so the renderer is then reported stuck. On a renderer that has
     * itself failed nothing is tried: every slot would be rejected in turn, and the viewport
     * replaces it anyway.
     */
    #uploadFailed(slot: string): void {
        if (this.#host.rendererFailed()) return;
        const index = frameSlotIndex(slot);
        if (index < 0) {
            this.#reportStuck();
            return;
        }
        this.frames.disable(index);
        this.#syncCurrent();
        const { current, document: doc } = this.#scene;
        if (current !== null && doc && this.frames.reservedFor(current) < 0) this.#reportStuck();
    }

    /**
     * The image of a request could not be made (the composite or the bitmap threw). The slot
     * is fine, so what it was reserved for is given up and asked for again by the next
     * `sync()`; it is not asked for here, or a builder that always throws would spin.
     */
    #buildFailed(slot: string): void {
        // A newer request is waiting: that one decides what the slot is for.
        if (this.queue.pending(slot)) return;
        const index = frameSlotIndex(slot);
        if (index >= 0) this.frames.unreserve(index);
        else this.#checker = undefined;
    }

    #reportStuck(): void {
        if (this.#stuck) return;
        this.#stuck = true;
        this.#host.onStuck();
    }
}
