import { createPipeline } from "./importPipeline";
import type { PipelineRequest, PipelineResponse } from "./importPipeline";

// The Import PNG dialog's preview worker (SE-044): it keeps the decoded sources it was sent
// and answers each `run` with the frames and the palette, whose pixels it transfers. A newer
// `run` cancels the one being computed (`importPipeline.ts`).

interface WorkerScope {
    onmessage: ((event: MessageEvent<PipelineRequest>) => void) | null;
    postMessage(message: PipelineResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

/** A macrotask: the messages that arrived meanwhile are delivered first. */
function pause(): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}

const pipeline = createPipeline({
    post(response) {
        const transfer: Transferable[] =
            response.kind === "done"
                ? response.frames.map((frame) => frame.data.buffer as ArrayBuffer)
                : [];
        scope.postMessage(response, transfer);
    },
    pause,
    // A newer request waits at most about this long for the computation to notice it.
    pauseEveryMs: 8,
});

scope.onmessage = (event) => pipeline.handle(event.data);
