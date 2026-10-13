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
     * `failed(slot)` tells the two apart: it is true only after a rejected `texture()`.
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

type Outcome<Tag> =
    | { kind: "published"; tag: Tag }
    | { kind: "ignored" }
    /** "failed": `texture()` rejected. "unbuilt": the builder threw. */
    | { kind: "failed" | "unbuilt"; error: unknown };

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
 * - A rejection with "superseded" or an abort is ignored. Any other rejection goes to
 *   `onError` once and marks the slot failed: requests for it are dropped from then on,
 *   because it is retried only on a fresh renderer (with a fresh queue).
 * - `published(slot)` changes only when an upload resolves.
 * - `busy()` is true exactly while an upload that can still publish is in flight or waiting,
 *   and `idle()` resolves exactly when it is false, so `while (queue.busy()) await
 *   queue.idle()` always ends.
 * - The queue ends with its renderer: after `dispose` nothing is published and no callback
 *   is called, and it is not busy. Calls already inside `texture()` settle on their own;
 *   their bitmaps are still closed.
 * - A callback that throws is written to the console and does not stop its slot.
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

    /** True after `dispose`. */
    get disposed(): boolean {
        return this.#disposed;
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

    /**
     * True while an upload that can still publish is in flight or waiting, for `slot` or for
     * any slot. False at once after `dispose`, whatever is still inside `texture()`.
     */
    busy(slot?: string): boolean {
        if (this.#disposed) return false;
        if (slot !== undefined) return this.#slots.get(slot)?.running ?? false;
        for (const state of this.#slots.values()) if (state.running) return true;
        return false;
    }

    /** True once `texture()` failed for `slot`: it takes no more uploads on this renderer. */
    failed(slot: string): boolean {
        return this.#slots.get(slot)?.failed ?? false;
    }

    /** Resolves when `busy()` is false: at once when it already is. */
    idle(): Promise<void> {
        if (!this.busy()) return Promise.resolve();
        return new Promise((resolve) => this.#waiters.push(resolve));
    }

    /**
     * Ends the queue with its renderer: waiting requests are forgotten, uploads in flight are
     * aborted, nothing is published and no callback is called from here on. `busy()` is
     * false and every `idle()` resolves, at once. A call already inside `texture()` settles
     * on its own and its bitmap is closed then.
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

    /** A callback of the owner. One that throws is reported and does not stop the slot. */
    #call(callback: () => void): void {
        try {
            callback();
        } catch (error) {
            console.error("UploadQueue: a callback threw.", error);
        }
    }

    #ignored(error: unknown): boolean {
        if (this.#disposed || this.#abort.signal.aborted || isAbort(error)) return true;
        // NGNE: "Texture replacement superseded: <id>", "WebGPU renderer is disposed".
        return /superseded|disposed/i.test(messageOf(error));
    }

    async #run(slot: string, state: SlotState<Tag>): Promise<void> {
        state.running = true;
        try {
            // Not in the task of the request: every listener of the change that asked for
            // the upload has run before the builder reads the CPU state.
            await Promise.resolve();
            while (state.queued && !this.#disposed) {
                const build = state.queued;
                state.queued = null;
                this.stats.started++;
                this.#settled(slot, state, await this.#upload(slot, build));
            }
        } finally {
            // Whatever happened above, the slot is not left running and waiters are told.
            state.running = false;
            if (this.#disposed) state.queued = null;
            if (!this.busy()) this.#wake();
        }
    }

    /** Records what an upload ended with and tells the owner. Nothing after `dispose`. */
    #settled(slot: string, state: SlotState<Tag>, outcome: Outcome<Tag>): void {
        if (this.#disposed || outcome.kind === "ignored") {
            this.stats.ignored++;
            return;
        }
        if (outcome.kind === "published") {
            const { tag } = outcome;
            state.published = { tag };
            this.stats.published++;
            this.#call(() => this.#onPublish?.(slot, tag));
            return;
        }
        // A builder that threw says nothing about the renderer: only a rejected `texture()`
        // closes the slot.
        if (outcome.kind === "failed") {
            state.failed = true;
            state.queued = null;
        }
        this.stats.failed++;
        const { error } = outcome;
        this.#call(() => this.#onError?.(slot, error));
    }

    async #upload(slot: string, build: UploadBuilder<Tag>): Promise<Outcome<Tag>> {
        let upload: Upload<Tag>;
        try {
            upload = await build();
        } catch (error) {
            return { kind: "unbuilt", error };
        }
        try {
            if (this.#disposed) return { kind: "ignored" };
            await this.#target.texture(slot, upload.bitmap, this.#abort.signal);
            return { kind: "published", tag: upload.tag };
        } catch (error) {
            return this.#ignored(error) ? { kind: "ignored" } : { kind: "failed", error };
        } finally {
            upload.bitmap.close();
        }
    }
}
