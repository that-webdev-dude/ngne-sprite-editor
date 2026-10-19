import type { PixelBuffer } from "../../core/model";
import type { UploadQueue } from "../UploadQueue";
import { documentRect, QUAD_LAYER } from "./geometry";
import type { DeviceRect, Quad } from "./geometry";
import type { ViewportReference, ViewportView } from "./types";

// The reference slots `ed:ref:0..3` of one renderer (SPEC §6.4, §7.6; SE-045): which layer each
// holds, at which size its image is uploaded, and the quads that draw them. No DOM and no NGNE:
// the image of an upload is made by the host (`ReferenceHost.referenceBitmap`).
//
// NGNE samples nearest (SPEC §6.2 #6), so a reference is uploaded at the size it has on screen,
// resampled on the CPU: the quad's device rectangle is the texture's size, texel for device
// pixel. A change of that size (a zoom, a new scale) is uploaded once it has stayed the same for
// `RESAMPLE_QUIET_MS`; meanwhile the texture uploaded before is drawn over the new rectangle, as
// a slot keeps showing its previous texture until a replacement is published. A layer whose
// slot holds nothing of its image yet is uploaded at once and drawn once that upload resolves.

/** Number of reference slots: a document has at most four reference layers (SPEC §5.1). */
export const REFERENCE_SLOT_COUNT = 4;
/** A display source is first limited to this many pixels per side (SPEC §7.6). */
export const MAX_DISPLAY_SIDE = 4096;
/** Texels across the four slots at most (SPEC §7.6: 16 MP): 4096 × 4096. */
export const REFERENCE_TEXEL_BUDGET = MAX_DISPLAY_SIDE * MAX_DISPLAY_SIDE;
/** A new size on screen is resampled once it has held this long (SPEC §7.6). */
export const RESAMPLE_QUIET_MS = 100;

/** The texture ID of a reference slot. */
export function referenceSlotId(index: number): string {
    return `ed:ref:${index}`;
}

/** The index of a reference slot ID; -1 for any other slot. */
export function referenceSlotIndex(slot: string): number {
    const match = /^ed:ref:(\d+)$/.exec(slot);
    return match ? Number(match[1]) : -1;
}

/** A size in pixels. */
export interface PixelSize {
    width: number;
    height: number;
}

/**
 * The size of the display source of an image (SPEC §7.6): the image itself when neither side
 * exceeds `MAX_DISPLAY_SIDE`, otherwise scaled down uniformly until the longer side has that
 * length, each side at least 1 pixel.
 */
export function displaySize(image: PixelSize): PixelSize {
    const longer = Math.max(image.width, image.height);
    if (longer <= MAX_DISPLAY_SIDE) return { width: image.width, height: image.height };
    const factor = MAX_DISPLAY_SIDE / longer;
    return {
        width: Math.max(1, Math.round(image.width * factor)),
        height: Math.max(1, Math.round(image.height * factor)),
    };
}

/**
 * The device rectangle a reference covers in `view`: its edges rounded to whole device pixels,
 * at least one pixel wide and high, so the texture uploaded at its size maps texel to pixel.
 */
