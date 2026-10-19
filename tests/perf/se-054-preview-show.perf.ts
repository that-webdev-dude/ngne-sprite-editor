import { expect, it } from "vitest";
import { connectPreview } from "../../src/app/preview/previewController";
import type { PreviewPacker } from "../../src/app/preview/previewController";
import type { PackFrame, PackRequest } from "../../src/app/preview/previewPack";
import { createPreviewState } from "../../src/app/preview/previewState";
import { createActiveComposites } from "../../src/app/state/composites";
import { createSessionsStore } from "../../src/app/state/sessions";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { PixelLayer } from "../../src/core/model";
import type { PreviewPort } from "../../src/engine/NgnePreview";
import { record } from "./record";

// SE-054 review C: the preview composites the frames of a document shown on the main thread,
// in slices of `PACK_SLICE_MS` (one task each), and sends them to the packing worker in
// batches. This measures the longest main-thread task the preview runs when a 64-frame,
// 256×256, 8-layer document is shown (a tab switch): the switch itself and every task of the
// pack until its request is sent. The worker is a stand-in that only receives. No budget:
// the number is for information (SPEC §6.6 has none for it).

const SIDE = 256;
const LAYERS = 8;
const FRAMES = 64;
const RUNS = 5;

/** Deterministic pseudo-random bytes (a linear congruential generator). */
function generator(seed: number): () => number {
    let state = seed;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 24;
    };
}

/** The reference document: every layer of every frame a cel of half-transparent noise. */
function referenceDocument(name: string) {
    const next = generator(54);
    const session = createDocument({ name, width: SIDE, height: SIDE }, sequentialIds(name));
    const { doc } = session;
    doc.layers = Array.from({ length: LAYERS }, (_, index): PixelLayer => ({
        id: `${name}-layer-${index}`,
        name: `Layer ${index}`,
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 200 + index,
        blend: "normal",
    }));
    doc.frames = Array.from({ length: FRAMES }, (_, index) => ({
        id: `${name}-frame-${index}`,
        durationMs: 100,
    }));
    doc.cels.clear();
    doc.images.clear();
    for (const frame of doc.frames) {
        for (const layer of doc.layers) {
            const data = new Uint8ClampedArray(SIDE * SIDE * 4);
            for (let at = 0; at < data.length; at += 4) {
                data[at] = next();
                data[at + 1] = next();
                data[at + 2] = next();
                data[at + 3] = 1 + (next() % 254);
            }
            const imageId = `${layer.id}-${frame.id}`;
            doc.images.set(imageId, { width: SIDE, height: SIDE, data });
            doc.cels.set(celKey(layer.id, frame.id), { imageId, opacity: 250 });
        }
    }
    session.activeLayerId = doc.layers[0]!.id;
    session.activeFrameId = doc.frames[0]!.id;
    return session;
}

const port: PreviewPort = {
    setSize() {},
    setDisplaySize() {},
    setRunning() {},
    setAtlas() {},
    setAnimation() {},
    setPlaying() {},
    setSpeed() {},
    setBackground() {},
};

/** One show of the document: the longest task, the number of tasks and the frames sent. */
async function showOnce(run: number) {
    const sessions = createSessionsStore();
    const composites = createActiveComposites(sessions);
    const tasks: number[] = [];
    const sent: PackFrame[] = [];
    let requested: (request: PackRequest) => void = () => undefined;
    const done = new Promise<PackRequest>((resolve) => {
        requested = resolve;
    });
    const packer: PreviewPacker = {
        send: (batch) => void sent.push(...batch.frames),
        pack(request) {
            sent.push(...request.frames);
            requested(request);
            return new Promise(() => undefined);
        },
        dispose() {},
    };
    const connection = connectPreview(port, {
        sessions,
        composites,
        state: createPreviewState(),
        packer,
        visibility: { visible: () => true, subscribe: () => () => undefined },
        setTimer: (callback, ms) =>
            setTimeout(() => {
                const start = performance.now();
                callback();
                tasks.push(performance.now() - start);
            }, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    const session = referenceDocument(`run${run}-`);
    // The tab switch: the store's change and what the preview does in it.
    const start = performance.now();
    sessions.getState().open(session);
    tasks.push(performance.now() - start);
    await done;
    connection.dispose();
    composites.dispose();
    return { longest: Math.max(...tasks), tasks: tasks.length, frames: sent.length };
}

it("SE-054: longest main-thread task of the preview when a 64-frame 256² 8-layer document is shown", async () => {
    const runs = [];
    for (let run = 0; run < RUNS; run++) runs.push(await showOnce(run));
    for (const run of runs) expect(run.frames).toBe(FRAMES);
    const longest = runs.map((run) => run.longest).sort((a, b) => a - b);
    record({
        id: "se-054-preview-show",
        ticket: "SE-054",
        measurement:
            "Longest main-thread task of the preview from showing a 64-frame 256×256 8-layer " +
            "document to its pack request (composites read in slices)",
        statistic: `median over ${RUNS} shows of the longest task`,
        resultMs: longest[Math.floor(RUNS / 2)]!,
        details: {
            longestPerShowMs: runs.map((run) => Number(run.longest.toFixed(3))),
            tasksPerShow: runs.map((run) => run.tasks),
        },
    });
});
