import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { record, recordLine } from "../perf/record";
import type { PerfEntry } from "../perf/record";
import { analysePlayback } from "../perf/se-024-analyse";
import type { PlaybackRecording } from "../perf/se-024-analyse";

// SE-024 review B and E: what the playback benchmark counts as skipped, on synthetic
// recordings, and a record whose result is a count.

const ORDER = Array.from({ length: 64 }, (_, index) => `f${index}`);

/** A recording of the active frames `frames` 100 ms apart, each drawn 10 ms after it began. */
function recording(frames: readonly number[], drawnToo = true): PlaybackRecording {
    const entries = frames.map((frame, index) => ({ frameId: `f${frame}`, at: index * 100 }));
    const drawn = drawnToo
        ? entries.map((entry) => ({ key: `${entry.frameId}:plain`, at: entry.at + 10 }))
        : [];
    return { entries, drawn };
}

describe("analysePlayback", () => {
    it("counts nothing skipped when each entry follows the one before and was drawn", () => {
        const result = analysePlayback(recording([62, 63, 0, 1, 2]), ORDER);
        expect(result.skipped).toEqual([]);
        expect(result.entries).toBe(5);
        expect(result.lateness).toEqual([10, 10, 10]);
    });

    it("counts an entry the clock jumped over: 10 → 12 is one skipped (11)", () => {
        const result = analysePlayback(recording([9, 10, 12, 13]), ORDER);
        expect(result.skipped).toEqual([{ frameId: "f11", at: 200, reason: "jumped" }]);
        expect(result.entries).toBe(5);
    });

    it("counts the jump across the end of the loop, and an entry no frame showed", () => {
        const data = recording([62, 1, 2, 3]);
        // f2 was the active frame, but no frame drawn showed it.
        const drawn = data.drawn.filter((frame) => frame.key !== "f2:plain");
        const result = analysePlayback({ ...data, drawn }, ORDER);
        expect(result.skipped).toEqual([
            { frameId: "f63", at: 100, reason: "jumped" },
            { frameId: "f0", at: 100, reason: "jumped" },
            { frameId: "f2", at: 200, reason: "not drawn" },
        ]);
        expect(result.entries).toBe(6);
    });

    it("refuses a frame outside the playing order", () => {
        expect(() => analysePlayback(recording([1, 99]), ORDER)).toThrow(/not playing/);
    });
});

describe("record with a count", () => {
    let directory: string | null = null;
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        if (directory) rmSync(directory, { recursive: true, force: true });
        directory = null;
    });

    const entry = (unit?: "ms" | "count"): PerfEntry => ({
        id: "se-024-probe",
        ticket: "SE-024",
        measurement: "a probe",
        statistic: "entries skipped of 126",
        budgetMs: 0,
        resultMs: 2,
        details: {},
        ...(unit ? { unit } : {}),
    });

    it("prints a count without ms, and milliseconds as before by default", () => {
        expect(recordLine(entry("count"))).toBe(
            "se-024-probe: 2 (entries skipped of 126), budget 0, over budget",
        );
        expect(recordLine(entry())).toBe(
            "se-024-probe: 2.000 ms (entries skipped of 126), budget 0 ms, over budget",
        );
        expect(recordLine(entry("ms"))).toBe(recordLine(entry()));
    });

    it("writes the unit when given, and nothing new otherwise", () => {
        directory = mkdtempSync(join(tmpdir(), "se-024-record-"));
        vi.stubEnv("PERF_RECORD", "1");
        vi.spyOn(console, "log").mockImplementation(() => {});
        const read = () =>
            JSON.parse(readFileSync(join(directory!, "se-024-probe.json"), "utf8")) as Record<
                string,
                unknown
            >;
        record(entry("count"), directory);
        expect(read()).toMatchObject({ unit: "count", resultMs: 2, pass: false });
        record(entry(), directory);
        expect(read()).not.toHaveProperty("unit");
    });
});
