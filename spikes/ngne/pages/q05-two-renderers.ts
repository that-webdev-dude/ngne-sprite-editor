import { Frame } from "@ngne/core";
import { readCanvas } from "../../../src/engine/testing/readCanvas.ts";
import { describeError, integerParam, nextFrame, round2, runSpike, sleep } from "../lib/harness.ts";
import {
    bitmapOf,
    camera,
    createPreview,
    createRenderer,
    isOverloadNotice,
    placeDoc,
    readDiff,
    type Preview,
} from "../lib/ngne.ts";
import { blit, diffImages, expectedImage, makeDoc, solidDoc, type Doc } from "../lib/pattern.ts";
import { UploadQueue } from "../lib/queue.ts";

// Question 5: two renderers.
// Method (ticket): a bare `WebGPURenderer` and a `BrowserGame` on two canvases for 60 s;
// `stop()`/`start()` the game 20 times through a serialized queue; the host calls
// `app.renderer.texture()` after `start()` resolves; dispose and recreate the game on a new
// canvas 20 times. Go: no diagnostics other than dropped-tick notices; both keep rendering
// correctly.

const VIEW_SLOT = "ed:f:0";
const VIEW_CLEAR = 0x101820;
const VIEW_SIZE = 512;
const ATLAS = "pv:atlas";
const PREVIEW_CLEAR = 0x000000;
const PREVIEW_BG = 0x304050;
const PREVIEW = { width: 64, height: 64, k: 4 };
const CELL = 32;
const FRAMES = 4;
const FRAME_MS = 100;

