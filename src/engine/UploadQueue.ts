// The upload queue of SPEC §6.4, one per renderer instance. NGNE uploads a whole image
// asynchronously, and a second `texture()` call for an ID rejects the first (SPEC §6.2 #2, #3),
// so every upload of a slot goes through here: one in flight per slot, the newest request
// wins. Used by the viewport and by the preview panel (SE-054).

/** What the queue needs of a renderer: `WebGPURenderer.texture` (SPEC §6.1). */
export interface TextureTarget {
    texture(id: string, source: ImageBitmap, signal?: AbortSignal): Promise<void>;
}

/** One image for a slot. */
export interface Upload<Tag> {
    /** The source. The queue closes it when the upload settles, whatever the outcome. */
    bitmap: ImageBitmap;
    /**
     * What the image is: the key of a frame, the frame rectangles of an atlas. It becomes
     * `published(slot)` when the upload resolves and not before, so whoever draws from it
     * never pairs new metadata with the old texture.
     */
    tag: Tag;
}

/**
 * Makes the image of a request. It runs when the upload starts, not when it is requested, so
 * it reads the newest CPU state; a request replaced before its turn is never built.
 */
export type UploadBuilder<Tag> = () => Upload<Tag> | Promise<Upload<Tag>>;

export interface UploadQueueOptions<Tag> {
    target: TextureTarget;
    /** An upload resolved: the texture of `slot` now shows what `tag` describes. */
    onPublish?(slot: string, tag: Tag): void;
    /**
     * A builder threw, or `texture()` rejected for a reason other than "superseded", an abort
     * or a disposed renderer. Called once per failure; the upload is not tried again.
     */
    onError?(slot: string, error: unknown): void;
}

/** Counters of a queue, for tests and measurements. */
export interface UploadQueueStats {
    /** `request` calls accepted. */
    requested: number;
    /** Requests replaced by a newer one before their upload started. */
    replaced: number;
    /** Requests dropped because their slot had failed on this renderer. */
    dropped: number;
    /** Uploads started (builder called). */
    started: number;
    /** Uploads that resolved. */
    published: number;
    /** Rejections ignored: superseded, aborted, or after the queue was disposed. */
    ignored: number;
    /** Failures handed to `onError`. */
    failed: number;
}

interface SlotState<Tag> {
    /** An upload of this slot is in flight, or about to start. */
    running: boolean;
    /** The newest request that has not started. */
    queued: UploadBuilder<Tag> | null;
    /** The last upload that resolved. */
    published: { tag: Tag } | null;
    /** `texture()` failed: no further upload on this renderer. */
    failed: boolean;
}

function messageOf(error: unknown): string {
    if (typeof error === "object" && error !== null && "message" in error) {
        return String(error.message);
    }
    return String(error);
}

function isAbort(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error
        ? error.name === "AbortError"
        : false;
}

/**
 * Single-flight, latest-wins uploads into the texture slots of one renderer (SPEC §6.4):
 *
 * - One upload in flight per slot. A request made meanwhile waits; a newer one replaces it.
 *   Slots do not wait for each other.
 * - The source bitmap is closed when its upload settles.
 * - A rejection with "superseded", an abort, or anything after `dispose` is ignored. Any other
 *   rejection goes to `onError` once and marks the slot failed: requests for it are dropped
 *   from then on, because it is retried only on a fresh renderer (with a fresh queue).
 * - `published(slot)` changes only when an upload resolves.
 */
export class UploadQueue<Tag> {
    readonly stats: UploadQueueStats = {
        requested: 0,
        replaced: 0,
        dropped: 0,
        started: 0,
        published: 0,
        ignored: 0,
        failed: 0,
    };
    readonly #target: TextureTarget;
    readonly #onPublish: ((slot: string, tag: Tag) => void) | undefined;
    readonly #onError: ((slot: string, error: unknown) => void) | undefined;
    readonly #slots = new Map<string, SlotState<Tag>>();
    readonly #abort = new AbortController();
    #waiters: (() => void)[] = [];
    #disposed = false;

    constructor(options: UploadQueueOptions<Tag>) {
        this.#target = options.target;
        this.#onPublish = options.onPublish;
        this.#onError = options.onError;
    }

