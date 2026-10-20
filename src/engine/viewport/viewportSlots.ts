import type { PixelBuffer } from "../../core/model";
import { UploadQueue } from "../UploadQueue";
import type { TextureTarget, Upload } from "../UploadQueue";
import { checkerPixels, checkerSpec } from "./checker";
import { FrameSlots } from "./frameSlots";
import type { SlotImage } from "./frameSlots";
import { imageQuad, QUAD_LAYER, tiledCopies } from "./geometry";
import type { Quad, TiledMode } from "./geometry";
import { blitCell, cellUv, createGridImage, playGridLayout } from "./playGrid";
import type { PlayGridLayout } from "./playGrid";
import { ReferenceSlots, referenceSlotIndex } from "./referenceSlots";
import { frameKey, parseFrameKey } from "./types";
import type {
    ViewportChecker,
    ViewportDocument,
    ViewportGhost,
    ViewportReference,
    ViewportView,
} from "./types";

// The texture slots of one renderer of the viewport (SPEC §6.4) and what goes into them: the
// upload queue, the frame cache and the checkerboard. It decides what to upload for a scene
// and which quads can be drawn; it has no DOM and no NGNE in it, the renderer is the
// `TextureTarget` it is given.

/** The checkerboard slot. Slot IDs are fixed for the life of a renderer. */
export const CHECKER_SLOT = "ed:checker";
/** Number of frame cache slots, `ed:f:0` to `ed:f:7`. */
export const FRAME_SLOT_COUNT = 8;
/** The grid of the playing range during editor playback (SPEC §6.4, SE-024). */
export const PLAY_SLOT = "ed:play";

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
    /**
     * Editor playback (SE-024): the frame keys of the playing range, each once; null or absent
     * while nothing plays.
     */
    playing?: readonly string[] | null;
    /**
     * The visible reference layers of the document, bottom to top (SE-045); absent or empty
     * for none.
     */
    references?: readonly ViewportReference[];
    /**
     * The onion skins around the current frame, in draw order (SE-025); absent or empty for
     * none. They are not drawn while playing (SPEC §7.5).
     */
    onion?: readonly ViewportGhost[];
    /**
     * Tiled mode (SE-062): the checkerboard and the frame drawn are repeated around the
     * document on these axes; absent for "none".
     */
    tiled?: TiledMode;
}

/** An onion skin drawn by the quads made last: its key, opacity and NGNE layer (SE-025). */
export interface DrawnGhost {
    key: string;
    alpha: number;
    layer: number;
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
    // The references went with the document as well (SE-045), and so did the onion skins.
    scene.references = [];
    scene.onion = [];
    // And its tiled mode (SE-062): the app tells the new document's.
    scene.tiled = "none";
}

/** What an upload put into a slot. */
interface SlotTag {
    epoch: number;
    /** A frame key, the spec of a checker image, or null for the 1×1 placeholder. */
    key: string | null;
    /** Size of the image, in document pixels. */
    width: number;
    height: number;
    /** The document's `version` of a frame's pixels, when it gives one (SE-015). */
    version?: number;
    /** For `ed:play`: the grid's cells, and the frame key of each (null: left empty). */
    grid?: PlayGridTag;
}

/** The cells of an `ed:play` image. */
interface PlayGridTag {
    layout: PlayGridLayout;
    keys: readonly (string | null)[];
}

/** The grid `ed:play` shows. */
interface PlayShown {
    layout: PlayGridLayout;
    /** The cell of each frame key. */
    cells: ReadonlyMap<string, number>;
    /** The keys whose cells still show their frame's pixels: none of them changed since. */
    valid: Set<string>;
    version?: number;
}

/** What an upload is made of: a key and its pixels, read in one task. */
interface SlotImageSource {
    key: string;
    pixels: PixelBuffer;
    version?: number;
    grid?: PlayGridTag;
}

