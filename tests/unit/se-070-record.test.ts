import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PerfEntry } from "../perf/record";

// SE-070: PERF_ID records one run of a benchmark under a name of its own (for the cloud run,
// `se-070-<scenario>-cloud-swiftshader`), keeping the benchmark's id as `benchmarkId`; without
// it a benchmark prints and writes exactly what it did before. The record module is loaded
// afresh for each test, as each benchmark file is in its own process.

const entry = (id = "se-015-stroke-latency-swiftshader"): PerfEntry => ({
    id,
    ticket: "SE-015",
    measurement: "a probe",
    statistic: "p95 of 3",
    budgetMs: 33,
    resultMs: 12.5,
    details: { samples: [1, 2, 3] },
});

let directory = "";

async function load() {
    vi.resetModules();
    return import("../perf/record");
}

beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "se-070-record-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
});

const read = (name: string) =>
    JSON.parse(readFileSync(join(directory, name), "utf8")) as Record<string, unknown>;

describe("record with PERF_ID", () => {
    it("without PERF_ID writes the benchmark's own id and no benchmarkId, as before", async () => {
        vi.stubEnv("PERF_RECORD", "1");
        vi.stubEnv("PERF_ID", "");
        const { record } = await load();
        record(entry(), directory);
        expect(readdirSync(directory)).toEqual(["se-015-stroke-latency-swiftshader.json"]);
        const written = read("se-015-stroke-latency-swiftshader.json");
        expect(written.id).toBe("se-015-stroke-latency-swiftshader");
        expect(written).not.toHaveProperty("benchmarkId");
    });

    it("writes and prints the record under PERF_ID, with the benchmark's id kept", async () => {
        vi.stubEnv("PERF_RECORD", "1");
        vi.stubEnv("PERF_ID", "se-070-stroke-cloud-swiftshader");
        const { record, recordLine } = await load();
        record(entry(), directory);
        expect(readdirSync(directory)).toEqual(["se-070-stroke-cloud-swiftshader.json"]);
        expect(read("se-070-stroke-cloud-swiftshader.json")).toMatchObject({
            id: "se-070-stroke-cloud-swiftshader",
            benchmarkId: "se-015-stroke-latency-swiftshader",
            ticket: "SE-015",
            resultMs: 12.5,
            pass: true,
        });
        expect(console.log).toHaveBeenCalledWith(
            recordLine({ ...entry(), id: "se-070-stroke-cloud-swiftshader" }),
        );
    });

    it("prints under PERF_ID and writes nothing without PERF_RECORD=1", async () => {
        vi.stubEnv("PERF_RECORD", "");
        vi.stubEnv("PERF_ID", "se-070-idle-cloud-swiftshader");
        const { record } = await load();
        record(entry(), directory);
        expect(readdirSync(directory)).toEqual([]);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringMatching(/^se-070-idle-cloud-swiftshader: 12\.500 ms/),
        );
    });

    it("refuses a PERF_ID that is not a plain file name", async () => {
        vi.stubEnv("PERF_RECORD", "1");
        for (const id of ["../se-070-x", "se-070/x", "SE-070-X", "se-070--x", "-x", "a b"]) {
            vi.stubEnv("PERF_ID", id);
            const { record } = await load();
            expect(() => record(entry(), directory), id).toThrow(/not a plain file name/);
        }
        expect(readdirSync(directory)).toEqual([]);
    });

    it("refuses a second record under the same PERF_ID in one process", async () => {
        vi.stubEnv("PERF_RECORD", "1");
        vi.stubEnv("PERF_ID", "se-070-frame-switch-cloud-swiftshader");
        const { record } = await load();
        record(entry("se-070-a"), directory);
        expect(() => record(entry("se-070-b"), directory)).toThrow(/already holds the record/);
        expect(read("se-070-frame-switch-cloud-swiftshader.json").benchmarkId).toBe("se-070-a");
    });
});
