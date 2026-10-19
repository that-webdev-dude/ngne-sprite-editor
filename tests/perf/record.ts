import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";

// A benchmark measures and calls `record`. The result is always printed; the file under
// docs/perf is written only with PERF_RECORD=1, which the orchestrator sets when it runs the
// measurement alone on the reference hardware (docs/tickets/EXECUTION.md, Measurements).

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
 * default) with the environment and the date, and `pass` when it has a budget.
 */
export function record(
    entry: PerfEntry,
    directory = fileURLToPath(new URL("../../docs/perf/", import.meta.url)),
): void {
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