/** What the slots need of the renderer instance they belong to. */
export interface SlotsHost {
    /** The renderer, as far as uploads go. */
    target: TextureTarget;
    /** Makes the upload source of a straight-alpha RGBA8 image. */
    bitmap(pixels: PixelBuffer): Promise<ImageBitmap>;
    /**
     * Makes the upload source of a reference (SE-045): `image` resampled on the CPU to
     * `width` × `height` (SPEC §7.6). A host without it shows no reference.
     */
    referenceBitmap?(image: PixelBuffer, width: number, height: number): Promise<ImageBitmap>;
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
    /** The reference slots `ed:ref:0..3` (SE-045). */
    readonly references: ReferenceSlots;
    readonly #scene: Scene;
    readonly #host: SlotsHost;
    /**
     * Spec of the checker image last asked for; null while the slot holds nothing, undefined
     * when the image asked for could not be made and has to be asked for again.
     */
    #checker: string | null | undefined = null;
    /** The frame key drawn last: it stays on screen while the current one loads. */
    #displayed: string | null = null;
    /** The frame image of the quads made last; null when they had none. */
    #drawn: SlotImage | null = null;
    /** The onion skins of the quads made last (SE-025). */
    #drawnGhosts: DrawnGhost[] = [];
    #stuck = false;
    /**
     * Spec of the `ed:play` grid last asked for: null while the slot holds none and none is
     * asked for. A grid that could not be built is not asked for again until playback stops.
     */
    #playSpec: string | null = null;
    /** The grid `ed:play` shows, once its upload resolved. */
    #playShown: PlayShown | null = null;
    /** Keys whose pixels changed since the grid being built read them. */
    readonly #playStale = new Set<string>();
    /** `ed:play` failed on this renderer: playback steps through the frame cache. */
    #playFailed = false;
    /**
     * While playing without the grid: when each key was last made the current one, so the
     * newest ready frame is drawn (SE-024), never one older than the frame on screen.
     */
    readonly #requested = new Map<string, number>();
    #requests = 0;

