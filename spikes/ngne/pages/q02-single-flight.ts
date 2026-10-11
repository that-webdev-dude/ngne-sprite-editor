import { Frame } from "@ngne/core";
import { pixelAt, readCanvas } from "../../../src/engine/testing/readCanvas.ts";
import {
    describeError,
    integerParam,
    nextFrame,
    nextTask,
    round2,
    runSpike,
} from "../lib/harness.ts";
import { bitmapOf, camera, createRenderer } from "../lib/ngne.ts";
import { solidDoc } from "../lib/pattern.ts";
import { UploadQueue } from "../lib/queue.ts";

// Question 2: single-flight queue.
// Method (ticket): overlapping `texture()` calls; latest-wins queue during a 5 s continuous
// stream. Go: earlier call rejects "superseded"; final content always shown; no starvation
// (>= 1 publish per 100 ms).

const SLOT = "ed:f:0";
const CLEAR = 0x101820;
const SIZE = 256;
const CANVAS = 64;
const GO_GAP_MS = 100;

/** A sequence number as an opaque colour (blue is odd, so it never equals the clear colour). */
const colorOf = (sequence: number): number =>
    ((sequence & 255) << 16) | (((sequence >>> 8) & 255) << 8) | 0x81;
const sequenceOf = (pixel: readonly number[]): number =>
    pixel[2] === 0x81 && pixel[3] === 255 ? (pixel[0] ?? 0) | ((pixel[1] ?? 0) << 8) : -1;

