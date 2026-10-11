import type { WebGPURenderer } from "@ngne/core";

interface Job<T> {
    readonly build: () => Promise<ImageBitmap>;
    readonly tag: T;
}

interface Slot<T> {
    running: boolean;
    queued?: Job<T>;
}

/**
 * The upload queue of SPEC §6.4: one in-flight upload per slot, a newer request replaces the
 * queued one, and the source bitmap is closed when its upload settles.
 */
export class UploadQueue<T> {
    readonly stats = { requested: 0, started: 0, published: 0, replaced: 0, failed: 0 };
    private readonly slots = new Map<string, Slot<T>>();
    private readonly renderer: WebGPURenderer;
    private readonly onPublish: (id: string, tag: T) => void;
    private readonly onError: (id: string, error: unknown) => void;
    private waiters: (() => void)[] = [];

    constructor(
        renderer: WebGPURenderer,
        onPublish: (id: string, tag: T) => void,
        onError: (id: string, error: unknown) => void,
    ) {
        this.renderer = renderer;
        this.onPublish = onPublish;
        this.onError = onError;
    }

    /** `build` runs when the upload starts, so it reads the newest CPU state. */
    request(id: string, build: () => Promise<ImageBitmap>, tag: T): void {
        this.stats.requested++;
        let slot = this.slots.get(id);
        if (!slot) {
            slot = { running: false };
            this.slots.set(id, slot);
        }
        if (slot.running) {
            if (slot.queued) this.stats.replaced++;
            slot.queued = { build, tag };
            return;
        }
        void this.run(id, slot, { build, tag });
    }

    /** Resolves when no slot has an upload in flight or queued. */
    idle(): Promise<void> {
        if (![...this.slots.values()].some((slot) => slot.running)) return Promise.resolve();
        return new Promise((resolve) => this.waiters.push(resolve));
    }

    private async run(id: string, slot: Slot<T>, first: Job<T>): Promise<void> {
        slot.running = true;
        for (let job: Job<T> | undefined = first; job;) {
            this.stats.started++;
            let bitmap: ImageBitmap | undefined;
            try {
                bitmap = await job.build();
                await this.renderer.texture(id, bitmap);
                this.stats.published++;
                this.onPublish(id, job.tag);
            } catch (error) {
                this.stats.failed++;
                this.onError(id, error);
            } finally {
                bitmap?.close();
            }
            job = slot.queued;
            slot.queued = undefined;
        }
        slot.running = false;
        if (![...this.slots.values()].some((other) => other.running))
            for (const resolve of this.waiters.splice(0)) resolve();
    }
}
