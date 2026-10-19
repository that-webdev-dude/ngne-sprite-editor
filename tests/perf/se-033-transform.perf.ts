import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { createFloatingState } from "../../src/app/selection/floatingState";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { rectMask, selectionOf } from "../../src/core/selection";
import { harness } from "../unit/se-014-support";
import { record } from "./record";

// SE-033 review B: the cost of one event of a free-transform drag of a large float. Each event
// of a turn or scale drag sets the float's transform once (`ToolSpec.latestSample`): the source
// is rendered by nearest-neighbour sampling over the part of the box's bounds on the canvas,
// written into the cel's image over the rectangle it left and the one it takes, and the
// selection made its mask where it is (a canvas-sized mask); then the animation frame runs the
// live composite of that rectangle. Measured in Node on the app's floating state over the
// SE-014 harness's stores, as the unit tests run it: no pointer mapping, upload, overlay or GPU
// work.
//
// The case: a 1024×1024 document of one layer of opaque noise, its central 512×512 selected and
// lifted, set to a 1024×1024 box (2× in each direction) turned by about 10° and by about 45°.
// `EVENTS` events alternate the angle by ±1° about it, as a turn drag does, each with its
// animation frame (the statistic). For information, the same box at 0° (scaled only).
//
// Neither the ticket nor SPEC §6.6 states a budget for a transform: the record is for
// information. Run alone, without PERF_RECORD (the orchestrator records it,
// docs/tickets/EXECUTION.md, Measurements):
// npx vitest run --config vitest.perf.config.ts tests/perf/se-033-transform.perf.ts

const SIDE = 1024;
const EVENTS = 40;

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

function noiseDocument(side: number): DocSession {
    const session = createDocument(
        { name: "transform", width: side, height: side },
        sequentialIds("p-"),
    );
    const next = random(side);
    const data = new Uint8ClampedArray(side * side * 4);
    for (let at = 0; at < data.length; at++)
        data[at] = at % 4 === 3 ? 255 : Math.floor(next() * 256);
    session.doc.images.set("noise", { width: side, height: side, data });
    session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
        imageId: "noise",
        opacity: 255,
    });
    return session;
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

/** `EVENTS` transform events of a 1024² box about `angle`, timed with their frames. */
function turn(side: number, angle: number) {
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
    const session = noiseDocument(side);
    const document = h.sessions
        .getState()
        .open(session, { view: { scale: 1, originX: 0, originY: 0 } });
    const quarter = side / 4;
    session.selection = selectionOf(
        rectMask(side, side, { x: quarter, y: quarter, width: side / 2, height: side / 2 }),
    );
    floating.lift(document);
    h.frames.run();
    const box = { x: 0, y: 0, width: side, height: side };
    floating.setTransform({ ...box, angle });
    h.frames.run();

    const events: number[] = [];
    for (let event = 0; event < EVENTS; event++) {
        const start = performance.now();
        floating.setTransform({ ...box, angle: angle + (event % 2 === 0 ? 1 : -1) });
        h.frames.run();
        events.push(performance.now() - start);
    }
    expect(floating.floats()).toBe(true);
    expect(floating.cancel()).toBe(true);
    expect(h.errors).toEqual([]);
    return summary(events);
}

it("turns a 1024×1024 box of a lifted 512×512 selection at about 10° and 45° (and scales it at 0°, for information)", () => {
    // Warm-up, not reported.
    turn(128, 10);

    const at10 = turn(SIDE, 10);
    const at45 = turn(SIDE, 45);
    const at0 = turn(SIDE, 0);
    console.log(JSON.stringify({ at10, at45, at0 }));
    record({
        id: "se-033-transform",
        ticket: "SE-033",
        measurement:
            `One event of a free-transform drag in Node: the float of a lifted 512×512 ` +
            `selection of a ${SIDE}×${SIDE} noise document set to a ${SIDE}×${SIDE} box turned ` +
            "by about 10° (±1° per event) — rendered over the part on the canvas, written into " +
            "the cel, its selection mask made — with its animation frame (the live composite); " +
            "no upload, overlay or GPU work",
        statistic: `p95 of ${EVENTS} events, each with its animation frame`,
        resultMs: at10.p95Ms,
        details: { events: EVENTS, at10, at45, at0 },
    });
});
