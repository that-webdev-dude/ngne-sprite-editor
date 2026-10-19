import { describe, expect, it, vi } from "vitest";
import { createPipeline, decideSmart } from "../../src/app/import/importPipeline";
import type { PipelineResponse } from "../../src/app/import/importPipeline";
import type { PreviewRunner } from "../../src/app/import/importPreview";
import { createImportPreview, createLocalRunner } from "../../src/app/import/importPreview";
import type { SmartChoices } from "../../src/app/import/importForm";
import { runImport, smartDefaults } from "../../src/core/import";
import type { ImportSettings, ImportSource } from "../../src/core/import";
import { noise } from "./se-043-support";

// SE-044: the live preview. The computation runs in steps; a newer request cancels the one
// being computed at its next step, and only the newest request's answer is shown.

const sources: ImportSource[] = [{ name: "sheet.png", pixels: noise(64, 16, 3) }];

const settings: ImportSettings = {
    cells: { mode: "grid", grid: { cell: { columns: 4, rows: 1 } } },
    size: { width: 8, height: 8, fit: "contain" },
    resample: "area",
    alpha: {},
    colors: { mode: "reduce", count: 6 },
    dither: "none",
};
const explicit: SmartChoices = { alpha: false, colors: false, threshold: 128, count: 16 };

/** A host that records the answers; its pauses resolve when `step` is called. */
function steppedHost() {
    const responses: PipelineResponse[] = [];
    let waiting: (() => void)[] = [];
    return {
        responses,
        host: {
            post: (response: PipelineResponse) => responses.push(response),
            pause: () => new Promise<void>((resolve) => waiting.push(resolve)),
        },
        /** Lets every paused computation take its next step. */
        async step() {
            const resume = waiting;
            waiting = [];
            for (const resolve of resume) resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));
        },
        async finish() {
            for (let i = 0; i < 100 && waiting.length > 0; i++) await this.step();
        },
    };
}

describe("the preview pipeline", () => {
    it("a newer request cancels the one being computed, which stops at its next step", async () => {
        const recorder = steppedHost();
        const pipeline = createPipeline(recorder.host);
        pipeline.handle({ kind: "sources", sources });
        pipeline.handle({ kind: "run", id: 1, settings, smart: explicit });
        // The first computation has made its cells and waits at a pause.
        expect(recorder.responses).toEqual([]);
        const changed: ImportSettings = { ...settings, dither: "floyd-steinberg" };
        pipeline.handle({ kind: "run", id: 2, settings: changed, smart: explicit });
        await recorder.finish();

        expect(recorder.responses.map((response) => [response.kind, response.id])).toEqual([
            ["cancelled", 1],
            ["done", 2],
        ]);
        const done = recorder.responses[1] as Extract<PipelineResponse, { kind: "done" }>;
        const expected = runImport(sources, changed);
        expect(done.palette).toEqual(expected.palette);
        expect(done.frames.map((frame) => [...frame.data])).toEqual(
            expected.frames.map((frame) => [...frame.data]),
        );
    });

    it("of several requests made while one is computed, only the newest is computed", async () => {
        const recorder = steppedHost();
        const pipeline = createPipeline(recorder.host);
        pipeline.handle({ kind: "sources", sources });
        for (let id = 1; id <= 4; id++) {
            pipeline.handle({ kind: "run", id, settings, smart: explicit });
        }
        await recorder.finish();
        expect(recorder.responses.map((response) => [response.kind, response.id])).toEqual([
            ["cancelled", 2],
            ["cancelled", 3],
            ["cancelled", 1],
            ["done", 4],
        ]);
    });

    it("with pauseEveryMs, pauses only once that much time has passed since the last pause", async () => {
        let clock = 0;
        let pauses = 0;
        const responses: PipelineResponse[] = [];
        const pipeline = createPipeline({
            post: (response) => responses.push(response),
            pause: () => {
                pauses++;
                return new Promise((resolve) => setTimeout(resolve, 0));
            },
            pauseEveryMs: 10,
            // Every step takes 4 ms: a pause after every third step.
            now: () => (clock += 4),
        });
        pipeline.handle({ kind: "sources", sources });
        pipeline.handle({ kind: "run", id: 1, settings, smart: explicit });
        await vi.waitFor(() => expect(responses).toHaveLength(1), { timeout: 5000 });
        expect(responses.map((response) => response.kind)).toEqual(["done"]);
        // Ten steps (cells, four frames, palette, four mappings); without the budget, ten pauses.
        expect(pauses).toBeGreaterThan(0);
        expect(pauses).toBeLessThan(5);
    });

    it("answers a request whose settings fail with the import's message", async () => {
        const recorder = steppedHost();
        const pipeline = createPipeline(recorder.host);
        pipeline.handle({ kind: "sources", sources });
        const bad: ImportSettings = {
            ...settings,
            cells: { mode: "grid", grid: { cell: { width: 100, height: 100 } } },
        };
        pipeline.handle({ kind: "run", id: 7, settings: bad, smart: explicit });
        await recorder.finish();
        expect(recorder.responses).toEqual([
            { kind: "failed", id: 7, message: expect.stringContaining("No grid cell fits") },
        ]);
    });

    it("decides smart steps 6 and 7 from the cells, with the threshold and count given", () => {
        const opaque = [noise(16, 16, 1)];
        const smart: SmartChoices = { alpha: true, colors: true, threshold: 77, count: 5 };
        // Resampled: threshold and reduce.
        expect(decideSmart(opaque, settings, smart)).toMatchObject({
            alpha: { threshold: 77 },
            colors: { mode: "reduce", count: 5 },
        });
        // Same size, binary alpha, few colours: keep and keep; the colour key stays.
        const few = [{ width: 8, height: 8, data: new Uint8ClampedArray(256).fill(255) }];
        const keyed = { ...settings, alpha: { colorKey: { color: 0xff00ffff, tolerance: 3 } } };
        expect(decideSmart(few, keyed, smart)).toMatchObject({
            alpha: { colorKey: { color: 0xff00ffff, tolerance: 3 } },
            colors: { mode: "keep" },
        });
        expect(decideSmart(few, keyed, smart).alpha.threshold).toBeUndefined();
        // Not smart: as given.
        expect(decideSmart(opaque, settings, explicit)).toBe(settings);
    });
});

