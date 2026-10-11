import { Frame } from "@ngne/core";
import type { WebGPURenderer } from "@ngne/core";
import {
    describeError,
    integerParam,
    nextFrame,
    round2,
    runSpike,
    summarize,
    type Spike,
} from "../lib/harness.ts";
import { camera, createRenderer, placeDoc, readDiff, upload, VIEWPORT_SLOTS } from "../lib/ngne.ts";
import { solidDoc, type Doc } from "../lib/pattern.ts";
import { Q4_CLEAR, Q4_SIZES, Q4_SLOTS, q4Docs, q4Placements } from "../lib/scenes.ts";

// Question 4: renderer replacement (a) against a fixed oversized canvas (b).
// (a) Dispose and create on a new canvas 50 times, including overlapping requests serialized
//     by the caller. Go: no errors, one live device after each swap completes, never a blank
//     viewport, median <= 250 ms.
// (b) One canvas with backing = logical = screen size in device pixels, CSS-clipped, window
//     resized 50 times. Go: correct image, no recreation.
//
// Query: mode=a&stage=detached|detached-redraw|stacked|control&drive=auto|step, or mode=b.
// With drive=step and in mode b the runner calls `window.__spikeControl` and takes the
// screenshots that decide "never a blank viewport" and "correct image".

const GO_MEDIAN_MS = 250;
const docs = q4Docs();
const placeholder = solidDoc(1, 1, 0, 0);
const slotDocs = new Map<string, Doc>([
    [Q4_SLOTS.checker, docs.checker],
    [Q4_SLOTS.current, docs.current],
    [Q4_SLOTS.side, docs.side],
    [Q4_SLOTS.marker, docs.marker],
]);

interface Control {
    swap?: (index: number) => Promise<unknown>;
    afterResize?: (index: number) => Promise<unknown>;
    finish: () => void;
}

function expose(control: Control): void {
    (window as unknown as { __spikeControl?: Control }).__spikeControl = control;
}

/** Every viewport slot is uploaded: four with content, the rest with the 1×1 placeholder. */
function uploadAll(renderer: WebGPURenderer): Promise<void[]> {
    return Promise.all(
        VIEWPORT_SLOTS.map((slot) => upload(renderer, slot, slotDocs.get(slot) ?? placeholder)),
    );
}

const frame = new Frame();
const view = camera(false);

function draw(renderer: WebGPURenderer, viewport?: { width: number; height: number }): void {
    frame.reset();
    frame.scene(view, 1);
    q4Placements(docs, viewport).forEach(({ slot, placement }, layer) =>
        placeDoc(frame, slot, placement, layer + 1),
    );
    renderer.render(frame, Q4_CLEAR);
}

function expected(viewport?: { width: number; height: number }) {
    return q4Placements(docs, viewport).map((entry) => entry.placement);
}

/** Median time from `render()` to the GPU finishing the submitted work (recorded only). */
async function renderDoneMs(spike: Spike, render: () => void): Promise<number | null> {
    const device = spike.tracker.latestLive()?.device;
    if (!device) return null;
    const times: number[] = [];
    for (let index = 0; index < 30; index++) {
        await nextFrame();
        const start = performance.now();
        render();
        await device.queue.onSubmittedWorkDone();
        times.push(performance.now() - start);
    }
    return summarize(times).median;
}

interface Instance {
    readonly canvas: HTMLCanvasElement;
    readonly renderer: WebGPURenderer;
}

