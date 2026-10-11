import { Frame } from "@ngne/core";
import type { WebGPURenderer } from "@ngne/core";
import { readCanvas } from "../../../src/engine/testing/readCanvas.ts";
import {
    describeError,
    integerParam,
    nextFrame,
    nextTask,
    round2,
    runSpike,
    sleep,
} from "../lib/harness.ts";
import {
    camera,
    createPreview,
    createRenderer,
    isOverloadNotice,
    placeDoc,
    readDiff,
    upload,
} from "../lib/ngne.ts";
import { diffImages, expectedImage, makeDoc } from "../lib/pattern.ts";
import { Q8_CANVAS, Q8_CLEAR, q8Placements } from "../lib/scenes.ts";

// Question 8: device loss.
// Method (ticket): wrap `GPUAdapter.prototype.requestDevice` before creating the renderer,
// keep the device, call `destroy()`.
// Go: NGNE returns to `ready` and manual slots show their content again within 2 s; polling
// per SPEC §6.4 redraws without user input.

const GO_MS = 2000;
const POLL_MS = 1000;
const OBSERVE_MS = 3000;
const scene = q8Placements();
const placements = scene.map((entry) => entry.placement);

runSpike(8, async (spike) => {
    const phases = (spike.params.get("phases") ?? "50,250,500,750,950").split(",").map(Number);
    const trials = integerParam(spike.params, "trials", 3);
    const stage = document.querySelector<HTMLElement>("#stage");
    if (!stage) throw new Error("Missing stage");
    const canvas = document.createElement("canvas");
    canvas.id = "viewport-canvas";
    canvas.style.cssText =
        `width:${Q8_CANVAS.width / devicePixelRatio}px;` +
        `height:${Q8_CANVAS.height / devicePixelRatio}px`;
    stage.append(canvas);

    const errors: string[] = [];
    const renderer: WebGPURenderer = await createRenderer(
        canvas,
        Q8_CANVAS.width,
        Q8_CANVAS.height,
        (error) => errors.push(describeError(error)),
    );
    for (const { slot, placement } of scene) await upload(renderer, slot, placement.doc);
    const frame = new Frame();
    const view = camera(false);
    const draw = () => {
        frame.reset();
        frame.scene(view, 1);
        scene.forEach(({ slot, placement }, layer) => placeDoc(frame, slot, placement, layer));
        renderer.render(frame, Q8_CLEAR);
    };
    const exact = () => readDiff(canvas, Q8_CLEAR, placements).count === 0;
    /** Destroys the renderer's current device, as a driver reset would. */
    const lose = () => {
        const tracked = spike.tracker.latestLive();
        if (!tracked) throw new Error("No live device to destroy");
        tracked.device.destroy();
    };
    /** Watches `status` every task: when it left `ready` and when it came back. */
    const watch = async (from: number, limit: number, target: WebGPURenderer = renderer) => {
        let recoveringMs: number | null = null;
        let readyMs: number | null = null;
        while (performance.now() - from < limit) {
            const status = target.status;
            if (status === "failed") break;
            if (status === "recovering") recoveringMs ??= performance.now() - from;
            else if (status === "ready" && recoveringMs !== null) {
                readyMs = performance.now() - from;
                break;
            }
            await nextTask();
        }
        return { recoveringMs, readyMs };
    };

    // ---- A: time back to `ready`, and the slots after an explicit draw ----------------------
    draw();
    const initialExact = exact();
    const recoveries: {
        recoveringMs: number | null;
        readyMs: number | null;
        shownMs: number | null;
    }[] = [];
    for (let trial = 0; trial < trials; trial++) {
        await sleep(200);
        const from = performance.now();
        lose();
        const seen = await watch(from, 10000);
        let shownMs: number | null = null;
        if (seen.readyMs !== null) {
            draw();
            if (exact()) shownMs = performance.now() - from;
        }
        recoveries.push({ ...seen, shownMs });
        spike.log(`loss ${trial}: ready after ${seen.readyMs} ms, shown after ${shownMs} ms`);
    }
    const slowestReady = Math.max(...recoveries.map((entry) => entry.readyMs ?? Infinity));
    const slowestShown = Math.max(...recoveries.map((entry) => entry.shownMs ?? Infinity));
    spike.metric("recovery", {
        initialExact,
        trials: recoveries,
        devicesCreated: spike.tracker.devices.length,
    });
    spike.samples(
        "readyMs",
        recoveries.map((entry) => entry.readyMs ?? -1),
    );
    spike.check(
        `NGNE returns to ready within ${GO_MS} ms of device.destroy()`,
        initialExact && slowestReady <= GO_MS,
        `slowest ${round2(slowestReady)} ms over ${trials} losses`,
    );
    spike.check(
        `Manual slots show their content again within ${GO_MS} ms (draw after ready, readback exact)`,
        slowestShown <= GO_MS,
        `slowest ${round2(slowestShown)} ms`,
    );

    // ---- B and C: the on-demand viewport loop of SPEC §6.4, left idle -----------------------
    // B reads `status` on a 1 s timer and marks the view dirty on a transition back to ready.
    // C (recorded, a candidate if B fails) also treats `renderer.sprites === 0` after a draw
    // that had sprites as a loss: NGNE zeroes that counter when the device is lost.
    const idleViewport = async (useSpritesSignal: boolean) => {
        let dirty = false;
        let scheduled = false;
        let draws = 0;
        let lastDrawAt = 0;
        let lastExact = false;
        let drewSprites = 0;
        let lastStatus = renderer.status;
        let polled: string[] = [];
        let onPoll: (() => void) | undefined;
        const tick = () => {
            scheduled = false;
            if (!dirty) return;
            if (renderer.status !== "ready") {
                // Not ready at draw time: keep the dirty flag, retry next animation frame.
                schedule();
                return;
            }
            draw();
            lastExact = exact();
            drewSprites = renderer.sprites;
            dirty = false;
            draws++;
            lastDrawAt = performance.now();
        };
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(tick);
        };
        const markDirty = () => {
            dirty = true;
            schedule();
        };
        const timer = setInterval(() => {
            if (document.visibilityState !== "visible") return;
            const status = renderer.status;
            polled.push(status);
            if (status !== lastStatus) {
                lastStatus = status;
                if (status === "ready") markDirty();
            }
            if (useSpritesSignal && drewSprites > 0 && renderer.sprites === 0) markDirty();
            onPoll?.();
        }, POLL_MS);

        const results = [];
        for (const phase of phases) {
            markDirty();
            while (dirty) await nextFrame();
            await new Promise<void>((resolve) => {
                onPoll = resolve;
            });
            onPoll = undefined;
            await sleep(phase);
            polled = [];
            const drawsBefore = draws;
            const from = performance.now();
            lose();
            const seen = await watch(from, OBSERVE_MS);
            await sleep(Math.max(0, OBSERVE_MS - (performance.now() - from)));
            const redrawn = draws > drawsBefore;
            results.push({
                lossMsAfterPoll: phase,
                readyMs: seen.readyMs === null ? null : round2(seen.readyMs),
                statusSeenByPoll: [...polled],
                redrawn,
                redrawMs: redrawn ? round2(lastDrawAt - from) : null,
                redrawExact: redrawn && lastExact,
            });
            spike.log(
                `${useSpritesSignal ? "C" : "B"} loss ${phase} ms after a poll: ` +
                    `polled ${polled.join(",")}, redrawn ${redrawn}`,
            );
        }
        clearInterval(timer);
        return results;
    };

    const polling = await idleViewport(false);
    const pollingRedrawn = polling.filter((entry) => entry.redrawExact).length;
    spike.metric("statusPolling", polling);
    spike.check(
        "Polling per SPEC §6.4 (status on a 1 s timer) redraws without user input",
        pollingRedrawn === polling.length,
        `${pollingRedrawn}/${polling.length} losses redrawn within ${OBSERVE_MS} ms; ` +
            `status seen by the timer: ${polling.map((entry) => entry.statusSeenByPoll.join(">")).join(" | ")}`,
    );

    const candidate = await idleViewport(true);
    const candidateRedrawn = candidate.filter((entry) => entry.redrawExact).length;
    const candidateSlowest = Math.max(...candidate.map((entry) => entry.redrawMs ?? Infinity));
    spike.metric("spritesSignalPolling", candidate);
    spike.info(
        "Candidate: the 1 s timer also treats renderer.sprites === 0 after a draw as a loss",
        candidateRedrawn === candidate.length && candidateSlowest <= GO_MS,
        `${candidateRedrawn}/${candidate.length} losses redrawn, slowest ${round2(candidateSlowest)} ms`,
    );

    // ---- D, recorded only: the preview's BrowserGame draws every frame ----------------------
    const gameCanvas = document.createElement("canvas");
    gameCanvas.style.cssText =
        "width:128px;height:128px;image-rendering:pixelated;pointer-events:none";
    stage.append(gameCanvas);
    const atlas = makeDoc(32, 32, 14);
    const sprite = { doc: atlas, x: 16, y: 16, scale: 1 };
    const want = expectedImage(64, 64, 0x283848, [sprite]);
    const notices: string[] = [];
    const game = { ready: false, exactAt: [] as number[], wrong: 0 };
    const preview = createPreview({
        canvas: gameCanvas,
        width: 64,
        height: 64,
        clear: 0,
        pixelSnap: false,
        draw: (target) => {
            if (!game.ready) return;
            target.rect(32, 32, 64, 64, 0x283848);
            placeDoc(target, "pv:atlas", sprite, 1);
        },
        diagnostic: (error) => {
            if (!isOverloadNotice(error)) notices.push(describeError(error));
        },
        afterFrame: () => {
            if (!game.ready) return;
            const image = readCanvas(gameCanvas);
            if (diffImages(image.data, want, image.width).count === 0)
                game.exactAt.push(performance.now());
            else game.wrong++;
        },
    });
    await preview.start();
    const gameRenderer = preview.app.renderer;
    if (!gameRenderer) throw new Error("renderer is undefined after start() resolved");
    await upload(gameRenderer, "pv:atlas", atlas);
    game.ready = true;
    await sleep(500);
    const exactBefore = game.exactAt.length;
    const lostAt = performance.now();
    lose();
    // Frames drawn before NGNE notices the loss can still read back as the old image, so
    // "restored" is the first exact frame after `status` has returned to ready.
    const gameSeen = await watch(lostAt, OBSERVE_MS, gameRenderer);
    await sleep(Math.max(0, OBSERVE_MS - (performance.now() - lostAt)));
    const readyAt = gameSeen.readyMs === null ? Infinity : lostAt + gameSeen.readyMs;
    const firstAfter = game.exactAt.find((time) => time >= readyAt);
    const restoredMs = firstAfter === undefined ? null : round2(firstAfter - lostAt);
    const lifecycle = preview.app.game.lifecycle;
    spike.metric("previewLoss", {
        exactFramesBefore: exactBefore,
        exactFramesAfterReady: game.exactAt.filter((time) => time >= readyAt).length,
        framesNotExactDuringRecovery: game.wrong,
        readyMs: gameSeen.readyMs === null ? null : round2(gameSeen.readyMs),
        restoredMs,
        diagnostics: [...notices],
        lifecycle,
        status: gameRenderer.status,
    });
    spike.info(
        `BrowserGame: frames are exact again within ${GO_MS} ms of its device loss, no diagnostic`,
        restoredMs !== null &&
            restoredMs <= GO_MS &&
            notices.length === 0 &&
            lifecycle === "Running",
        `restored after ${restoredMs} ms, lifecycle ${lifecycle}` +
            (notices.length ? `; diagnostics: ${notices.join(" | ")}` : ""),
    );
    await preview.app.dispose();
    gameCanvas.remove();

    spike.check("No renderer diagnostic", errors.length === 0, errors.join(" | "));
    spike.summary(
        "Back to ready after destroy(): each loss (ms)",
        recoveries
            .map((entry) => (entry.readyMs === null ? "never" : round2(entry.readyMs)))
            .join(", "),
    );
    spike.summary(
        "Slots shown again after an explicit draw: slowest (ms)",
        `${round2(slowestShown)}`,
    );
    spike.summary(
        "Idle viewport, status polled every 1 s: losses redrawn",
        `${pollingRedrawn}/${polling.length}`,
    );
    spike.summary(
        "Idle viewport, status seen by the 1 s timer after each loss",
        polling.map((entry) => entry.statusSeenByPoll.join(">") || "-").join(" | "),
    );
    spike.summary(
        "Candidate (sprites counter): losses redrawn, slowest redraw (ms)",
        `${candidateRedrawn}/${candidate.length}, ${round2(candidateSlowest)}`,
    );
    spike.summary("BrowserGame: frames exact again after (ms)", `${restoredMs}`);

    // Left for the runner's screenshot: the image is presented, the device is lost, NGNE is
    // ready again and nothing is redrawn. The runner records what the canvas then shows.
    draw();
    await nextFrame();
    await nextFrame();
    const from = performance.now();
    lose();
    await watch(from, 5000);
    await sleep(300);
    spike.metric("finalState", { status: renderer.status, redrawn: false });
});
