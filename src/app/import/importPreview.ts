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
    /** The id of the newest request; `result` answers it when `result.id` is this. */
    requested: number;
}

export interface ImportPreview {
    readonly store: StoreApi<PreviewState>;
    /**
     * The decoded sources. The page keeps its pixels (it shows the source and crops a kept
     * reference from it); the runner gets a copy, transferred.
     */
    setSources(sources: readonly ImportSource[]): void;
    /**
     * Asks for the import with these settings; returns the request's id. Settings equal to
     * the newest request's ask nothing again.
     */
    request(settings: ImportSettings, smart: SmartChoices): number;
    /** Resolves with the answer to the newest request once it is there: null when it failed. */
    settled(): Promise<PreviewResult | null>;
    /**
     * Ends the runner (the worker and what it holds: a copy of the sources and the steps'
     * results) once nothing more is asked: before an import is placed (SE-044 review E). A
     * later request starts a new one and sends it the sources again.
     */
    suspend(): void;
    dispose(): void;
}

/** A runner of its own for every start; the default makes a worker. */
export type RunnerFactory = () => PreviewRunner;

export function createImportPreview(
    createRunner: RunnerFactory = createWorkerRunner,
): ImportPreview {
    const store = createStore<PreviewState>(() => ({
        computing: false,
        result: null,
        error: null,
        revision: 0,
        requested: 0,
    }));
    let latest = 0;
    /** The settings of the newest request, as text: an equal request asks nothing. */
    let latestKey: string | null = null;
    let sources: readonly ImportSource[] = [];
    let runner: PreviewRunner | null = null;
    let disposed = false;
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
    const sendSources = (to: PreviewRunner) =>
        to.send({
            kind: "sources",
            sources: sources.map((source) => ({
                name: source.name,
                pixels: { ...source.pixels, data: source.pixels.data.slice() },
            })),
        });
    /** The running runner, started with the sources when there is none. */
    const running = (): PreviewRunner => {
        if (runner) return runner;
        const started = createRunner();
        started.onResponse((response) => {
            if (started !== runner) return;
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
        started.onFailure((message) => {
            if (started === runner) fail(message);
        });
        runner = started;
        sendSources(started);
        return started;
    };
    const stop = () => {
        runner?.dispose();
        runner = null;
        latestKey = null;
        if (store.getState().computing) {
            store.setState({ computing: false });
            settle(null);
        }
    };

    return {
        store,
        setSources(next) {
            sources = next;
            latestKey = null;
            if (disposed) return;
            // The copy is taken now; a runner started later takes one then.
            if (runner) sendSources(runner);
            else running();
        },
        request(settings, smart) {
            if (disposed) return latest;
            const key = JSON.stringify([settings, smart]);
            if (key === latestKey && runner) return latest;
            latestKey = key;
            latest++;
            store.setState({ computing: true, requested: latest });
            running().send({ kind: "run", id: latest, settings, smart });
            return latest;
        },
        settled() {
            const state = store.getState();
            if (!state.computing) {
                return Promise.resolve(state.result?.id === latest ? state.result : null);
            }
            return new Promise((resolve) => waiting.push(resolve));
        },
        suspend: stop,
        dispose() {
            disposed = true;
            stop();
            settle(null);
        },
    };
}