async function replacement(spike: Spike): Promise<void> {
    const stage = spike.params.get("stage") ?? "detached";
    const drive = spike.params.get("drive") ?? "auto";
    const swaps = integerParam(spike.params, "swaps", 50);
    spike.variant = `a ${stage} ${drive}`;
    document.body.classList.add("fullscreen");

    const viewport = document.createElement("div");
    viewport.id = "viewport";
    viewport.style.cssText = "position:fixed;left:0;top:0;overflow:hidden;background:#ff00ff";
    document.body.append(viewport);
    const resize = ([width, height]: readonly [number, number]) => {
        viewport.style.width = `${width / devicePixelRatio}px`;
        viewport.style.height = `${height / devicePixelRatio}px`;
    };

    const errors: string[] = [];
    const build = async ([width, height]: readonly [number, number], attach: boolean) => {
        const start = performance.now();
        const canvas = document.createElement("canvas");
        canvas.style.cssText =
            `position:absolute;left:0;top:0;width:${width / devicePixelRatio}px;` +
            `height:${height / devicePixelRatio}px`;
        // "stacked": the new canvas is in the document, under the current one, while it loads.
        if (attach) viewport.prepend(canvas);
        const renderer = await createRenderer(canvas, width, height, (error) =>
            errors.push(describeError(error)),
        );
        const created = performance.now();
        await uploadAll(renderer);
        const uploaded = performance.now();
        draw(renderer);
        const diff = readDiff(canvas, Q4_CLEAR, expected());
        return {
            instance: { canvas, renderer } satisfies Instance,
            createMs: created - start,
            uploadMs: uploaded - created,
            diff,
        };
    };

    const first = Q4_SIZES[0] ?? [1280, 720];
    resize(first);
    const initial = await build(first, true);
    let current: Instance = initial.instance;

    interface SwapRecord {
        index: number;
        size: readonly [number, number];
        createMs: number;
        uploadMs: number;
        totalMs: number;
        waitedMs: number;
        liveDevices: number;
        firstDrawDiff: number;
        status: string;
    }
    const records: SwapRecord[] = [];
    const failures: string[] = [];

    // SPEC §6.4 replacement order: create on a new canvas, upload every slot, draw once, swap
    // the canvases, then dispose the old instance.
    const swap = async (index: number, requestedAt: number): Promise<SwapRecord> => {
        const size = Q4_SIZES[(index + 1) % Q4_SIZES.length] ?? first;
        const start = performance.now();
        const old = current;
        // "control" is the wrong order on purpose (old instance gone before the new one has
        // drawn). It only shows that the runner's screenshots do see a blank viewport.
        if (stage === "control") {
            old.canvas.remove();
            old.renderer.dispose();
        }
        const next = await build(size, stage === "stacked" || stage === "control");
        if (stage === "stacked") old.canvas.remove();
        else if (stage !== "control") viewport.replaceChild(next.instance.canvas, old.canvas);
        resize(size);
        // "detached-redraw": the canvas was drawn before it entered the document, so it is
        // drawn again in the task that inserts it.
        if (stage === "detached-redraw") draw(next.instance.renderer);
        current = next.instance;
        if (stage !== "control") old.renderer.dispose();
        const record: SwapRecord = {
            index,
            size,
            createMs: round2(next.createMs),
            uploadMs: round2(next.uploadMs),
            totalMs: round2(performance.now() - start),
            waitedMs: round2(start - requestedAt),
            liveDevices: spike.tracker.liveCount(),
            firstDrawDiff: next.diff.count,
            status: current.renderer.status,
        };
        records.push(record);
        return record;
    };

    // The caller serializes requests: each starts when the one before it has settled.
    let chain: Promise<unknown> = Promise.resolve();
    const request = (index: number): Promise<SwapRecord | undefined> => {
        const requestedAt = performance.now();
        const result = chain.then(() => swap(index, requestedAt));
        chain = result.catch((error: unknown) => {
            failures.push(`swap ${index}: ${describeError(error)}`);
        });
        return result.catch(() => undefined);
    };

    if (drive === "step") {
        const finished = new Promise<void>((resolve) =>
            expose({ swap: (index) => request(index), finish: resolve }),
        );
        spike.stage("ready");
        await finished;
    } else {
        // Half one at a time, half in overlapping bursts of five.
        const sequential = Math.ceil(swaps / 2);
        for (let index = 0; index < sequential; index++) await request(index);
        for (let index = sequential; index < swaps; index += 5)
            await Promise.all(
                Array.from({ length: Math.min(5, swaps - index) }, (_, burst) =>
                    request(index + burst),
                ),
            );
    }
    await chain;

    const total = summarize(records.map((record) => record.totalMs));
    const oneLive = records.filter((record) => record.liveDevices === 1).length;
    const correct = records.filter((record) => record.firstDrawDiff === 0).length;
    spike.metric("swaps", {
        stage,
        drive,
        requested: drive === "step" ? records.length + failures.length : swaps,
        completed: records.length,
        overlapping: records.filter((record) => record.waitedMs > 1).length,
        totalMs: total,
        createMs: summarize(records.map((record) => record.createMs)),
        uploadMs: summarize(records.map((record) => record.uploadMs)),
        devicesCreated: spike.tracker.devices.length,
        liveDevicesAtEnd: spike.tracker.liveCount(),
        initialDrawDiff: initial.diff.count,
    });
    spike.samples(
        "swapTotalMs",
        records.map((record) => record.totalMs),
    );
    spike.check(
        "No error or diagnostic",
        errors.length === 0 && failures.length === 0 && records.length > 0,
        [...errors, ...failures].slice(0, 5).join(" | "),
    );
    spike.check(
        "One live device after each swap completes",
        oneLive === records.length,
        `${oneLive}/${records.length} swaps ended with exactly one live device`,
    );
    spike.check(
        "The first draw of every new renderer is exact (in-page readback)",
        correct === records.length && initial.diff.count === 0,
        `${correct}/${records.length} exact`,
    );
    if (drive === "auto") {
        spike.check(
            `Median swap time <= ${GO_MEDIAN_MS} ms`,
            total.median <= GO_MEDIAN_MS,
            `median ${total.median} ms, p95 ${total.p95} ms, max ${total.max} ms`,
        );
        spike.summary(
            `(a) ${stage}: swap time median / p95 / max (ms)`,
            `${total.median} / ${total.p95} / ${total.max}`,
        );
        spike.summary(
            `(a) ${stage}: swaps with one live device, exact first draw`,
            `${oneLive}/${records.length}, ${correct}/${records.length}`,
        );
        const done = await renderDoneMs(spike, () => draw(current.renderer));
        spike.metric("renderDoneMedianMs", done);
        spike.metric("renderDoneBacking", [current.canvas.width, current.canvas.height]);
        spike.summary(
            `(a) ${stage}: render() to GPU work done, median (ms) at ` +
                `${current.canvas.width}x${current.canvas.height} (recorded)`,
            `${done}`,
        );
    }
    current.renderer.dispose();
}

