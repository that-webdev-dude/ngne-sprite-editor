import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { ImportSettings, ImportSource } from "../../core/import";
import type { Palette } from "../../core/model";
import type { PixelBuffer } from "../../core/pixels";
import type { SmartChoices } from "./importForm";
import { createPipeline } from "./importPipeline";
import type { PipelineRequest, PipelineResponse } from "./importPipeline";

// The live preview of the Import PNG dialog on the page side (SE-044): every change of a
// setting asks for the import again; the computation runs in a module worker
// (`importPreview.worker.ts`) and a newer request cancels an older one, so the controls stay
// responsive however long a computation takes. Only the newest request's answer is shown.

/** Where the computation runs: a worker, or the page itself for tests. */
export interface PreviewRunner {
    /** Sends a request; the pixels of `sources` are transferred. */
    send(request: PipelineRequest): void;
    /** The function the answers go to. */
    onResponse(listener: (response: PipelineResponse) => void): void;
    /** Calls `listener` when the runner fails for good (a worker that cannot run). */
    onFailure(listener: (message: string) => void): void;
    dispose(): void;
}

/** A runner over a new module worker. */
export function createWorkerRunner(): PreviewRunner {
    // Vite bundles the worker from this exact form (`new Worker(new URL(...))`).
    const worker = new Worker(new URL("./importPreview.worker.ts", import.meta.url), {
        type: "module",
    });
    let failure: ((message: string) => void) | null = null;
    worker.onerror = (event) => {
        event.preventDefault();
        failure?.(`The preview worker failed: ${event.message || "unknown error"}.`);
    };
    worker.onmessageerror = () =>
        failure?.("The preview worker sent a message that could not be read.");
    return {
        send(request) {
            const transfer =
                request.kind === "sources"
                    ? request.sources.map((source) => source.pixels.data.buffer as ArrayBuffer)
                    : [];
            worker.postMessage(request, transfer);
        },
        onResponse(listener) {
            worker.onmessage = (event: MessageEvent<PipelineResponse>) => listener(event.data);
        },
        onFailure(listener) {
            failure = listener;
        },
        dispose() {
            worker.terminate();
        },
    };
}

/** A runner on the page: the same computation, its pauses timers (tests in Node). */
export function createLocalRunner(): PreviewRunner {
    let listener: (response: PipelineResponse) => void = () => {};
    let disposed = false;
    const pipeline = createPipeline({
        post: (response) => {
            if (!disposed) listener(response);
        },
        pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });
    return {
        send: (request) => pipeline.handle(request),
        onResponse(next) {
            listener = next;
        },
        onFailure() {},
        dispose() {
            disposed = true;
        },
    };
}

/** The answer to the newest request. */
export interface PreviewResult {
    id: number;
    /** The settings of `core/import` it was made with, smart steps decided. */
    settings: ImportSettings;
    frames: PixelBuffer[];
    palette: Palette;
}

export interface PreviewState {
    /** True from a request until its answer. */
    computing: boolean;
    /** The answer to the newest request answered; null after a failure. */
    result: PreviewResult | null;
    /** Why the newest request answered failed; null otherwise. */
    error: string | null;
    /** Counts the answers shown (a result or an error). */
    revision: number;
}

export interface ImportPreview {
    readonly store: StoreApi<PreviewState>;
    /** The decoded sources; their pixels are copied, the copies transferred. */
    setSources(sources: readonly ImportSource[]): void;
    /** Asks for the import with these settings; returns the request's id. */
    request(settings: ImportSettings, smart: SmartChoices): number;
    /** Resolves with the answer to the newest request once it is there: null when it failed. */
    settled(): Promise<PreviewResult | null>;
    dispose(): void;
}

export function createImportPreview(runner: PreviewRunner = createWorkerRunner()): ImportPreview {
    const store = createStore<PreviewState>(() => ({
        computing: false,
        result: null,
        error: null,
        revision: 0,
    }));
    let latest = 0;
    let waiting: ((result: PreviewResult | null) => void)[] = [];
    const settle = (result: PreviewResult | null) => {
        const callbacks = waiting;
        waiting = [];
        for (const callback of callbacks) callback(result);
    };
    const fail = (message: string) => {
        store.setState((state) => ({
            computing: false,
            result: null,
            error: message,
            revision: state.revision + 1,
        }));
        settle(null);
    };
    runner.onResponse((response) => {
        if (response.id !== latest || response.kind === "cancelled") return;
        if (response.kind === "failed") {
            fail(response.message);
            return;
        }
        const result: PreviewResult = {
            id: response.id,
            settings: response.settings,
            frames: response.frames,
            palette: response.palette,
        };
        store.setState((state) => ({
            computing: false,
            result,
            error: null,
            revision: state.revision + 1,
        }));
        settle(result);
    });
    runner.onFailure(fail);

    return {
        store,
        setSources(sources) {
            runner.send({
                kind: "sources",
                sources: sources.map((source) => ({
                    name: source.name,
                    pixels: { ...source.pixels, data: source.pixels.data.slice() },
                })),
            });
        },
        request(settings, smart) {
            latest++;
            store.setState({ computing: true });
            runner.send({ kind: "run", id: latest, settings, smart });
            return latest;
        },
        settled() {
            const state = store.getState();
            if (!state.computing) {
                return Promise.resolve(state.result?.id === latest ? state.result : null);
            }
            return new Promise((resolve) => waiting.push(resolve));
        },
        dispose() {
            settle(null);
            runner.dispose();
        },
    };
}
