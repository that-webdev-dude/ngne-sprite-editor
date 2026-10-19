import type { PreviewPacker } from "./previewController";
import type { PackResponse } from "./previewPack";

// The preview's packer on the page side: one module worker (`previewPack.worker.ts`) per
// mounted panel. Composites go to it as transferred copies; the packed atlas comes back
// transferred. The worker keeps the composites, so only changed frames are sent again.

/** A packer that runs in a new worker; `dispose` ends the worker. */
export function createWorkerPacker(): PreviewPacker {
    // Vite bundles the worker from this exact form (`new Worker(new URL(...))`).
    const worker = new Worker(new URL("./previewPack.worker.ts", import.meta.url), {
        type: "module",
    });
    const waiting = new Map<
        number,
        { resolve(response: PackResponse): void; reject(error: unknown): void }
    >();
    let failure: Error | null = null;

    const failAll = (error: Error) => {
        failure = error;
        for (const entry of waiting.values()) entry.reject(error);
        waiting.clear();
    };

    worker.onmessage = (event: MessageEvent<PackResponse>) => {
        const entry = waiting.get(event.data.id);
        waiting.delete(event.data.id);
        entry?.resolve(event.data);
    };
    worker.onerror = (event) => {
        event.preventDefault();
        failAll(
            new Error(`The preview's packing worker failed: ${event.message || "unknown error"}.`),
        );
    };
    worker.onmessageerror = () =>
        failAll(new Error("The preview's packing worker sent a message that could not be read."));

    return {
        pack(request) {
            if (failure) return Promise.reject(failure);
            return new Promise((resolve, reject) => {
                waiting.set(request.id, { resolve, reject });
                const transfer = request.frames.map((frame) => frame.data.buffer as ArrayBuffer);
                worker.postMessage(request, transfer);
            });
        },
        dispose() {
            worker.terminate();
            failAll(new Error("The preview's packing worker was ended."));
        },
    };
}
