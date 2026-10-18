import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { createFloatingState } from "../../src/app/selection/floatingState";
import { createMoveTool } from "../../src/app/selection/move/moveTool";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import type { ToolSpec } from "../../src/app/tools/types";
import { addLayerCommand } from "../../src/core/layers";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, Selection } from "../../src/core/model";
import { createMask, selectionOf, setMaskPixel } from "../../src/core/selection";
import { harness } from "../unit/se-014-support";
import { record } from "./record";

// SE-032 review (K): a drag of the Move tool over a large selection. Each move of a float
// rewrites the rectangle it leaves and the one it takes and makes the selection its mask
// where it is, a canvas-sized mask; since the review the tool takes only the last coalesced
// sample of each pointer event (`ToolSpec.latestSample`), so that work is done once per event
// instead of once per sample. Measured in Node through the pointer pipeline of SE-014, as the
// unit tests run it (`createToolPipeline` on stores of its own, no viewport): the app's Move
// tool and floating state, the live composite of the frame (every layer composited over the
// rectangles that changed, at most once per animation frame) and the stroke echo's
// bookkeeping. No upload, overlay draw (the ants' ring) or GPU work is included.
//
// The case of SPEC §6.6: a 256×256 document with 8 layers of opaque noise, the top one
// active, and a 256×256 checkerboard selected (every other pixel: a mask of 32 768 pixels with
// the longest boundary a selection has). The press lifts it; then `EVENTS` pointer events of
// `SAMPLES` coalesced samples each drag it back and forth by up to ±`REACH` pixels, one
// animation frame run after each event; the release ends the drag and Enter's apply commits
// the float as one step. Timed: each event with its animation frame (the statistic), the press
// (the lift) and the apply. The same drag with the tool taking every sample
// (`latestSample: false`) is reported beside it (`everySample`), as the work before the
// review. For information, the same on a 1024×1024 document of 8 layers with a noise
// selection (half the pixels, at random) (`noise1024`).
//
// Neither the ticket nor SPEC §6.6 states a budget for a move: the record is for information.
// Run alone, without PERF_RECORD (the orchestrator records it, docs/tickets/EXECUTION.md,
// Measurements): npx vitest run --config vitest.perf.config.ts tests/perf/se-032-move.perf.ts

const LAYERS = 8;
const EVENTS = 120;
const SAMPLES = 8;
const REACH = 48;

/** mulberry32: noise the same on every run. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A `side` × `side` document of `LAYERS` layers, each cel opaque noise; the top one active. */
function noiseDocument(side: number): DocSession {
    const session = createDocument(
        { name: "move", width: side, height: side },
        sequentialIds("p-"),
    );
    for (let layer = 1; layer < LAYERS; layer++) {
        const command = addLayerCommand(session);
        command.do(session);
    }
    const next = random(side);
    const frameId = session.doc.frames[0]!.id;
    session.doc.layers.forEach((layer, index) => {
        const data = new Uint8ClampedArray(side * side * 4);
        for (let at = 0; at < data.length; at++) {
            data[at] = at % 4 === 3 ? 255 : Math.floor(next() * 256);
        }
        const imageId = `noise-${index}`;
        session.doc.images.set(imageId, { width: side, height: side, data });
        session.doc.cels.set(celKey(layer.id, frameId), { imageId, opacity: 255 });
    });
    session.activeLayerId = session.doc.layers[session.doc.layers.length - 1]!.id;
    session.activeFrameId = frameId;
    return session;
}

function checkerboard(side: number): Selection {
    const mask = createMask(side, side);
    for (let y = 0; y < side; y++) {
        for (let x = y & 1; x < side; x += 2) setMaskPixel(mask, x, y);
    }
    return selectionOf(mask)!;
}

function noiseSelection(side: number): Selection {
    const mask = createMask(side, side);
    const next = random(side * 7);
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) if (next() < 0.5) setMaskPixel(mask, x, y);
    }
    return selectionOf(mask)!;
}

function summary(samples: readonly number[]) {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (fraction: number) =>
        sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
        count: sorted.length,
        medianMs: round(at(0.5)),
        p95Ms: round(at(0.95)),
        maxMs: round(sorted[sorted.length - 1]!),
    };
}