describe("the smart defaults of the pipeline", () => {
    it("are computed once for the same cells and target size (review I)", async () => {
        const recorder = steppedHost();
        let calls = 0;
        const pipeline = createPipeline(recorder.host, {
            smartDefaults: (cells, size) => {
                calls++;
                return smartDefaults(cells, size);
            },
        });
        const smart: SmartChoices = { ...explicit, alpha: true, colors: true };
        pipeline.handle({ kind: "sources", sources });
        let id = 0;
        const run = async (next: ImportSettings) => {
            pipeline.handle({ kind: "run", id: ++id, settings: next, smart });
            await recorder.finish();
        };
        await run(settings);
        expect(calls).toBe(1);
        await run({ ...settings, dither: "bayer" });
        await run({ ...settings, resample: "nearest" });
        expect(calls).toBe(1);
        await run({ ...settings, size: { width: 9, height: 8, fit: "contain" } });
        expect(calls).toBe(2);
        await run({
            ...settings,
            cells: { mode: "grid", grid: { cell: { columns: 2, rows: 1 } } },
        });
        expect(calls).toBe(3);
        expect(recorder.responses.every((response) => response.kind === "done")).toBe(true);
    });
});

describe("createImportPreview", () => {
    it("shows only the newest request's answer and settles with it", async () => {
        const preview = createImportPreview(createLocalRunner);
        preview.setSources(sources);
        preview.request(settings, explicit);
        const newest: ImportSettings = { ...settings, colors: { mode: "reduce", count: 3 } };
        const id = preview.request(newest, explicit);
        expect(preview.store.getState().computing).toBe(true);
        const result = await preview.settled();
        expect(result?.id).toBe(id);
        expect(result?.palette.colors).toHaveLength(3);
        const state = preview.store.getState();
        expect(state).toMatchObject({ computing: false, error: null, revision: 1 });
        expect(state.result).toBe(result);
        preview.dispose();
    });

    it("keeps its own copy of the sources", async () => {
        const pixels = noise(8, 8, 9);
        const preview = createImportPreview(createLocalRunner);
        const own: ImportSource[] = [{ name: "a.png", pixels }];
        preview.setSources(own);
        const before = [...pixels.data];
        pixels.data.fill(0);
        preview.request({ ...settings, cells: undefined, colors: { mode: "keep" } }, explicit);
        const result = await preview.settled();
        const expected = runImport(
            [{ name: "a.png", pixels: { ...pixels, data: Uint8ClampedArray.from(before) } }],
            { ...settings, cells: undefined, colors: { mode: "keep" } },
        );
        expect([...result!.frames[0]!.data]).toEqual([...expected.frames[0]!.data]);
        preview.dispose();
    });

    it("asks nothing again for settings equal to the newest request's", async () => {
        const runs: number[] = [];
        const preview = createImportPreview(() => {
            const runner = createLocalRunner();
            const send = runner.send.bind(runner);
            runner.send = (request) => {
                if (request.kind === "run") runs.push(request.id);
                send(request);
            };
            return runner;
        });
        preview.setSources(sources);
        const first = preview.request(settings, explicit);
        expect(preview.request({ ...settings }, { ...explicit })).toBe(first);
        await preview.settled();
        expect(preview.request(settings, explicit)).toBe(first);
        expect(runs).toEqual([first]);
        expect(preview.store.getState().requested).toBe(first);
        preview.dispose();
    });

    it("suspend ends the runner; a later request starts another and sends the sources again", async () => {
        const started: PreviewRunner[] = [];
        const ended: PreviewRunner[] = [];
        const preview = createImportPreview(() => {
            const runner = createLocalRunner();
            const dispose = runner.dispose.bind(runner);
            runner.dispose = () => {
                ended.push(runner);
                dispose();
            };
            started.push(runner);
            return runner;
        });
        preview.setSources(sources);
        preview.request(settings, explicit);
        const before = await preview.settled();
        preview.suspend();
        expect(ended).toEqual(started);
        expect(started).toHaveLength(1);
        // The answer stays shown; the same settings are computed again by a new runner.
        expect(preview.store.getState().result).toBe(before);
        const id = preview.request(settings, explicit);
        expect(started).toHaveLength(2);
        const after = await preview.settled();
        expect(after?.id).toBe(id);
        expect(after?.frames.map((frame) => [...frame.data])).toEqual(
            before?.frames.map((frame) => [...frame.data]),
        );
        preview.dispose();
        expect(ended).toHaveLength(2);
    });

    it("reports a failure and settles with null", async () => {
        const preview = createImportPreview(createLocalRunner);
        preview.setSources([]);
        preview.request(settings, explicit);
        expect(await preview.settled()).toBeNull();
        expect(preview.store.getState().error).toBe("There is no image to import.");
        preview.dispose();
    });
});
