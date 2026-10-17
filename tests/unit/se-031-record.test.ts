import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { record, recordLine } from "../perf/record";
import type { PerfEntry } from "../perf/record";

// SE-031: a benchmark record with a budget says whether the result is within it, as before;
// one without a budget (the ticket states none) is for information: no `pass`, and the console
// says "no budget". The file is written only with PERF_RECORD=1, here into a directory of the
// test's own.

const entry = (budgetMs?: number): PerfEntry => ({
    id: "se-031-probe",
    ticket: "SE-031",
    measurement: "a probe",
    statistic: "p95 of 3",
    ...(budgetMs === undefined ? {} : { budgetMs }),
    resultMs: 12.3456,
    details: { samples: [1, 2, 3] },
});

let directory: string | null = null;

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
});

describe("record", () => {
    it("says within or over a budget, and 'no budget' without one", () => {
        expect(recordLine(entry(20))).toBe(
            "se-031-probe: 12.346 ms (p95 of 3), budget 20 ms, within budget",
        );
        expect(recordLine(entry(10))).toBe(
            "se-031-probe: 12.346 ms (p95 of 3), budget 10 ms, over budget",
        );
        expect(recordLine(entry())).toBe("se-031-probe: 12.346 ms (p95 of 3), no budget");
    });

    it("prints and writes nothing without PERF_RECORD=1", () => {
        directory = mkdtempSync(join(tmpdir(), "se-031-record-"));
        vi.stubEnv("PERF_RECORD", "");
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        record(entry(20), directory);
        expect(log).toHaveBeenCalledWith(recordLine(entry(20)));
        expect(() => readFileSync(join(directory!, "se-031-probe.json"))).toThrow();
    });

    it("writes `pass` with a budget, and no `pass` without one", () => {
        directory = mkdtempSync(join(tmpdir(), "se-031-record-"));
        vi.stubEnv("PERF_RECORD", "1");
        vi.spyOn(console, "log").mockImplementation(() => {});
        const read = () =>
            JSON.parse(readFileSync(join(directory!, "se-031-probe.json"), "utf8")) as Record<
                string,
                unknown
            >;

        record(entry(10), directory);
        const budgeted = read();
        expect(budgeted).toMatchObject({ budgetMs: 10, resultMs: 12.3456, pass: false });
        expect(Object.keys(budgeted)).toEqual([
            "id",
            "ticket",
            "measurement",
            "statistic",
            "budgetMs",
            "resultMs",
            "details",
            "pass",
            "environment",
            "date",
        ]);

        record(entry(), directory);
        const informational = read();
        expect(informational).not.toHaveProperty("pass");
        expect(informational).not.toHaveProperty("budgetMs");
        expect(informational).toMatchObject({ resultMs: 12.3456, details: { samples: [1, 2, 3] } });
        expect(informational).toHaveProperty("environment");
    });
});
