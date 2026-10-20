import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";

// A benchmark measures and calls `record`. The result is always printed; the file under
// docs/perf is written only with PERF_RECORD=1, which the orchestrator sets when it runs the
// measurement alone on the reference hardware (docs/tickets/EXECUTION.md, Measurements).
//
// PERF_ID (SE-070) names one run's record: with it, the record is printed and written under
// that id instead of the benchmark's own, which it keeps as `benchmarkId`. A run on other
// hardware is then recorded beside the reference records without replacing them, for example
// `PERF_ID=se-070-stroke-cloud-swiftshader` (tests/perf/README.md). Without PERF_ID nothing
// changes. A process records once under a PERF_ID: a second record would replace the first.

export interface PerfEntry {
    /** File name under docs/perf without extension, for example `se-010-dirty-rectangle`. */
    id: string;
    ticket: string;
    /** What was measured, in one sentence. */
    measurement: string;
    /** How `resultMs` was taken from the samples, for example `median of 200 runs`. */
    statistic: string;
    /**
     * The budget the ticket or the SPEC states, in milliseconds. Without one the record is
     * for information: it has no `pass`, and the console says "no budget" (SE-031).
     */
    budgetMs?: number;
    /** The value compared with the budget, in milliseconds. */
    resultMs: number;
    /** The samples or summary statistics behind the result. */
    details: Record<string, unknown>;
    /**
     * What `resultMs` and `budgetMs` count: milliseconds (the default, when absent) or a
     * number of things, such as frames skipped (SE-024 review E). Written to the record only
     * when given.
     */
    unit?: "ms" | "count";
}

/** What PERF_ID may be: a file name of lowercase letters, digits and single hyphens. */
const PERF_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The benchmark id last recorded under the current PERF_ID in this process. */
let recordedUnderId: { perfId: string; benchmarkId: string } | null = null;

/**
 * The entry as it is printed and written: under PERF_ID when that is set, with the
 * benchmark's own id as `benchmarkId`. Throws for a PERF_ID that is no plain file name, and
 * for a second record under the same PERF_ID in one process.
 */
export function namedEntry(entry: PerfEntry): PerfEntry & { benchmarkId?: string } {
    const perfId = process.env.PERF_ID ?? "";
    if (perfId === "") return entry;
    if (!PERF_ID_PATTERN.test(perfId)) {
        throw new Error(`PERF_ID "${perfId}" is not a plain file name (a-z, 0-9, hyphens).`);
    }
    if (recordedUnderId?.perfId === perfId) {
        throw new Error(
            `PERF_ID "${perfId}" already holds the record of ${recordedUnderId.benchmarkId}; ` +
                `${entry.id} would replace it. Run one benchmark per PERF_ID.`,
        );
    }
    recordedUnderId = { perfId, benchmarkId: entry.id };
    return { ...entry, id: perfId, benchmarkId: entry.id };
}

/** The console line of a record. */
export function recordLine(entry: PerfEntry): string {
    const count = entry.unit === "count";
    const shown = count ? String(entry.resultMs) : `${entry.resultMs.toFixed(3)} ms`;
    const result = `${entry.id}: ${shown} (${entry.statistic})`;
    if (entry.budgetMs === undefined) return `${result}, no budget`;
    const pass = entry.resultMs <= entry.budgetMs;
    const budget = count ? String(entry.budgetMs) : `${entry.budgetMs} ms`;
    return `${result}, budget ${budget}, ${pass ? "within" : "over"} budget`;
}

/**
 * Prints `entry`, and with PERF_RECORD=1 writes it to `<directory>/<id>.json` (docs/perf by
 * default) with the environment and the date, and `pass` when it has a budget. With PERF_ID
 * the id is PERF_ID's (`namedEntry`).
 */
export function record(
    benchmarkEntry: PerfEntry,
    directory = fileURLToPath(new URL("../../docs/perf/", import.meta.url)),
): void {
    const entry = namedEntry(benchmarkEntry);
    console.log(recordLine(entry));
    if (process.env.PERF_RECORD !== "1") return;

    mkdirSync(directory, { recursive: true });
    const processors = cpus();
    const file = {
        ...entry,
        ...(entry.budgetMs === undefined ? {} : { pass: entry.resultMs <= entry.budgetMs }),
        environment: {
            node: process.version,
            platform: `${platform()} ${release()}`,
            cpu: processors[0]?.model.trim() ?? "unknown",
            cores: processors.length,
            memoryGb: Math.round(totalmem() / 2 ** 30),
        },
        date: new Date().toISOString(),
    };
    const separator = directory.endsWith("/") || directory.endsWith("\\") ? "" : "/";
    writeFileSync(`${directory}${separator}${entry.id}.json`, `${JSON.stringify(file, null, 4)}\n`);
}
