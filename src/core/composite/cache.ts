import type { PixelBuffer, SpriteDoc, Touched } from "../model";
import { createPixelBuffer } from "../pixels";
import {
    blendStack,
    compositeOrigin,
    layerStack,
    sameStack,
    type LayerStack,
} from "./compositeFrame";

/** Memory budget of a composite cache unless another is given: 128 MB (SPEC §5.3). */
export const DEFAULT_COMPOSITE_CACHE_BUDGET_BYTES = 128 * 1024 * 1024;

/** Options of a `CompositeCache`. */
export interface CompositeCacheOptions {
    /** Memory budget in bytes; the default is `DEFAULT_COMPOSITE_CACHE_BUDGET_BYTES`. */
    budgetBytes?: number;
}

interface Entry {
    buffer: PixelBuffer;
    /** What the buffer was composited from. */
    stack: LayerStack;
}

/**
 * The composites of one document's frames, at most one per frame, keyed by frame ID
 * (SPEC §5.3). `get` composites a frame once and returns the same buffer until the frame
 * changes; a changed frame gets a new buffer, never a rewritten one, so a buffer in hand
 * stays as it was and its identity tells whether it is still current.
 *
 * Two things make a kept composite out of date:
 * - Pixels written into an image. The cache cannot see those: `invalidate` reports them,
 *   with the `touched` of the command (the history hands it to its subscribers). Pixels
 *   written outside a command — by an open transaction, or put back by its abort — are
 *   reported by whoever writes them, with the frames that show the image.
 * - Anything else of the frame: its layers and their order, visibility, opacity and blend
 *   mode, its cels and their images, the document's size. `get` checks these itself.
 *
 * The kept buffers never take more than `budgetBytes`: the least recently used are dropped
 * first, and a composite larger than the whole budget is returned without being kept.
 *
 * A composite made outside the cache is handed to it with `adopt`, so that the frame is not
 * composited again (REVIEW.md D6). A stroke keeps the cache current that way while it is
 * drawn: its live composite is adopted, and the stroke goes on bringing it up to date in place
 * and reports each change itself (SE-014). That buffer is the one exception to "never a
 * rewritten one": a reader that keeps pixels of a frame while it is stroked copies them.
 */
export class CompositeCache {
    /** The document whose frames this cache composites. */
    readonly doc: SpriteDoc;
    /** Memory budget in bytes. */
    readonly budgetBytes: number;
    /** By frame ID, least recently used first. */
    readonly #entries = new Map<string, Entry>();
    #bytes = 0;

    /** Throws `RangeError` when the budget is not a number of bytes, 0 or more. */
    constructor(doc: SpriteDoc, options: CompositeCacheOptions = {}) {
        const budgetBytes = options.budgetBytes ?? DEFAULT_COMPOSITE_CACHE_BUDGET_BYTES;
        if (!(budgetBytes >= 0)) {
            throw new RangeError(`A composite cache budget must be 0 or more, got ${budgetBytes}.`);
        }
        this.doc = doc;
        this.budgetBytes = budgetBytes;
    }

    /** Pixel memory of the kept composites, in bytes. Never above `budgetBytes`. */
    get bytes(): number {
        return this.#bytes;
    }

    /** True while a composite of the frame is kept. Does not count as a use of it. */
    has(frameId: string): boolean {
        return this.#entries.has(frameId);
    }

    /**
     * The composite of a frame, as `compositeFrame(doc, frameId)` returns it. The buffer
     * belongs to the cache: read it, do not write into it. Throws `RangeError` when the
     * document has no such frame.
     */
    get(frameId: string): PixelBuffer {
        const stack = layerStack(this.doc, frameId);
        const kept = this.#entries.get(frameId);
        if (kept && sameStack(kept.stack, stack)) {
            // Moved to the end: the most recently used.
            this.#entries.delete(frameId);
            this.#entries.set(frameId, kept);
            return kept.buffer;
        }
        if (kept) this.#drop(frameId, kept);
        const buffer = createPixelBuffer(stack.width, stack.height);
        const whole = { x: 0, y: 0, width: stack.width, height: stack.height };
        blendStack(stack, whole, buffer.data, false);
        this.#keep(frameId, { buffer, stack });
        return buffer;
    }

    /**
     * Keeps `buffer` as the composite of `frameId` in place of the one kept: a composite that
     * `compositeFrame` made outside the cache, such as the live composite of a stroke. It is
     * kept only when the frame's layer stack now is the one the buffer was composited from
     * (`compositeOrigin`: the same images, blended the same way, on a canvas of the same
     * size). Pixels written into those images since are the caller's to have composited into
     * it, as `invalidate` leaves pixel writes to its caller. Returns whether the buffer is
     * kept: not when its origin differs or is unknown, nor when it alone exceeds the budget;
     * a refused buffer leaves the kept composite as it was. The buffer then belongs to the
     * cache. Throws `RangeError` when the document has no such frame.
     */
    adopt(frameId: string, buffer: PixelBuffer): boolean {
        const stack = layerStack(this.doc, frameId);
        const origin = compositeOrigin(buffer);
        if (!origin || !sameStack(origin, stack)) return false;
        if (buffer.data.byteLength > this.budgetBytes) return false;
        const kept = this.#entries.get(frameId);
        if (kept) this.#drop(frameId, kept);
        this.#keep(frameId, { buffer, stack });
        return true;
    }

    /**
     * Drops the composites a change made out of date: those of `touched.frameIds`, or all of
     * them when `touched.structure` is set (SPEC §5.2). Frames that are not kept are ignored.
     */
    invalidate(touched: Touched): void {
        if (touched.structure) {
            this.clear();
            return;
        }
        for (const frameId of touched.frameIds) {
            const kept = this.#entries.get(frameId);
            if (kept) this.#drop(frameId, kept);
        }
    }

    /** Drops every composite. */
    clear(): void {
        this.#entries.clear();
        this.#bytes = 0;
    }

    #drop(frameId: string, entry: Entry): void {
        this.#entries.delete(frameId);
        this.#bytes -= entry.buffer.data.byteLength;
    }

    /** Keeps an entry as the most recently used, dropping the least recently used to fit it. */
    #keep(frameId: string, entry: Entry): void {
        const size = entry.buffer.data.byteLength;
        if (size > this.budgetBytes) return;
        for (const [oldest, kept] of this.#entries) {
            if (this.#bytes + size <= this.budgetBytes) break;
            this.#drop(oldest, kept);
        }
        this.#entries.set(frameId, entry);
        this.#bytes += size;
    }
}