runSpike(5, async (spike) => {
    const durationMs = integerParam(spike.params, "durationMs", 60000);
    const cycles = integerParam(spike.params, "cycles", 20);
    const stage = document.querySelector<HTMLElement>("#stage");
    if (!stage) throw new Error("Missing stage");
    stage.style.cssText = "display:flex;gap:16px;padding:8px";
    const started = performance.now();
    const failures: string[] = [];

    // ---- Viewport: bare renderer, drawn on demand after each upload -------------------------
    const viewCanvas = document.createElement("canvas");
    viewCanvas.style.width = viewCanvas.style.height = `${VIEW_SIZE / devicePixelRatio}px`;
    stage.append(viewCanvas);
    const viewErrors: string[] = [];
    const viewRenderer = await createRenderer(viewCanvas, VIEW_SIZE, VIEW_SIZE, (error) =>
        viewErrors.push(describeError(error)),
    );
    const doc = makeDoc(256, 256, 5);
    const viewFrame = new Frame();
    const viewCamera = camera(false);
    const view = { renders: 0, wrong: 0, first: "" };
    let viewDirty = false;
    // The tag of each upload is the buffer snapshot it was built from, so a draw is compared
    // with exactly what the slot holds.
    let shown: Doc | undefined;
    const queue = new UploadQueue<Doc>(
        viewRenderer,
        (_, snapshot) => {
            shown = snapshot;
            viewDirty = true;
        },
        (_, error) => failures.push("viewport upload: " + describeError(error)),
    );
    let running = true;
    const viewLoop = (async () => {
        let stroke = 0;
        let lastStroke = 0;
        while (running) {
            const now = await nextFrame();
            if (now - lastStroke >= 250) {
                lastStroke = now;
                stroke++;
                // A brush dab, then the whole slot is uploaded again.
                for (let y = 0; y < 16; y++)
                    for (let x = 0; x < 16; x++) {
                        const o = (((stroke * 13 + y) % 256) * 256 + ((stroke * 7 + x) % 256)) * 4;
                        doc.pixels[o] = (stroke * 31) & 255;
                        doc.pixels[o + 2] = ((stroke * 5) & 255) | 1;
                    }
                const snapshot: Doc = { ...doc, pixels: doc.pixels.slice() };
                queue.request(VIEW_SLOT, () => bitmapOf(snapshot), snapshot);
            }
            if (!viewDirty || !shown) continue;
            viewDirty = false;
            const placement = { doc: shown, x: 0, y: 0, scale: 2 };
            viewFrame.reset();
            viewFrame.scene(viewCamera, 1);
            placeDoc(viewFrame, VIEW_SLOT, placement);
            viewRenderer.render(viewFrame, VIEW_CLEAR);
            const diff = readDiff(viewCanvas, VIEW_CLEAR, [placement]);
            view.renders++;
            if (diff.count) {
                view.wrong++;
                view.first ||= diff.first;
            }
        }
    })();

    // ---- Preview: BrowserGame fed by the host after start() ---------------------------------
    const frameDocs = Array.from({ length: FRAMES }, (_, index) => makeDoc(CELL, CELL, 20 + index));
    const atlas = solidDoc(FRAMES * (CELL + 1) + 1, CELL + 2, 0, 0);
    frameDocs.forEach((frame, index) => blit(atlas, frame, 1 + index * (CELL + 1), 1));
    const expectedFrames = frameDocs.map((frame) =>
        expectedImage(PREVIEW.width, PREVIEW.height, PREVIEW_BG, [
            { doc: frame, x: 16, y: 16, scale: 1 },
        ]),
    );
    const gameDiagnostics = { overload: 0, droppedTicks: 0, other: [] as string[] };

    interface Game {
        preview: Preview;
        canvas: HTMLCanvasElement;
        ready: boolean;
        drawn: number;
        frames: number;
        verified: number;
        wrong: number;
        first: string;
    }
    const totals = { games: 0, frames: 0, verified: 0, wrong: 0, first: "" };

    const createGame = async (): Promise<Game> => {
        const canvas = document.createElement("canvas");
        canvas.style.cssText =
            `width:${(PREVIEW.width * PREVIEW.k) / devicePixelRatio}px;` +
            `height:${(PREVIEW.height * PREVIEW.k) / devicePixelRatio}px;` +
            "image-rendering:pixelated;pointer-events:none";
        stage.append(canvas);
        const game: Game = {
            canvas,
            ready: false,
            drawn: -1,
            frames: 0,
            verified: 0,
            wrong: 0,
            first: "",
            preview: createPreview({
                canvas,
                width: PREVIEW.width,
                height: PREVIEW.height,
                clear: PREVIEW_CLEAR,
                pixelSnap: false,
                // The render callback draws nothing until the first upload has resolved.
                draw: (frame, ageMs) => {
                    game.drawn = -1;
                    if (!game.ready) return;
                    const index = Math.floor(ageMs / FRAME_MS) % FRAMES;
                    game.drawn = index;
                    frame.rect(
                        PREVIEW.width / 2,
                        PREVIEW.height / 2,
                        PREVIEW.width,
                        PREVIEW.height,
                        PREVIEW_BG,
                    );
                    frame.sprite({
                        x: 16 + CELL / 2,
                        y: 16 + CELL / 2,
                        width: CELL,
                        height: CELL,
                        texture: ATLAS,
                        u: (1 + index * (CELL + 1)) / atlas.width,
                        v: 1 / atlas.height,
                        uw: CELL / atlas.width,
                        vh: CELL / atlas.height,
                        layer: 1,
                    });
                },
                diagnostic: (error) => {
                    if (isOverloadNotice(error)) {
                        gameDiagnostics.overload++;
                        gameDiagnostics.droppedTicks +=
                            (error as { droppedTicks?: number }).droppedTicks ?? 0;
                    } else gameDiagnostics.other.push(describeError(error));
                },
                afterFrame: () => {
                    game.frames++;
                    totals.frames++;
                    const expected = expectedFrames[game.drawn];
                    if (!expected) return;
                    const image = readCanvas(canvas);
                    const diff = diffImages(image.data, expected, image.width);
                    if (diff.count) {
                        game.wrong++;
                        totals.wrong++;
                        totals.first ||= `game ${totals.games} frame ${game.drawn}: ${diff.first}`;
                    } else {
                        game.verified++;
                        totals.verified++;
                    }
                },
            }),
        };
        totals.games++;
        return game;
    };

    /** The host uploads the atlas only after start() has resolved (SPEC §6.5). */
    const uploadAtlas = async (game: Game) => {
        const renderer = game.preview.app.renderer;
        if (!renderer) throw new Error("renderer is undefined after start() resolved");
        const bitmap = await bitmapOf(atlas);
        try {
            await renderer.texture(ATLAS, bitmap);
        } finally {
            bitmap.close();
        }
        game.ready = true;
    };

    // Lifecycle calls run through one serialized queue.
    let chain: Promise<unknown> = Promise.resolve();
    const enqueue = (label: string, action: () => Promise<void>): Promise<void> => {
        const result = chain.then(action);
        chain = result.catch((error: unknown) => {
            failures.push(`${label}: ${describeError(error)}`);
        });
        return result.catch(() => undefined);
    };
    /** Waits until the game has shown `count` more verified frames. */
    const framesAfter = async (game: Game, label: string, count = 3) => {
        const from = game.verified;
        const deadline = performance.now() + 5000;
        while (game.verified < from + count && performance.now() < deadline) await sleep(20);
        if (game.verified < from + count)
            failures.push(`${label}: ${game.verified - from} verified frames in 5 s`);
    };
    const elapsed = () => performance.now() - started;
    const phases: Record<string, unknown>[] = [];
    const phase = async (name: string, body: () => Promise<void>) => {
        const before = { at: elapsed(), view: view.renders, frames: totals.frames };
        await body();
        phases.push({
            name,
            fromMs: Math.round(before.at),
            toMs: Math.round(elapsed()),
            viewportRenders: view.renders - before.view,
            previewFrames: totals.frames - before.frames,
        });
        spike.log(`${name} done at ${Math.round(elapsed())} ms`);
    };

    let game = await createGame();
    await enqueue("first start", async () => {
        await game.preview.start();
        await uploadAtlas(game);
    });
    await framesAfter(game, "first start");

    const steady = Math.max(1000, durationMs / 6);
    await phase("steady 1", () => sleep(steady));

    await phase(`stop/start x${cycles}`, async () => {
        for (let index = 0; index < cycles; index++) {
            // Both calls are issued in the same task; the queue serializes them.
            void enqueue(`stop ${index}`, () => game.preview.app.stop());
            await enqueue(`start ${index}`, async () => {
                await game.preview.app.start();
                await uploadAtlas(game);
            });
            await framesAfter(game, `start ${index}`);
            await sleep(100);
        }
    });

    let maxLive = 0;
    await phase(`dispose/recreate x${cycles}`, async () => {
        for (let index = 0; index < cycles; index++) {
            await enqueue(`recreate ${index}`, async () => {
                const old = game;
                await old.preview.app.dispose();
                old.canvas.remove();
                game = await createGame();
                await game.preview.start();
                await uploadAtlas(game);
            });
            maxLive = Math.max(maxLive, spike.tracker.liveCount());
            await framesAfter(game, `recreate ${index}`);
            await sleep(100);
        }
    });

    await phase("steady 2", () => sleep(Math.max(1000, durationMs - elapsed())));
    const fps = round2(game.preview.app.stats.fps);
    const lifecycle = game.preview.app.game.lifecycle;
    const viewStatus = viewRenderer.status;
    const previewStatus = game.preview.app.renderer?.status ?? "none";
    const liveAtEnd = spike.tracker.liveCount();
    running = false;
    await viewLoop;
    await queue.idle();
    const total = elapsed();
    await enqueue("final dispose", () => game.preview.app.dispose());
    viewRenderer.dispose();

    spike.metric("run", {
        durationMs: Math.round(total),
        cycles,
        phases,
        viewport: { ...view, uploads: queue.stats, status: viewStatus, diagnostics: viewErrors },
        preview: {
            ...totals,
            fps,
            lifecycle,
            status: previewStatus,
            overloadNotices: gameDiagnostics.overload,
            droppedTicks: gameDiagnostics.droppedTicks,
            otherDiagnostics: gameDiagnostics.other,
        },
        devicesCreated: spike.tracker.devices.length,
        maxLiveDevicesAfterRecreate: maxLive,
        liveDevicesAtEnd: liveAtEnd,
        failures,
    });
    spike.check(
        "No diagnostics other than dropped-tick notices",
        viewErrors.length === 0 && gameDiagnostics.other.length === 0,
        [...viewErrors, ...gameDiagnostics.other].slice(0, 5).join(" | ") ||
            `${gameDiagnostics.overload} dropped-tick notices (${gameDiagnostics.droppedTicks} ticks)`,
    );
    spike.check(
        "Every lifecycle call resolved and the preview rendered after each start",
        failures.length === 0,
        failures.slice(0, 5).join(" | "),
    );
    spike.check(
        "Viewport keeps rendering correctly (readback after every draw)",
        view.wrong === 0 &&
            phases.every((entry) => (entry.viewportRenders as number) > 0) &&
            viewStatus === "ready",
        `${view.renders} draws, ${view.wrong} wrong${view.first ? `; ${view.first}` : ""}`,
    );
    spike.check(
        "Preview keeps rendering correctly (readback in afterFrame)",
        totals.wrong === 0 &&
            phases.every((entry) => (entry.previewFrames as number) > 0) &&
            previewStatus === "ready" &&
            lifecycle === "Running",
        `${totals.verified} frames exact, ${totals.wrong} wrong${totals.first ? `; ${totals.first}` : ""}`,
    );
    spike.check(
        `Ran for at least ${durationMs / 1000} s`,
        total >= durationMs,
        `${Math.round(total)} ms`,
    );
    spike.info(
        "Two live devices after every recreate",
        maxLive === 2 && liveAtEnd === 2,
        `max ${maxLive}, at end ${liveAtEnd}; ${spike.tracker.devices.length} devices created`,
    );
    spike.summary("Run length (s)", `${round2(total / 1000)}`);
    spike.summary("Viewport draws exact / wrong", `${view.renders - view.wrong} / ${view.wrong}`);
    spike.summary("Preview frames exact / wrong", `${totals.verified} / ${totals.wrong}`);
    spike.summary(
        "Diagnostics: dropped-tick notices (ticks) / other",
        `${gameDiagnostics.overload} (${gameDiagnostics.droppedTicks}) / ` +
            `${viewErrors.length + gameDiagnostics.other.length}`,
    );
    spike.summary("Preview frames per second at the end", `${fps}`);
});