runSpike(2, async (spike) => {
    const streamMs = integerParam(spike.params, "streamMs", 5000);
    const pairs = integerParam(spike.params, "pairs", 50);
    const canvas = document.createElement("canvas");
    document.querySelector("#stage")?.append(canvas);
    const errors: string[] = [];
    const renderer = await createRenderer(canvas, CANVAS, CANVAS, (error) =>
        errors.push(describeError(error)),
    );
    const frame = new Frame();
    const view = camera(false);
    /** Renders the slot over the whole canvas and returns the sequence number it shows. */
    const shown = (): number => {
        frame.reset();
        frame.scene(view, 1);
        frame.sprite({
            x: CANVAS / 2,
            y: CANVAS / 2,
            width: CANVAS,
            height: CANVAS,
            texture: SLOT,
        });
        renderer.render(frame, CLEAR);
        return sequenceOf(pixelAt(readCanvas(canvas), CANVAS / 2, CANVAS / 2));
    };
    const bitmapFor = (sequence: number) => bitmapOf(solidDoc(SIZE, SIZE, colorOf(sequence)));
    const isSuperseded = (result: PromiseSettledResult<void>) =>
        result.status === "rejected" && /superseded/.test(describeError(result.reason));

    // Part A: overlapping calls issued in the same task.
    let sequence = 0;
    let earlierRejected = 0;
    let earlierTotal = 0;
    let lastFulfilled = 0;
    let shownOk = 0;
    const messages = new Set<string>();
    const wrong: string[] = [];
    for (let index = 0; index < pairs; index++) {
        const overlap = index % 5 === 4 ? 3 : 2;
        const bitmaps: ImageBitmap[] = [];
        const calls: Promise<void>[] = [];
        for (let call = 0; call < overlap; call++) {
            const bitmap = await bitmapFor(++sequence);
            bitmaps.push(bitmap);
        }
        const firstSequence = sequence - overlap + 1;
        for (const bitmap of bitmaps) calls.push(renderer.texture(SLOT, bitmap));
        const results = await Promise.allSettled(calls);
        for (const bitmap of bitmaps) bitmap.close();
        results.slice(0, -1).forEach((result, call) => {
            earlierTotal++;
            if (isSuperseded(result)) earlierRejected++;
            else wrong.push(`pair ${index} call ${call}: ${result.status}`);
            if (result.status === "rejected") messages.add(describeError(result.reason));
        });
        if (results[results.length - 1]?.status === "fulfilled") lastFulfilled++;
        else wrong.push(`pair ${index}: last call rejected`);
        const seen = shown();
        if (seen === sequence) shownOk++;
        else
            wrong.push(
                `pair ${index}: shows ${seen}, expected ${sequence} (first ${firstSequence})`,
            );
    }
    spike.check(
        'Overlapping calls: every earlier call rejects "superseded"',
        earlierRejected === earlierTotal,
        `${earlierRejected}/${earlierTotal} rejected; messages: ${[...messages].join(" | ")}`,
    );
    spike.check(
        "Overlapping calls: the last call resolves and its content is shown",
        lastFulfilled === pairs && shownOk === pairs,
        `${lastFulfilled}/${pairs} resolved, ${shownOk}/${pairs} shown` +
            (wrong.length ? `; ${wrong.slice(0, 3).join("; ")}` : ""),
    );

    // Part A2: the second call is issued one task later, while the first is still in flight.
    let lateOverlapping = 0;
    let lateRejected = 0;
    let lateSettledFirst = 0;
    for (let index = 0; index < pairs; index++) {
        const a = await bitmapFor(++sequence);
        const b = await bitmapFor(++sequence);
        let firstSettled = false;
        const first = renderer.texture(SLOT, a).finally(() => {
            firstSettled = true;
        });
        const firstResult = Promise.allSettled([first]);
        await nextTask();
        const wasSettled = firstSettled;
        const second = renderer.texture(SLOT, b);
        const [[one], [two]] = await Promise.all([firstResult, Promise.allSettled([second])]);
        a.close();
        b.close();
        if (wasSettled) lateSettledFirst++;
        else {
            lateOverlapping++;
            if (one && isSuperseded(one)) lateRejected++;
        }
        if (two?.status !== "fulfilled" || shown() !== sequence)
            wrong.push(`late pair ${index}: second call not shown`);
    }
    spike.check(
        'Second call one task later: an unsettled earlier call rejects "superseded"',
        lateRejected === lateOverlapping && !wrong.some((text) => text.startsWith("late")),
        `${lateRejected}/${lateOverlapping} overlapping pairs rejected; ` +
            `${lateSettledFirst} pairs did not overlap (first call already settled)`,
    );

    // Part B: 5 s continuous stream through the latest-wins queue of SPEC §6.4. Requests are
    // issued about every 2 ms, faster than uploads complete.
    let published = -1;
    let dirty = false;
    const publishes: { at: number; sequence: number }[] = [];
    const failures: string[] = [];
    const queue = new UploadQueue<number>(
        renderer,
        (_, tag) => {
            published = tag;
            publishes.push({ at: performance.now(), sequence: tag });
            dirty = true;
        },
        (_, error) => failures.push(describeError(error)),
    );
    let stale = 0;
    let renders = 0;
    let running = true;
    const start = performance.now();
    const drawLoop = (async () => {
        while (running) {
            await nextFrame();
            if (!dirty) continue;
            dirty = false;
            const expected = published;
            if (shown() !== expected) stale++;
            renders++;
        }
    })();
    let lastRequest = 0;
    let requested = 0;
    let last = 0;
    while (performance.now() - start < streamMs) {
        await nextTask();
        const now = performance.now();
        if (now - lastRequest < 2) continue;
        lastRequest = now;
        const mine = ++sequence;
        last = mine;
        requested++;
        queue.request(SLOT, () => bitmapFor(mine), mine);
    }
    const end = performance.now();
    await queue.idle();
    running = false;
    await drawLoop;
    const finalShown = shown();

    const during = publishes.filter((entry) => entry.at <= end);
    let maxGap = (during[0]?.at ?? end) - start;
    for (let index = 1; index < during.length; index++)
        maxGap = Math.max(maxGap, (during[index]?.at ?? 0) - (during[index - 1]?.at ?? 0));
    maxGap = Math.max(maxGap, end - (during[during.length - 1]?.at ?? start));
    const ordered = publishes.every(
        (entry, index) => index === 0 || entry.sequence > (publishes[index - 1]?.sequence ?? -1),
    );
    const seconds = (end - start) / 1000;
    spike.metric("stream", {
        durationMs: round2(end - start),
        requested,
        requestsPerSecond: round2(requested / seconds),
        published: during.length,
        publishesPerSecond: round2(during.length / seconds),
        replacedInQueue: queue.stats.replaced,
        maxPublishGapMs: round2(maxGap),
        renders,
        staleRenders: stale,
        finalRequested: last,
        finalShown,
        failures,
    });
    spike.samples(
        "streamPublishAtMs",
        during.map((entry) => entry.at - start),
    );
    spike.check(
        "Stream: every render shows the newest published content, in request order",
        stale === 0 && ordered && failures.length === 0,
        `${renders} renders, ${stale} stale; publish order ${ordered ? "increasing" : "broken"}` +
            (failures.length ? `; failures: ${failures.slice(0, 3).join(" | ")}` : ""),
    );
    spike.check(
        "Stream: the final request is shown after the queue drains",
        finalShown === last,
        `shows ${finalShown}, last request ${last}`,
    );
    spike.check(
        `Stream: no starvation (largest gap between publishes <= ${GO_GAP_MS} ms)`,
        maxGap <= GO_GAP_MS,
        `largest gap ${round2(maxGap)} ms; ${during.length} publishes in ${round2(seconds)} s`,
    );
    spike.summary(
        "Overlapping calls: earlier calls rejected as superseded",
        `${earlierRejected + lateRejected}/${earlierTotal + lateOverlapping}`,
    );
    spike.summary(
        "Queue stream: requests/s, publishes/s",
        `${round2(requested / seconds)}, ${round2(during.length / seconds)}`,
    );
    spike.summary("Queue stream: largest gap between publishes (ms)", `${round2(maxGap)}`);
    spike.summary("Queue stream: stale renders / renders", `${stale} / ${renders}`);

    // Part C, recorded only (no check): the same stream without a queue. A call supersedes
    // the one before it whenever that one is still in flight, so nothing is published while
    // requests arrive faster than uploads complete.
    const rawMs = Math.min(2000, streamMs);
    let rawFulfilled = 0;
    let rawSuperseded = 0;
    let rawOther = 0;
    let rawCalls = 0;
    const rawStart = performance.now();
    const pending: Promise<void>[] = [];
    lastRequest = 0;
    while (performance.now() - rawStart < rawMs) {
        await nextTask();
        const now = performance.now();
        if (now - lastRequest < 2) continue;
        lastRequest = now;
        rawCalls++;
        const bitmap = await bitmapFor(++sequence);
        pending.push(
            renderer
                .texture(SLOT, bitmap)
                .then(
                    () => {
                        if (performance.now() - rawStart < rawMs) rawFulfilled++;
                    },
                    (error: unknown) => {
                        if (/superseded/.test(describeError(error))) rawSuperseded++;
                        else rawOther++;
                    },
                )
                .finally(() => bitmap.close()),
        );
    }
    await Promise.all(pending);
    spike.metric("rawStream", {
        durationMs: rawMs,
        calls: rawCalls,
        publishedDuringStream: rawFulfilled,
        superseded: rawSuperseded,
        otherRejections: rawOther,
    });
    spike.summary(
        "Without a queue: calls, published during the stream, superseded",
        `${rawCalls}, ${rawFulfilled}, ${rawSuperseded}`,
    );

    spike.check("No renderer diagnostic", errors.length === 0, errors.join(" | "));
    renderer.dispose();
});