export function referenceDeviceRect(view: ViewportView, reference: ViewportReference): DeviceRect {
    const { scale, originX, originY } = view;
    const left = Math.round(originX + reference.x * scale);
    const top = Math.round(originY + reference.y * scale);
    const right = Math.round(
        originX + (reference.x + reference.image.width * reference.scale) * scale,
    );
    const bottom = Math.round(
        originY + (reference.y + reference.image.height * reference.scale) * scale,
    );
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * The texture sizes of `references` in `view` (SPEC §7.6): each its size on screen, or its
 * display source when that is smaller on either side (NGNE then magnifies it); when they come
 * to more than `REFERENCE_TEXEL_BUDGET` texels together, all are scaled down by one factor
 * until they fit.
 */
export function textureSizes(
    view: ViewportView,
    references: readonly ViewportReference[],
): PixelSize[] {
    const sizes = references.map((reference) => {
        const display = displaySize(reference.image);
        const rect = referenceDeviceRect(view, reference);
        return rect.width > display.width || rect.height > display.height
            ? display
            : { width: rect.width, height: rect.height };
    });
    const total = sizes.reduce((sum, size) => sum + size.width * size.height, 0);
    if (total <= REFERENCE_TEXEL_BUDGET) return sizes;
    const factor = Math.sqrt(REFERENCE_TEXEL_BUDGET / total);
    return sizes.map((size) => ({
        width: Math.max(1, Math.floor(size.width * factor)),
        height: Math.max(1, Math.floor(size.height * factor)),
    }));
}

/** What an upload put into a reference slot: the key of its image and its size. */
export interface ReferenceTag {
    epoch: number;
    /** The layer and the source (`referenceKey`); null for the 1×1 placeholder. */
    key: string | null;
    width: number;
    height: number;
}

/** What the reference slots need of their renderer instance. */
export interface ReferenceHost {
    /** Makes the image of a reference: `image` resampled to `width` × `height`. */
    referenceBitmap(image: PixelBuffer, width: number, height: number): Promise<ImageBitmap>;
    /** Makes the 1×1 transparent placeholder. */
    placeholder(): Promise<ImageBitmap>;
    /** Test hook: when it returns a promise, the upload of `slot` starts after it. */
    gate(slot: string): Promise<void> | undefined;
    /** Every slot failed for good: only a fresh renderer can show the references. */
    onStuck(): void;
}

/** What the reference slots read of the viewport's scene. */
export interface ReferenceScene {
    readonly document: { readonly width: number; readonly height: number } | null;
    readonly epoch: number;
    readonly view: ViewportView;
    readonly references?: readonly ViewportReference[];
}

interface SlotState {
    /** The layer the slot is kept for; null while it is free. */
    layerId: string | null;
    /** The image and size last asked for; null when the placeholder was, or nothing. */
    requested: string | null;
    /** True once anything was asked for: a slot never used gets no placeholder. */
    used: boolean;
    /** The placeholder was asked for last. */
    blanked: boolean;
    /** `texture()` failed here: the slot takes no more uploads on this renderer. */
    disabled: boolean;
}

/** One number per image object, so a key names the image and not only the layer. */
const imageTokens = new WeakMap<PixelBuffer, number>();
let nextToken = 0;
function imageToken(image: PixelBuffer): number {
    let token = imageTokens.get(image);
    if (token === undefined) {
        token = ++nextToken;
        imageTokens.set(image, token);
    }
    return token;
}

/** The key of a reference's image in a slot: its layer and its source image. */
export function referenceKey(reference: ViewportReference): string {
    return `${reference.id}#${imageToken(reference.image)}`;
}

/** The reference slots of one renderer. */
export class ReferenceSlots {
    readonly #scene: ReferenceScene;
    readonly #queue: UploadQueue<ReferenceTag>;
    readonly #host: ReferenceHost;
    readonly #slots: SlotState[] = Array.from({ length: REFERENCE_SLOT_COUNT }, () => ({
        layerId: null,
        requested: null,
        used: false,
        blanked: false,
        disabled: false,
    }));
    /** The resample waiting for the size on screen to hold (`RESAMPLE_QUIET_MS`). */
    #quiet: ReturnType<typeof setTimeout> | undefined;
    /** The sizes the waiting resample is for, by slot: a change of them restarts the wait. */
    #waitingFor = "";
    #stuck = false;
    #disposed = false;

    constructor(scene: ReferenceScene, queue: UploadQueue<ReferenceTag>, host: ReferenceHost) {
        this.#scene = scene;
        this.#queue = queue;
        this.#host = host;
    }

    /** True while a resample waits for the size on screen to hold. */
    get waiting(): boolean {
        return this.#quiet !== undefined;
    }

    /** What each slot shows, for tests: its layer and image size, or null. */
    shown(): ({ layerId: string; width: number; height: number } | null)[] {
        return this.#slots.map((_, index) => {
            const tag = this.#queue.published(referenceSlotId(index));
            if (!tag || tag.key === null || tag.epoch !== this.#scene.epoch) return null;
            const layerId = tag.key.slice(0, tag.key.lastIndexOf("#"));
            return { layerId, width: tag.width, height: tag.height };
        });
    }

    /** The references to show: none without a document. */
    #references(): readonly ViewportReference[] {
        return this.#scene.document ? (this.#scene.references ?? []) : [];
    }

    /**
     * Brings the slots in line with the scene: a slot for every reference, the placeholder for
     * a slot nothing uses any more, the image of a reference that has none of it yet at once,
     * and a new size on screen once it has held for `RESAMPLE_QUIET_MS`.
     */
    sync(): void {
        if (this.#disposed) return;
        const references = this.#references();
        const ids = new Set(references.map((reference) => reference.id));
        for (const [index, state] of this.#slots.entries()) {
            if (state.layerId === null || ids.has(state.layerId)) continue;
            state.layerId = null;
            this.#blank(index);
        }
        const sizes = textureSizes(this.#scene.view, references);
        const resample: string[] = [];
        for (const [at, reference] of references.entries()) {
            const index = this.#slotFor(reference.id);
            if (index < 0) continue;
            const size = sizes[at]!;
            const key = referenceKey(reference);
            const spec = `${this.#scene.epoch}/${key}/${size.width}x${size.height}`;
            const state = this.#slots[index]!;
            if (state.requested === spec) continue;
            if (this.#holds(index, key, state)) {
                // The same image at another size: resampled once the size holds.
                resample.push(`${index}:${spec}`);
                continue;
            }
            this.#request(index, reference, size, spec);
        }
        this.#scheduleResample(resample.join("\n"));
    }

    /** Ends the slots with their renderer: no timer, no request. */
    dispose(): void {
        this.#disposed = true;
        clearTimeout(this.#quiet);
        this.#quiet = undefined;
    }

    /**
     * The quads of the references whose slot holds their image: each over its device
     * rectangle in the view, clipped to the document rectangle, with its opacity, at layer 2
     * (behind) or 6 (front). A slot that holds another layer's or another image's texture is
     * not drawn from.
     */
    quads(): Quad[] {
        const { document: doc, view, epoch } = this.#scene;
        if (!doc) return [];
        const page = documentRect(view, doc.width, doc.height);
        const quads: Quad[] = [];
        for (const reference of this.#references()) {
            const index = this.#slots.findIndex((state) => state.layerId === reference.id);
            if (index < 0) continue;
            const tag = this.#queue.published(referenceSlotId(index));
            if (!tag || tag.epoch !== epoch || tag.key !== referenceKey(reference)) continue;
            if (reference.opacity <= 0) continue;
            const rect = referenceDeviceRect(view, reference);
            const left = Math.max(rect.x, page.x);
            const top = Math.max(rect.y, page.y);
            const right = Math.min(rect.x + rect.width, page.x + page.width);
            const bottom = Math.min(rect.y + rect.height, page.y + page.height);
            if (right <= left || bottom <= top) continue;
            quads.push({
                texture: referenceSlotId(index),
                layer:
                    reference.placement === "front"
                        ? QUAD_LAYER.referenceFront
                        : QUAD_LAYER.referenceBehind,
                x: (left + right) / 2,
                y: (top + bottom) / 2,
                width: right - left,
                height: bottom - top,
                u: (left - rect.x) / rect.width,
                v: (top - rect.y) / rect.height,
                uw: (right - left) / rect.width,
                vh: (bottom - top) / rect.height,
                alpha: reference.opacity / 255,
            });
        }
        return quads;
    }

    /**
     * An upload of `slot` failed. A rejected `texture()` takes the slot out on this renderer
     * and its layer moves to a free slot at the next sync (with none left, the renderer is
     * stuck); an image that could not be made is asked for again at the next sync.
     */
    failed(slot: string): void {
        const index = referenceSlotIndex(slot);
        const state = this.#slots[index];
        if (!state) return;
        if (this.#queue.pending(slot)) return;
        state.requested = null;
        if (!this.#queue.failed(slot)) return;
        state.disabled = true;
        state.layerId = null;
        if (this.#slots.every((candidate) => candidate.disabled) && !this.#stuck) {
            this.#stuck = true;
            this.#host.onStuck();
        }
    }

    /** True when the slot's texture, or the upload asked for last, is of `key`. */
    #holds(index: number, key: string, state: SlotState): boolean {
        const tag = this.#queue.published(referenceSlotId(index));
        const shown = tag?.epoch === this.#scene.epoch && tag.key === key;
        const asked = state.requested?.startsWith(`${this.#scene.epoch}/${key}/`) === true;
        return shown || asked;
    }

    /** The slot kept for a layer, or a free one taken for it; -1 when none is left. */
    #slotFor(layerId: string): number {
        const kept = this.#slots.findIndex((state) => state.layerId === layerId);
        if (kept >= 0) return kept;
        const free = this.#slots.findIndex((state) => state.layerId === null && !state.disabled);
        if (free >= 0) this.#slots[free]!.layerId = layerId;
        return free;
    }

    #scheduleResample(waitingFor: string): void {
        if (waitingFor === this.#waitingFor) return;
        this.#waitingFor = waitingFor;
        clearTimeout(this.#quiet);
        this.#quiet = undefined;
        if (waitingFor === "") return;
        this.#quiet = setTimeout(() => {
            this.#quiet = undefined;
            this.#waitingFor = "";
            this.#resample();
        }, RESAMPLE_QUIET_MS);
    }

    /** Uploads every reference whose size on screen is not the size of its slot's image. */
    #resample(): void {
        if (this.#disposed) return;
        const references = this.#references();
        const sizes = textureSizes(this.#scene.view, references);
        for (const [at, reference] of references.entries()) {
            const index = this.#slots.findIndex((state) => state.layerId === reference.id);
            if (index < 0) continue;
            const size = sizes[at]!;
            const spec = `${this.#scene.epoch}/${referenceKey(reference)}/${size.width}x${size.height}`;
            if (this.#slots[index]!.requested !== spec) this.#request(index, reference, size, spec);
        }
    }

    #request(index: number, reference: ViewportReference, size: PixelSize, spec: string): void {
        const state = this.#slots[index]!;
        const slot = referenceSlotId(index);
        state.requested = spec;
        state.used = true;
        state.blanked = false;
        const { epoch } = this.#scene;
        const key = referenceKey(reference);
        const { image } = reference;
        this.#queue.request(slot, async () => {
            await this.#host.gate(slot);
            const bitmap = await this.#host.referenceBitmap(image, size.width, size.height);
            return { bitmap, tag: { epoch, key, width: size.width, height: size.height } };
        });
    }

    /** The slot gets the 1×1 placeholder, once; a slot never used gets nothing. */
    #blank(index: number): void {
        const state = this.#slots[index]!;
        if (!state.used || state.blanked || state.disabled) return;
        state.requested = null;
        state.blanked = true;
        const slot = referenceSlotId(index);
        const { epoch } = this.#scene;
        this.#queue.request(slot, async () => {
            await this.#host.gate(slot);
            return {
                bitmap: await this.#host.placeholder(),
                tag: { epoch, key: null, width: 1, height: 1 },
            };
        });
    }
}
