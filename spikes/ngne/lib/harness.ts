import { trackDevices, type DeviceTracker } from "./gpu.ts";
import type { Check, PageResult, SummaryLine } from "./types.ts";

export interface Spike {
    readonly params: URLSearchParams;
    readonly tracker: DeviceTracker;
    /** Label of this run within its question (for example the device pixel ratio). */
    variant: string;
    /** A check that decides go / no-go. */
    check(name: string, pass: boolean, detail?: string): void;
    /** A recorded observation that does not decide go / no-go. */
    info(name: string, pass: boolean, detail?: string): void;
    metric(key: string, value: unknown): void;
    samples(key: string, values: readonly number[]): void;
    summary(label: string, value: string): void;
    note(text: string): void;
    log(text: string): void;
    /** Publishes a stage name the runner can wait for. */
    stage(name: string): void;
}

interface SpikeWindow {
    __spikeResult?: PageResult;
    __spikeStage?: string;
}

const scope = window as unknown as SpikeWindow;

export function describeError(error: unknown): string {
    if (error instanceof AggregateError)
        return [error.message, ...error.errors.map(describeError)].join(" | ");
    if (error instanceof Error)
        return error.message + (error.cause ? " <- " + describeError(error.cause) : "");
    if (typeof error === "object" && error !== null) {
        try {
            return JSON.stringify(error);
        } catch {
            return Object.prototype.toString.call(error);
        }
    }
    return String(error);
}

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export function nextFrame(): Promise<number> {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves in a new task without the 4 ms clamp of nested timers. */
export function nextTask(): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(0);
    });
}

export interface Stats {
    n: number;
    min: number;
    median: number;
    mean: number;
    p95: number;
    p99: number;
    max: number;
}

/** Percentile by the nearest-rank method on the sorted samples. */
export function percentile(sorted: readonly number[], p: number): number {
    if (!sorted.length) return Number.NaN;
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? Number.NaN;
}

export function summarize(values: readonly number[]): Stats {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
        n: sorted.length,
        min: round2(sorted[0] ?? Number.NaN),
        median: round2(percentile(sorted, 50)),
        mean: round2(sum / sorted.length),
        p95: round2(percentile(sorted, 95)),
        p99: round2(percentile(sorted, 99)),
        max: round2(sorted[sorted.length - 1] ?? Number.NaN),
    };
}

export function integerParam(params: URLSearchParams, name: string, fallback: number): number {
    const raw = params.get(name);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Runs one spike page and publishes its machine-readable result on `window.__spikeResult`
 * (and as JSON in `#result`). The device tracker is installed before `body` runs.
 */
export function runSpike(question: number, body: (spike: Spike) => Promise<void>): void {
    const started = performance.now();
    const checks: Check[] = [];
    const summary: SummaryLine[] = [];
    const metrics: Record<string, unknown> = {};
    const samples: Record<string, number[]> = {};
    const notes: string[] = [];
    const uncaught: string[] = [];
    const logElement = document.querySelector("#log");
    const tracker = trackDevices();

    window.addEventListener("error", (event) => {
        uncaught.push("error: " + describeError(event.error ?? event.message));
    });
    window.addEventListener("unhandledrejection", (event) => {
        uncaught.push("unhandledrejection: " + describeError(event.reason));
    });

    const params = new URLSearchParams(location.search);
    const spike: Spike = {
        params,
        tracker,
        variant: params.get("variant") ?? "",
        check: (name, pass, detail = "") => checks.push({ name, pass, binding: true, detail }),
        info: (name, pass, detail = "") => checks.push({ name, pass, binding: false, detail }),
        metric: (key, value) => {
            metrics[key] = value;
        },
        samples: (key, values) => {
            samples[key] = values.map(round2);
        },
        summary: (label, value) => summary.push({ label, value }),
        note: (text) => notes.push(text),
        log: (text) => {
            console.log(`[q${question}] ${text}`);
            if (logElement) logElement.textContent += text + "\n";
        },
        stage: (name) => {
            scope.__spikeStage = name;
        },
    };

    const finish = () => {
        checks.push({
            name: "No uncaught page error",
            pass: uncaught.length === 0,
            binding: true,
            detail: uncaught.join(" || "),
        });
        const result: PageResult = {
            question,
            variant: spike.variant,
            pass: checks.every((check) => check.pass || !check.binding),
            checks,
            summary,
            metrics,
            samples,
            uncaught,
            adapters: tracker.adapters(),
            notes,
            page: {
                url: location.pathname + location.search,
                devicePixelRatio,
                viewport: [innerWidth, innerHeight],
                screen: [screen.width, screen.height],
                visibility: document.visibilityState,
            },
            durationMs: Math.round(performance.now() - started),
        };
        const output = document.querySelector("#result");
        if (output) output.textContent = JSON.stringify(result, null, 2);
        document.title = `${result.pass ? "PASS" : "FAIL"} ${document.title}`;
        scope.__spikeResult = result;
    };

    body(spike)
        .catch((error: unknown) => {
            checks.push({
                name: "Page ran to completion",
                pass: false,
                binding: true,
                detail: describeError(error),
            });
        })
        .finally(finish);
}