    /**
     * Asks for `slot` to show the image `build` makes. The upload starts in a later
     * microtask at the earliest, so of several requests made in one task only the last is
     * built. Ignored after `dispose` and for a failed slot.
     */
    request(slot: string, build: UploadBuilder<Tag>): void {
        if (this.#disposed) return;
        const state = this.#state(slot);
        if (state.failed) {
            this.stats.dropped++;
            return;
        }
        this.stats.requested++;
        if (state.queued) this.stats.replaced++;
        state.queued = build;
        if (!state.running) void this.#run(slot, state);
    }

    /** The tag of the last upload of `slot` that resolved; undefined until the first one. */
    published(slot: string): Tag | undefined {
        return this.#slots.get(slot)?.published?.tag;
    }

    /** True while a request for `slot` has not started: its texture is about to be replaced. */
    pending(slot: string): boolean {
        return this.#slots.get(slot)?.queued != null;
    }

    /** True while an upload of `slot` is in flight or waiting. */
    busy(slot?: string): boolean {
        if (slot !== undefined) return this.#slots.get(slot)?.running ?? false;
        for (const state of this.#slots.values()) if (state.running) return true;
        return false;
    }

    /** True once `texture()` failed for `slot`: it takes no more uploads on this renderer. */
    failed(slot: string): boolean {
        return this.#slots.get(slot)?.failed ?? false;
    }

    /** Resolves when no slot has an upload in flight or waiting; at once after `dispose`. */
    idle(): Promise<void> {
        if (this.#disposed || !this.busy()) return Promise.resolve();
        return new Promise((resolve) => this.#waiters.push(resolve));
    }

    /**
     * Ends the queue with its renderer: waiting requests are forgotten, uploads in flight are
     * aborted and whatever they settle with is ignored. Their bitmaps are still closed.
     */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        for (const state of this.#slots.values()) state.queued = null;
        this.#abort.abort();
        this.#wake();
    }

    #state(slot: string): SlotState<Tag> {
        let state = this.#slots.get(slot);
        if (!state) {
            state = { running: false, queued: null, published: null, failed: false };
            this.#slots.set(slot, state);
        }
        return state;
    }

    #wake(): void {
        for (const resolve of this.#waiters.splice(0)) resolve();
    }

    #ignored(error: unknown): boolean {
        if (this.#disposed || this.#abort.signal.aborted || isAbort(error)) return true;
        // NGNE: "Texture replacement superseded: <id>", "WebGPU renderer is disposed".
        return /superseded|disposed/i.test(messageOf(error));
    }

    async #run(slot: string, state: SlotState<Tag>): Promise<void> {
        state.running = true;
        // Not in the task of the request: every listener of the change that asked for the
        // upload has run before the builder reads the CPU state.
        await Promise.resolve();
        while (state.queued && !this.#disposed) {
            const build = state.queued;
            state.queued = null;
            this.stats.started++;
            const outcome = await this.#upload(slot, build);
            if (outcome.kind === "published") {
                state.published = { tag: outcome.tag };
                this.stats.published++;
                this.#onPublish?.(slot, outcome.tag);
            } else if (outcome.kind === "ignored") {
                this.stats.ignored++;
            } else {
                // A builder that threw says nothing about the renderer: only a failed
                // `texture()` closes the slot.
                if (outcome.kind === "failed") {
                    state.failed = true;
                    state.queued = null;
                }
                this.stats.failed++;
                this.#onError?.(slot, outcome.error);
            }
        }
        state.queued = null;
        state.running = false;
        if (!this.busy()) this.#wake();
    }

    async #upload(
        slot: string,
        build: UploadBuilder<Tag>,
    ): Promise<
        | { kind: "published"; tag: Tag }
        | { kind: "ignored" }
        | { kind: "failed" | "unbuilt"; error: unknown }
    > {
        let upload: Upload<Tag>;
        try {
            upload = await build();
        } catch (error) {
            return this.#disposed ? { kind: "ignored" } : { kind: "unbuilt", error };
        }
        try {
            if (this.#disposed) return { kind: "ignored" };
            await this.#target.texture(slot, upload.bitmap, this.#abort.signal);
            return this.#disposed ? { kind: "ignored" } : { kind: "published", tag: upload.tag };
        } catch (error) {
            return this.#ignored(error) ? { kind: "ignored" } : { kind: "failed", error };
        } finally {
            upload.bitmap.close();
        }
    }
}