    constructor(scene: Scene, host: SlotsHost) {
        this.#scene = scene;
        this.#host = host;
        this.queue = new UploadQueue<SlotTag>({
            target: host.target,
            onPublish: (slot, tag) => this.#published(slot, tag),
            onError: (slot, error) => this.#failed(slot, error),
        });
        this.references = new ReferenceSlots(scene, this.queue, {
            referenceBitmap: (image, width, height) => {
                if (!host.referenceBitmap) throw new Error("This viewport shows no references.");
                return host.referenceBitmap(image, width, height);
            },
            placeholder: () => host.bitmap({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
            gate: (slot) => host.gate(slot),
            onStuck: () => this.#reportStuck(),
        });
    }

    /** True once this renderer cannot show the scene in full any more (see `onStuck`). */
    get stuck(): boolean {
        return this.#stuck;
    }

    /**
     * The frame image the quads made last draw: its key and the version of its pixels
     * (SE-015). Null when they draw no frame.
     */
    drawnFrame(): SlotImage | null {
        return this.#drawn;
    }

    /** The onion skins the quads made last draw, in draw order (SE-025). */
    drawnGhosts(): readonly DrawnGhost[] {
        return this.#drawnGhosts;
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
        this.#syncPlay();
        this.#syncCurrent();
        this.#syncOnion();
        this.references.sync();
    }

    /**
     * The grid `ed:play` shows: its layout and the frame keys whose cells are current. Null
     * while it shows none. For tests.
     */
    playGrid(): { layout: PlayGridLayout; keys: string[] } | null {
        const shown = this.#playShown;
        return shown ? { layout: shown.layout, keys: [...shown.valid] } : null;
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
        this.#playShown = null;
        this.#blank(this.frames.release(() => true));
        this.sync();
    }

    /**
     * The pixels behind `keys` changed. The keys on screen — the current frame and the onion
     * skins (SE-025) — are uploaded again into their slots, which show the previous pixels
     * until then; every other key is given up and its slot replaced by the placeholder, to be
     * uploaded when it is needed again.
     */
    invalidate(keys: readonly string[] | "all"): void {
        // A frame's plain key stands for its tinted variants, made from the same pixels.
        const hit =
            keys === "all"
                ? () => true
                : (key: string) =>
                      keys.includes(key) || keys.includes(frameKey(parseFrameKey(key).frameId));
        const { current } = this.#scene;
        // The onion skins are keys on screen as well (SE-025): uploaded again in place, or the
        // ghosts would blank at every edit.
        const ghosts = this.#ghosts().map((ghost) => ghost.key);
        // "all" includes the document's size, which the checker image follows.
        if (keys === "all") this.#syncChecker();
        this.#invalidatePlay(hit);
        this.#blank(
            this.frames.release((key) => key !== current && !ghosts.includes(key) && hit(key)),
        );
        for (const key of ghosts) {
            if (!hit(key)) continue;
            const slot = this.frames.reservedFor(key);
            if (slot >= 0) this.#requestFrame(slot, key);
            else this.#load(key);
        }
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
        this.#drawn = null;
        this.#drawnGhosts = [];
        if (!scene.document) return [];
        const quads: Quad[] = [];
        // Tiled mode (SE-062) repeats the checkerboard and the frame, never the references or
        // the onion skins, which belong to the document in the middle.
        const tiled = scene.tiled ?? "none";
        const checker = this.queue.published(CHECKER_SLOT);
        if (checker && checker.key !== null && checker.epoch === scene.epoch) {
            const quad = imageQuad(CHECKER_SLOT, QUAD_LAYER.checker, scene.view, checker);
            quads.push(quad, ...tiledCopies(quad, tiled));
        }
        quads.push(...this.references.quads());
        quads.push(...this.#ghostQuads());
        const cell = this.#playCell();
        if (cell) {
            const { layout, index, image } = cell;
            const quad: Quad = {
                ...imageQuad(PLAY_SLOT, QUAD_LAYER.frame, scene.view, image),
                ...cellUv(layout, index),
            };
            quads.push(quad, ...tiledCopies(quad, tiled));
            this.#drawn = image;
            return quads;
        }
        const slot = this.#displaySlot();
        const image = this.frames.shown(slot);
        if (image) {
            const quad = imageQuad(frameSlotId(slot), QUAD_LAYER.frame, scene.view, image);
            quads.push(quad, ...tiledCopies(quad, tiled));
            this.#drawn = image;
        }
        return quads;
    }

    /** Ends the slots with their renderer: nothing more is uploaded or reported. */
    dispose(): void {
        this.references.dispose();
        this.queue.dispose();
    }

    /**
     * The slot to draw the frame from: the current key when a slot holds it, otherwise the
     * key drawn last, so a frame switch shows the old frame or the new one, never a slot
     * whose texture is still another frame's. A slot that still shows the current key while
     * it is being re-keyed for another is not used: the key drawn last is kept from being
     * re-keyed (`#load`), that slot is not, and drawing from it would leave the checkerboard
     * alone once its new upload resolves (SE-024, from the SE-011 review).
     */
    #displaySlot(): number {
        const { current } = this.#scene;
        if (current === null) {
            this.#displayed = null;
            return -1;
        }
        const wanted = this.frames.holding(current);
        if (wanted >= 0) {
            this.#displayed = current;
            return wanted;
        }
        if (this.#scene.playing) {
            // Playback through the frame cache: the newest frame that is ready, never one
            // played before the frame on screen, which stays while none is (SE-024).
            const shownOrder =
                this.#displayed === null ? 0 : (this.#requested.get(this.#displayed) ?? 0);
            let best = -1;
            let newest = shownOrder;
            for (let slot = 0; slot < this.frames.count; slot++) {
                const key = this.frames.shown(slot)?.key;
                const held = key !== undefined && this.frames.reserved(slot) === key;
                const order = held ? (this.#requested.get(key) ?? 0) : 0;
                if (order > newest) {
                    newest = order;
                    best = slot;
                }
            }
            const image = this.frames.shown(best);
            if (image) {
                this.#displayed = image.key;
                return best;
            }
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
        const { current, document: doc, playing } = this.#scene;
        if (current === null || !doc) return;
        if (playing) {
            this.#requested.set(current, ++this.#requests);
            // Drawn from the grid: no upload per step.
            if (this.#playShown?.valid.has(current)) return;
        }
        if (this.frames.reservedFor(current) >= 0) this.frames.use(current);
        else this.#load(current);
    }

    /**
     * Reserves a slot for `key` and uploads its image. A slot of a key on screen (the current
     * frame, the one drawn while it loads, an onion skin) is not taken.
     */
    #load(key: string): void {
        const ghosts = this.#ghosts().map((ghost) => ghost.key);
        const slot = this.frames.reserve(key, [this.#scene.current, this.#displayed, ...ghosts]);
        if (slot >= 0) this.#requestFrame(slot, key);
    }

    /**
     * Asks again for a key on screen that has no slot (SE-025 review A): with eight keys for
     * eight slots, one can find every slot kept while others are being re-keyed, and an upload
     * resolving frees one. It cannot spin: a key is asked for only while it has no slot, and
     * a request that cannot be made publishes nothing.
     */
    #syncMissing(): void {
        const { current } = this.#scene;
        const keys = this.#ghosts().map((ghost) => ghost.key);
        if (current !== null) keys.push(current);
        if (keys.every((key) => this.frames.reservedFor(key) >= 0)) return;
        this.#syncCurrent();
        this.#syncOnion();
    }

    #requestFrame(slot: number, key: string): void {
        const id = frameSlotId(slot);
        this.queue.request(id, () =>
            this.#build(id, () => {
                const document = this.#scene.document;
                const pixels = document?.pixels(key) ?? null;
                if (!document || !pixels) return null;
                const version = document.version?.(key);
                return version === undefined ? { key, pixels } : { key, pixels, version };
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
    async #build(slot: string, image: () => SlotImageSource | null): Promise<Upload<SlotTag>> {
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
        const tag: SlotTag = { epoch, key: made.key, width, height };
        if (made.version !== undefined) tag.version = made.version;
        if (made.grid) tag.grid = made.grid;
        return { bitmap: await this.#host.bitmap(made.pixels), tag };
    }

    #published(slot: string, tag: SlotTag): void {
        if (referenceSlotIndex(slot) >= 0) {
            this.#host.onChange();
            return;
        }
        if (slot === PLAY_SLOT) {
            this.#playPublished(tag);
            this.#host.onChange();
            return;
        }
        const index = frameSlotIndex(slot);
        if (index >= 0) {
            const current = tag.key !== null && tag.epoch === this.#scene.epoch;
            let image: SlotImage | null = null;
            if (current && tag.key !== null) {
                image = { key: tag.key, width: tag.width, height: tag.height };
                if (tag.version !== undefined) image.version = tag.version;
            }
            this.frames.publish(index, image, {
                current: this.#scene.current,
                onScreen: this.#ghosts().map((ghost) => ghost.key),
                newerQueued: this.queue.pending(slot),
            });
            // A grid kept after playback stopped goes once a slot shows the frame instead.
            if (!this.#scene.playing) {
                this.#syncPlay();
                this.#syncMissing();
            }
        }
        this.#host.onChange();
    }

    #failed(slot: string, error: unknown): void {
        if (referenceSlotIndex(slot) >= 0) {
            this.references.failed(slot);
            this.#host.onError(error);
            this.#host.onChange();
            return;
        }
        if (slot === PLAY_SLOT) {
            // Playback steps through the frame cache instead: for good on this renderer when
            // `texture()` rejected; for this playback when the grid could not be built.
            if (this.queue.failed(slot)) this.#playFailed = true;
            this.#playShown = null;
            this.#host.onError(error);
            this.#host.onChange();
            return;
        }
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
        // An onion skin of the slot moves on as well (SE-025 review A).
        this.#syncOnion();
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

    // --- Onion skin (SE-025) -------------------------------------------------------------

    /** The onion skins on screen: none without a document or while playing (SPEC §7.5). */
    #ghosts(): readonly ViewportGhost[] {
        const { document: doc, playing, onion } = this.#scene;
        return doc && !playing && onion ? onion : [];
    }

    /**
     * Asks for the onion skins' keys, which stay in the frame cache as any key does. While no
     * ghost is tinted, the tinted variants are of no use: their slots get the placeholder
     * (SPEC §6.4, slots that become unused). Playing only hides the ghosts.
     */
    #syncOnion(): void {
        const { document: doc, onion = [] } = this.#scene;
        if (!doc) return;
        const tinted = (key: string) => {
            const { variant } = parseFrameKey(key);
            return variant === "before" || variant === "after";
        };
        if (!onion.some((ghost) => tinted(ghost.key))) this.#blank(this.frames.release(tinted));
        for (const { key } of this.#ghosts()) {
            if (this.frames.reservedFor(key) >= 0) this.frames.use(key);
            else this.#load(key);
        }
    }

    /**
     * The quads of the onion skins whose slot holds their key (never one being re-keyed), at
     * layer 3 or 5 with their opacity (SPEC §6.4, quad order). A ghost whose key is still on
     * its way is left out until its upload resolves.
     */
    #ghostQuads(): Quad[] {
        const quads: Quad[] = [];
        for (const ghost of this.#ghosts()) {
            const slot = this.frames.holding(ghost.key);
            const image = this.frames.shown(slot);
            if (!image) continue;
            const layer =
                ghost.placement === "front" ? QUAD_LAYER.onionFront : QUAD_LAYER.onionBehind;
            quads.push({
                ...imageQuad(frameSlotId(slot), layer, this.#scene.view, image),
                alpha: ghost.alpha,
            });
            this.#drawnGhosts.push({ key: ghost.key, alpha: ghost.alpha, layer });
        }
        return quads;
    }

    // --- Editor playback (SE-024) --------------------------------------------------------

    /**
     * Asks for the grid of the playing range when it fits `ed:play` (SPEC §6.4), or lets go of
     * the grid when nothing plays or it does not fit. After playback the grid stays while the
     * current frame is drawn from it and no frame slot shows that frame yet, so the frame on
     * screen does not go back to an older one while its own upload is on its way.
     */
    #syncPlay(): void {
        const { playing, document: doc, epoch, current } = this.#scene;
        if (!playing) this.#requested.clear();
        const layout =
            playing && doc && !this.#playFailed
                ? playGridLayout(playing.length, doc.width, doc.height)
                : null;
        if (!playing || !doc || !layout) {
            if (this.#playSpec === null) return;
            const kept =
                !playing &&
                current !== null &&
                this.#playShown?.cells.has(current) === true &&
                this.frames.holding(current) < 0;
            if (kept) return;
            this.#playSpec = null;
            this.#playShown = null;
            this.queue.request(PLAY_SLOT, () => this.#build(PLAY_SLOT, () => null));
            return;
        }
        const spec = `${epoch}/${doc.width}x${doc.height}/${playing.join("\n")}`;
        if (spec === this.#playSpec) return;
        this.#playSpec = spec;
        this.queue.request(PLAY_SLOT, () => this.#build(PLAY_SLOT, () => this.#gridImage()));
    }

    /** The grid of the playing range, read in one task with its version; null for none. */
    #gridImage(): SlotImageSource | null {
        const { document: doc, playing } = this.#scene;
        if (!doc || !playing || playing.length === 0) return null;
        const layout = playGridLayout(playing.length, doc.width, doc.height);
        if (!layout) return null;
        this.#playStale.clear();
        const pixels = createGridImage(layout);
        const keys = playing.map((key, index) => {
            const image = doc.pixels(key);
            return image && blitCell(pixels, layout, index, image) ? key : null;
        });
        const version = doc.version?.(playing[0]!);
        const made: SlotImageSource = { key: PLAY_SLOT, pixels, grid: { layout, keys } };
        if (version !== undefined) made.version = version;
        return made;
    }

    #playPublished(tag: SlotTag): void {
        const { grid } = tag;
        if (!grid || tag.epoch !== this.#scene.epoch || this.#playSpec === null) {
            this.#playShown = null;
            return;
        }
        const cells = new Map<string, number>();
        const valid = new Set<string>();
        for (const [index, key] of grid.keys.entries()) {
            if (key === null || cells.has(key)) continue;
            cells.set(key, index);
            if (!this.#playStale.has(key)) valid.add(key);
        }
        this.#playShown = { layout: grid.layout, cells, valid };
        if (tag.version !== undefined) this.#playShown.version = tag.version;
    }

    /**
     * Pixels behind some keys changed: their cells are out of date. While playing, the grid is
     * built again; until it is, those frames come from the frame cache, and a cell on screen
     * stays there until a frame slot holds its frame (`#playCell`).
     */
    #invalidatePlay(hit: (key: string) => boolean): void {
        const shown = this.#playShown;
        if (shown) for (const key of [...shown.valid]) if (hit(key)) shown.valid.delete(key);
        const playing = this.#scene.playing;
        if (!playing || this.#playSpec === null) return;
        const changed = playing.filter(hit);
        if (changed.length === 0) return;
        for (const key of changed) this.#playStale.add(key);
        this.#playSpec = null;
        this.#syncPlay();
    }

    /** The cell of the current frame, when it is drawn from the grid. */
    #playCell(): { layout: PlayGridLayout; index: number; image: SlotImage } | null {
        const { current, playing } = this.#scene;
        const shown = this.#playShown;
        const index = current === null ? undefined : shown?.cells.get(current);
        if (current === null || !shown || index === undefined) return null;
        // A frame slot that holds the frame takes over after playback, and while playing
        // when the frame's pixels changed since the grid was built. Until one does, the cell
        // stays on screen with its previous pixels, as a frame slot does during its upload
        // (with the grid's version, so the stroke echo stays over it).
        const fresh = playing && shown.valid.has(current);
        if (!fresh && this.frames.holding(current) >= 0) return null;
        const { layout } = shown;
        const image: SlotImage = {
            key: current,
            width: layout.cellWidth,
            height: layout.cellHeight,
        };
        if (shown.version !== undefined) image.version = shown.version;
        return { layout, index, image };
    }

    #reportStuck(): void {
        if (this.#stuck) return;
        this.#stuck = true;
        this.#host.onStuck();
    }
}