async function oversized(spike: Spike): Promise<void> {
    spike.variant = `b DPR ${devicePixelRatio}`;
    document.body.classList.add("fullscreen");
    const viewport = document.createElement("div");
    viewport.id = "viewport";
    viewport.style.cssText = "position:fixed;inset:0;overflow:hidden;background:#ff00ff";
    document.body.append(viewport);

    // Backing = logical = screen size in device pixels; CSS size maps it 1:1 to device pixels.
    const width = Math.ceil(screen.width * devicePixelRatio);
    const height = Math.ceil(screen.height * devicePixelRatio);
    const canvas = document.createElement("canvas");
    canvas.style.cssText =
        `position:absolute;left:0;top:0;width:${width / devicePixelRatio}px;` +
        `height:${height / devicePixelRatio}px`;
    viewport.append(canvas);

    const errors: string[] = [];
    const renderer = await createRenderer(canvas, width, height, (error) =>
        errors.push(describeError(error)),
    );
    await uploadAll(renderer);

    let size = { width: 0, height: 0 };
    new ResizeObserver((entries) => {
        const box = entries[0]?.devicePixelContentBoxSize?.[0];
        if (box) size = { width: box.inlineSize, height: box.blockSize };
    }).observe(viewport, { box: "device-pixel-content-box" });

    interface ResizeRecord {
        index: number;
        viewport: { width: number; height: number };
        diff: number;
        first: string;
        liveDevices: number;
        devicesCreated: number;
        status: string;
    }
    const records: ResizeRecord[] = [];
    const afterResize = async (index: number): Promise<ResizeRecord> => {
        // Two frames: the observer has reported the new size and the layout is presented.
        await nextFrame();
        await nextFrame();
        const now = { ...size };
        draw(renderer, now);
        const diff = readDiff(canvas, Q4_CLEAR, expected(now));
        const record: ResizeRecord = {
            index,
            viewport: now,
            diff: diff.count,
            first: diff.first,
            liveDevices: spike.tracker.liveCount(),
            devicesCreated: spike.tracker.devices.length,
            status: renderer.status,
        };
        records.push(record);
        return record;
    };

    const finished = new Promise<void>((resolve) => expose({ afterResize, finish: resolve }));
    await afterResize(-1);
    records.length = 0;
    spike.stage("ready");
    await finished;

    const exact = records.filter((record) => record.diff === 0).length;
    const single = records.every(
        (record) =>
            record.devicesCreated === 1 && record.liveDevices === 1 && record.status === "ready",
    );
    spike.metric("oversized", {
        backing: [width, height],
        screenCss: [screen.width, screen.height],
        resizes: records.length,
        exactReadbacks: exact,
        devicesCreated: spike.tracker.devices.length,
        viewports: records.map((record) => [record.viewport.width, record.viewport.height]),
    });
    spike.check(
        "Correct image after every resize (in-page readback of the whole canvas)",
        exact === records.length && records.length > 0,
        `${exact}/${records.length} exact` +
            (exact === records.length
                ? ""
                : `; ${records.find((record) => record.diff !== 0)?.first ?? ""}`),
    );
    spike.check(
        "No recreation: one device and one renderer for the whole run",
        single && spike.tracker.devices.length === 1,
        `${spike.tracker.devices.length} device(s) created`,
    );
    spike.check("No error or diagnostic", errors.length === 0, errors.join(" | "));
    spike.summary(`(b) backing size (device px)`, `${width}x${height}`);
    spike.summary(`(b) resizes with exact readback`, `${exact}/${records.length}`);
    spike.summary(`(b) devices created`, `${spike.tracker.devices.length}`);
    const done = await renderDoneMs(spike, () => draw(renderer, size));
    spike.metric("renderDoneMedianMs", done);
    spike.metric("renderDoneBacking", [width, height]);
    spike.summary(
        `(b) render() to GPU work done, median (ms) at full backing size (recorded)`,
        `${done}`,
    );
    renderer.dispose();
}

runSpike(4, (spike) =>
    (spike.params.get("mode") ?? "a") === "b" ? oversized(spike) : replacement(spike),
);
