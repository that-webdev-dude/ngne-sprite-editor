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
    /** The budget the ticket states, in milliseconds. */
    budgetMs: number;
    /** The value compared with the budget, in milliseconds. */
    resultMs: number;
    /** The samples or summary statistics behind the result. */
    details: Record<string, unknown>;
}

export function record(entry: PerfEntry): void {
    const pass = entry.resultMs <= entry.budgetMs;
    console.log(
        `${entry.id}: ${entry.resultMs.toFixed(3)} ms (${entry.statistic}), ` +
            `budget ${entry.budgetMs} ms, ${pass ? "within" : "over"} budget`,
    );
    if (process.env.PERF_RECORD !== "1") return;

    const directory = fileURLToPath(new URL("../../docs/perf/", import.meta.url));
    mkdirSync(directory, { recursive: true });
    const processors = cpus();
    const file = {
        ...entry,
        pass,
        environment: {
            node: process.version,
            platform: `${platform()} ${release()}`,
            cpu: processors[0]?.model.trim() ?? "unknown",
            cores: processors.length,
            memoryGb: Math.round(totalmem() / 2 ** 30),
        },
        date: new Date().toISOString(),
    };
    writeFileSync(`${directory}${entry.id}.json`, `${JSON.stringify(file, null, 4)}\n`);
}
