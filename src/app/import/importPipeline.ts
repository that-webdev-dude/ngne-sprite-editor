import {
    DEFAULT_ALPHA_THRESHOLD,
    ImportError,
    cachedCells,
    createImportCache,
    importSteps,
    smartDefaults,
} from "../../core/import";
import type { ImportCache, ImportSettings, ImportSource } from "../../core/import";
import type { Palette } from "../../core/model";
import type { PixelBuffer } from "../../core/pixels";
import type { SmartChoices } from "./importForm";

// The live preview's computation (SE-044), run in a worker (`importPreview.worker.ts`) or, for
// tests, in the page: the import of `core/import` in stages that keep their results
// (`importSteps`). One request at a time; a request that arrives while another is being
// computed cancels it: the computation stops at its next step, says so, and the newest
// request is computed.

/** The messages the page sends. */
export type PipelineRequest =
    /** The decoded source images, transferred; the cache starts again. */
    | { kind: "sources"; sources: ImportSource[] }
    /** Computes the import for these settings; steps 6 and 7 as `smart` says. */
    | { kind: "run"; id: number; settings: ImportSettings; smart: SmartChoices };

/** What it answers a `run` with. */
export type PipelineResponse =
    | {
          kind: "done";
          id: number;
          /** The settings used: steps 6 and 7 decided where they were smart. */
          settings: ImportSettings;
          frames: PixelBuffer[];
          palette: Palette;
      }
    | { kind: "failed"; id: number; message: string }
    /** A newer request came before this one was done. */
    | { kind: "cancelled"; id: number };

export interface PipelineHost {
    post(response: PipelineResponse): void;
    /** Resolves after the host has had the chance to deliver newer requests (a macrotask). */
    pause(): Promise<void>;
}

/** Steps 6 and 7 decided: the smart ones by `smartDefaults` for the cells. */
export function decideSmart(
    cells: readonly PixelBuffer[],
    settings: ImportSettings,
    smart: SmartChoices,
): ImportSettings {
    if (!smart.alpha && !smart.colors) return settings;
    const defaults = smartDefaults(cells, settings.size);
    const decided: ImportSettings = { ...settings };
    if (smart.alpha) {
        const { colorKey } = settings.alpha;
        const thresholds = defaults.alpha.threshold !== undefined;
        decided.alpha = {
            ...(thresholds && { threshold: smart.threshold || DEFAULT_ALPHA_THRESHOLD }),
            ...(colorKey && { colorKey }),
        };
    }
    if (smart.colors) {
        decided.colors =
            defaults.colors.mode === "keep"
                ? { mode: "keep" }
                : { mode: "reduce", count: smart.count };
    }
    return decided;
}

function messageOf(error: unknown): string {
    if (error instanceof ImportError) return error.message;
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/**
 * The computation's state and its message handler. `handle` returns at once; the computation
 * runs on in steps, `host.pause()` between them.
 */
export function createPipeline(host: PipelineHost) {
    const cache: ImportCache = createImportCache();
    let sources: ImportSource[] = [];
    /** The newest request not yet started. */
    let pending: Extract<PipelineRequest, { kind: "run" }> | null = null;
    let running = false;

    const compute = async (request: Extract<PipelineRequest, { kind: "run" }>) => {
        let settings: ImportSettings;
        try {
            const cells = cachedCells(cache, sources, request.settings);
            settings = decideSmart(cells, request.settings, request.smart);
        } catch (error) {
            host.post({ kind: "failed", id: request.id, message: messageOf(error) });
            return;
        }
        const steps = importSteps(cache, sources, settings);
        try {
            for (;;) {
                const step = steps.next();
                if (step.done) {
                    const { frames, palette } = step.value;
                    host.post({ kind: "done", id: request.id, settings, frames, palette });
                    return;
                }
                await host.pause();
                if (pending) {
                    steps.return(undefined as never);
                    host.post({ kind: "cancelled", id: request.id });
                    return;
                }
            }
        } catch (error) {
            host.post({ kind: "failed", id: request.id, message: messageOf(error) });
        }
    };

    const drain = async () => {
        if (running) return;
        running = true;
        try {
            while (pending) {
                const next = pending;
                pending = null;
                await compute(next);
            }
        } finally {
            running = false;
        }
    };

    return {
        handle(request: PipelineRequest): void {
            if (request.kind === "sources") {
                sources = request.sources;
                return;
            }
            if (pending) host.post({ kind: "cancelled", id: pending.id });
            pending = request;
            void drain();
        },
    };
}
