import { createPackState, handlePack } from "./previewPack";
import type { PackRequest, PackResponse } from "./previewPack";

// The preview's packing worker (SPEC §6.5): it keeps the composites it was sent and answers
// each request with the packed atlas, whose pixels it transfers.

interface WorkerScope {
    onmessage: ((event: MessageEvent<PackRequest>) => void) | null;
    postMessage(message: PackResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const state = createPackState();

scope.onmessage = (event) => {
    let response: PackResponse;
    try {
        response = handlePack(state, event.data);
    } catch (error) {
        // Every request is answered, so the page never waits for a pack that will not come.
        const message = error instanceof Error ? error.message : String(error);
        response = { id: event.data.id, kind: "failed", message };
    }
    const transfer: Transferable[] =
        response.kind === "packed" ? [response.atlas.data.buffer as ArrayBuffer] : [];
    scope.postMessage(response, transfer);
};