/** A pointer input at document pixel `x`, `y` (the view at 1×, its origin at the client's). */
function input(x: number, y: number, fields: Partial<PointerInput> = {}): PointerInput {
    return {
        pointerId: 1,
        button: -1,
        buttons: 1,
        clientX: x + 0.5,
        clientY: y + 0.5,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: 0,
        ...fields,
    };
}

/** One drag of the Move tool over `session` with `selection`, timed; `every`: every sample. */
function drag(session: DocSession, selection: Selection, every: boolean) {
    const h = harness();
    let version = 0;
    const floating = createFloatingState({
        sessions: h.sessions,
        composites: h.composites,
        viewport: { invalidate: () => {} },
        nextFrame: h.frames.request,
        echo: createStrokeEcho({ nextVersion: () => ++version }),
        context: () => {},
        onError: (error) => void h.errors.push(error),
    });
    const tool: ToolSpec = { ...createMoveTool({ floating }), id: "perf.move" };
    if (every) tool.latestSample = false;
    h.registry.register(tool, "se-032-move.perf.ts");
    h.tools.select("perf.move");
    const document = h.sessions
        .getState()
        .open(session, { view: { scale: 1, originX: 0, originY: 0 } });
    session.selection = selection;
    const side = session.doc.width;
    const centre = side / 2;

    let start = performance.now();
    h.pipeline.down(input(centre, centre, { button: 0, buttons: 1 }));
    const liftMs = performance.now() - start;
    h.frames.run();
    expect(floating.floats()).toBe(true);

    const events: number[] = [];
    let step = 0;
    for (let event = 0; event < EVENTS; event++) {
        const samples: PointerInput[] = [];
        for (let sample = 0; sample < SAMPLES; sample++) {
            const t = (step++ / (EVENTS * SAMPLES)) * 4 * Math.PI;
            samples.push(
                input(
                    Math.round(centre + REACH * Math.sin(t)),
                    Math.round(centre + (REACH / 2) * Math.sin(2 * t)),
                ),
            );
        }
        start = performance.now();
        h.pipeline.move(samples);
        h.frames.run();
        events.push(performance.now() - start);
    }
    const last = { x: Math.round(centre), y: Math.round(centre) };
    h.pipeline.move([input(last.x + 3, last.y + 2)]);
    h.pipeline.up(input(last.x + 3, last.y + 2, { button: 0, buttons: 0 }));
    h.frames.run();
    start = performance.now();
    expect(floating.apply()).toBe("landed");
    const applyMs = performance.now() - start;
    expect(document.history.undoLabel).toBe("Move");
    expect(h.errors).toEqual([]);
    return { events: summary(events), liftMs, applyMs };
}

it("drags a 256×256 checkerboard selection over 8 layers (and a 1024×1024 noise selection, for information)", () => {
    // Warm-up, not reported.
    drag(noiseDocument(64), checkerboard(64), false);

    const latest = drag(noiseDocument(256), checkerboard(256), false);
    const everySample = drag(noiseDocument(256), checkerboard(256), true);
    const noise1024 = drag(noiseDocument(1024), noiseSelection(1024), false);
    // The record prints its result only; the cases beside it are printed here.
    console.log(JSON.stringify({ checkerboard256: latest, everySample, noise1024 }));
    record({
        id: "se-032-move",
        ticket: "SE-032",
        measurement:
            `A drag of the Move tool through the SE-014 pointer pipeline in Node: ${EVENTS} ` +
            `pointer events of ${SAMPLES} coalesced samples moving a lifted 256×256 ` +
            `checkerboard selection by up to ±${REACH} px over a 256×256 document of ${LAYERS} ` +
            "noise layers, each event with its animation frame (the live composite of the " +
            "rectangles that changed); no upload, overlay or GPU work",
        statistic: `p95 of ${EVENTS} pointer events, each with its animation frame`,
        resultMs: latest.events.p95Ms,
        details: {
            layers: LAYERS,
            samplesPerEvent: SAMPLES,
            checkerboard256: latest,
            everySample,
            noise1024,
        },
    });
});
