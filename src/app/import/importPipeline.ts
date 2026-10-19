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
    /**
     * Pause only once this many milliseconds of work have passed since the last pause (by
     * `now`), not after every step: a pause costs a macrotask, and an import of 1024 cells has
     * some 2000 steps. The default is 0, a pause after every step.
     */
    pauseEveryMs?: number;
    /** The clock of `pauseEveryMs`; the default is `performance.now`. */
    now?(): number;
}

/** `smartDefaults`, or a function that answers as it does (a cache of it). */
export type SmartDefaults = typeof smartDefaults;

/** Steps 6 and 7 decided: the smart ones by `smartDefaults` for the cells. */
export function decideSmart(
    cells: readonly PixelBuffer[],
    settings: ImportSettings,
    smart: SmartChoices,
    defaultsOf: SmartDefaults = smartDefaults,
): ImportSettings {
    if (!smart.alpha && !smart.colors) return settings;
    const defaults = defaultsOf(cells, settings.size);
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
 * runs on in steps, `host.pause()` between them. `options.smartDefaults` replaces the
 * function the smart steps are decided by (tests count its calls).
 */
export function createPipeline(
    host: PipelineHost,
    options: { smartDefaults?: SmartDefaults } = {},
) {
    const cache: ImportCache = createImportCache();
    const computeDefaults = options.smartDefaults ?? smartDefaults;
    /**
     * The smart defaults of the cells kept in `cache` at one target size: a change that keeps
     * both does not scan the cells again (SE-044 review I). The cells are the same array as
     * long as the cache keeps them.
     */
    let defaults: {
        cells: readonly PixelBuffer[];
        width: number;
        height: number;
        value: ImportSettings;
    } | null = null;
    const cachedDefaults: SmartDefaults = (cells, size) => {
        const { width, height } = size;
        if (defaults?.cells !== cells || defaults.width !== width || defaults.height !== height) {
            defaults = null;
            defaults = { cells, width, height, value: computeDefaults(cells, size) };
        }
        return defaults.value;
    };
    let sources: ImportSource[] = [];
    /** The newest request not yet started. */
    let pending: Extract<PipelineRequest, { kind: "run" }> | null = null;
    let running = false;

    const compute = async (request: Extract<PipelineRequest, { kind: "run" }>) => {
        let settings: ImportSettings;
        try {
            const cells = cachedCells(cache, sources, request.settings);
            settings = decideSmart(cells, request.settings, request.smart, cachedDefaults);
        } catch (error) {
            host.post({ kind: "failed", id: request.id, message: messageOf(error) });
            return;
        }
        const steps = importSteps(cache, sources, settings);
        const every = host.pauseEveryMs ?? 0;
        const now = host.now ?? (() => performance.now());
        let paused = now();
        try {
            for (;;) {
                const step = steps.next();
                if (step.done) {
                    const { frames, palette } = step.value;
                    host.post({ kind: "done", id: request.id, settings, frames, palette });
                    return;
                }
                if (every > 0 && now() - paused < every) continue;
                await host.pause();
                paused = now();
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
