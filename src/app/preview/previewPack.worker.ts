import { createPackState, handleBatch, handlePack } from "./previewPack";
import type { PackBatch, PackRequest, PackResponse } from "./previewPack";

// The preview's packing worker (SPEC §6.5): it keeps the composites it was sent, in batches
// or with a request, and answers each request with the packed atlas, whose pixels it
// transfers. A batch is not answered.

interface WorkerScope {
    onmessage: ((event: MessageEvent<PackRequest | PackBatch>) => void) | null;
    postMessage(message: PackResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const state = createPackState();

scope.onmessage = (event) => {
    const message = event.data;
    if ("kind" in message) {
        handleBatch(state, message);
        return;
    }
    let response: PackResponse;
    try {
        response = handlePack(state, message);
    } catch (error) {
        // Every request is answered, so the page never waits for a pack that will not come.
        const text = error instanceof Error ? error.message : String(error);
        response = { id: message.id, kind: "failed", message: text };
    }
    const transfer: Transferable[] =
        response.kind === "packed" ? [response.atlas.data.buffer as ArrayBuffer] : [];
    scope.postMessage(response, transfer);
};
