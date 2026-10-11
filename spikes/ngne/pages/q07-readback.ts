import { Frame } from "@ngne/core";
import { readCanvas } from "../../../src/engine/testing/readCanvas.ts";
import { describeError, nextFrame, nextTask, runSpike, sleep } from "../lib/harness.ts";
import {
    camera,
    createPreview,
    createRenderer,
    isOverloadNotice,
    placeDoc,
    readDiff,
    upload,
} from "../lib/ngne.ts";
import { diffImages, expectedImage, type Doc } from "../lib/pattern.ts";
import {
    Q7_BARE,
    Q7_CLEAR,
    Q7_GAME,
    Q7_GAME_BG,
    q7BarePlacements,
    q7GamePlacements,
} from "../lib/scenes.ts";

// Question 7 (S): readback and screenshots.
// Method (ticket): `readCanvas` after `render()` and inside `afterFrame`; Playwright screenshot
// of the same canvas; DPR 1.5 emulation; `devicePixelContentBoxSize` under emulation.
// Go: readback exact for opaque texels in all modes; screenshot exact at DPR 1.
// This page does the readbacks; the runner takes the screenshots of #bare and #game after
// the result is published and adds those checks. One run per DPR.

const SLOT = "ed:f:0";

function contentBoxes(elements: readonly Element[]): Promise<Map<Element, [number, number]>> {
    return new Promise((resolve) => {
        const sizes = new Map<Element, [number, number]>();
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const box = entry.devicePixelContentBoxSize?.[0];
                if (box) sizes.set(entry.target, [box.inlineSize, box.blockSize]);
            }
            observer.disconnect();
            resolve(sizes);
        });
        for (const element of elements)
            observer.observe(element, { box: "device-pixel-content-box" });
    });
}

runSpike(7, async (spike) => {
    spike.variant ||= `DPR ${devicePixelRatio}`;
    const stage = document.querySelector<HTMLElement>("#stage");
    if (!stage) throw new Error("Missing stage");
    stage.style.height = "260px";
    const css = (pixels: number) => `${pixels / devicePixelRatio}px`;
    const addCanvas = (id: string, left: number, top: number, width: number, height: number) => {
        const canvas = document.createElement("canvas");
        canvas.id = id;
        canvas.style.cssText =
            `position:absolute;left:${left}px;top:${top}px;width:${css(width)};` +
            `height:${css(height)};image-rendering:pixelated;pointer-events:none`;
        stage.append(canvas);
        return canvas;
    };

    // ---- Bare renderer: readback after render() ---------------------------------------------
    const bare = addCanvas("bare", 12, 12, Q7_BARE.width, Q7_BARE.height);
    const errors: string[] = [];
    const renderer = await createRenderer(bare, Q7_BARE.width, Q7_BARE.height, (error) =>
        errors.push(describeError(error)),
    );
    const placements = q7BarePlacements();
    const first = placements[0];
    if (!first) throw new Error("Missing placement");
    await upload(renderer, SLOT, first.doc);
    const frame = new Frame();
    const view = camera(false);
    const draw = () => {
        frame.reset();
        frame.scene(view, 1);
        placeDoc(frame, SLOT, first);
        renderer.render(frame, Q7_CLEAR);
    };
    const read = () => readDiff(bare, Q7_CLEAR, placements).count;

    draw();
    const sameTask = read();
    draw();
    await Promise.resolve();
    const afterMicrotask = read();
    draw();
    await nextTask();
    const afterTask = read();
    draw();
    await nextFrame();
    await nextFrame();
    const afterFrames = read();
    spike.check(
        "Bare renderer: readback in the task of render() is exact",
        sameTask === 0,
        `${sameTask} differing pixels`,
    );
    spike.info(
        "Readback is still exact after a microtask",
        afterMicrotask === 0,
        `${afterMicrotask} differing pixels`,
    );
    // SPEC §6.7 reads the canvas "in the same task as the render"; these two record why.
    spike.info(
        "Readback in the next task is no longer the image",
        afterTask !== 0,
        `${afterTask} differing pixels`,
    );
    spike.info(
        "Readback two animation frames later is no longer the image",
        afterFrames !== 0,
        `${afterFrames} differing pixels`,
    );

    // ---- Recorded only: partially transparent texels ---------------------------------------
    const alphas = [0, 1, 64, 128, 192, 254, 255];
    const colors = [
        [255, 0, 0],
        [0, 255, 0],
        [10, 130, 250],
        [255, 255, 255],
    ];
    // One column per alpha, one row per colour, drawn at 4 device pixels per texel.
    const columns = alphas.length;
    const translucent: Doc = {
        width: columns,
        height: colors.length,
        pixels: new Uint8ClampedArray(columns * colors.length * 4),
    };
    const pixels = translucent.pixels;
    colors.forEach((color, y) =>
        alphas.forEach((alpha, x) => pixels.set([...color, alpha], (y * columns + x) * 4)),
    );
    const alphaWidth = columns * 4;
    const alphaHeight = colors.length * 4;
    const alphaCanvas = addCanvas("alpha", 12, 220, alphaWidth, alphaHeight);
    const alphaRenderer = await createRenderer(alphaCanvas, alphaWidth, alphaHeight, (error) =>
        errors.push(describeError(error)),
    );
    await upload(alphaRenderer, SLOT, translucent);
    frame.reset();
    frame.scene(view, 1);
    placeDoc(frame, SLOT, { doc: translucent, x: 0, y: 0, scale: 4 });
    alphaRenderer.render(frame, Q7_CLEAR);
    const blended = readCanvas(alphaCanvas).data;
    const clear = [(Q7_CLEAR >>> 16) & 255, (Q7_CLEAR >>> 8) & 255, Q7_CLEAR & 255];
    let maxError = 0;
    let opaqueError = 0;
    for (let y = 0; y < alphaHeight; y++)
        for (let x = 0; x < alphaWidth; x++) {
            const source = (Math.floor(y / 4) * columns + Math.floor(x / 4)) * 4;
            const alpha = (pixels[source + 3] ?? 0) / 255;
            for (let channel = 0; channel < 3; channel++) {
                const want =
                    (pixels[source + channel] ?? 0) * alpha + (clear[channel] ?? 0) * (1 - alpha);
                const error = Math.abs((blended[(y * alphaWidth + x) * 4 + channel] ?? 0) - want);
                if (alpha === 1 || alpha === 0) opaqueError = Math.max(opaqueError, error);
                else maxError = Math.max(maxError, error);
            }
        }
    spike.info(
        "Partially transparent texels are within 1 of the blend over the clear colour",
        maxError <= 1 && opaqueError === 0,
        `largest channel error ${maxError.toFixed(3)}; alpha 0 and 255 error ${opaqueError}`,
    );
    alphaRenderer.dispose();

    // ---- BrowserGame: readback inside afterFrame --------------------------------------------
    const k = Q7_GAME.k;
    const gameCanvas = addCanvas("game", 12, 96, Q7_GAME.width * k, Q7_GAME.height * k);
    const gamePlacements = q7GamePlacements();
    const sprite = gamePlacements[0];
    if (!sprite) throw new Error("Missing placement");
    const want = expectedImage(Q7_GAME.width, Q7_GAME.height, Q7_GAME_BG, gamePlacements);
    const notices: string[] = [];
    const game = { ready: false, exact: 0, wrong: 0, first: "" };
    const preview = createPreview({
        canvas: gameCanvas,
        width: Q7_GAME.width,
        height: Q7_GAME.height,
        clear: Q7_CLEAR,
        pixelSnap: false,
        draw: (target) => {
            if (!game.ready) return;
            target.rect(
                Q7_GAME.width / 2,
                Q7_GAME.height / 2,
                Q7_GAME.width,
                Q7_GAME.height,
                Q7_GAME_BG,
            );
            placeDoc(target, "pv:atlas", sprite, 1);
        },
        diagnostic: (error) => {
            if (!isOverloadNotice(error)) notices.push(describeError(error));
        },
        afterFrame: () => {
            if (!game.ready) return;
            const image = readCanvas(gameCanvas);
            const diff = diffImages(image.data, want, image.width);
            if (diff.count) {
                game.wrong++;
                game.first ||= diff.first;
            } else game.exact++;
        },
    });
    await preview.start();
    const gameRenderer = preview.app.renderer;
    if (!gameRenderer) throw new Error("renderer is undefined after start() resolved");
    await upload(gameRenderer, "pv:atlas", sprite.doc);
    game.ready = true;
    for (let wait = 0; wait < 100 && game.exact + game.wrong < 10; wait++) await sleep(20);
    spike.check(
        "BrowserGame: readback inside afterFrame is exact",
        game.exact >= 10 && game.wrong === 0 && notices.length === 0,
        `${game.exact} frames exact, ${game.wrong} wrong` +
            (game.first ? `; ${game.first}` : "") +
            (notices.length ? `; diagnostics: ${notices.join(" | ")}` : ""),
    );

    // ---- devicePixelContentBoxSize under emulation ------------------------------------------
    const boxes = [
        [64, 44],
        [100, 50],
        [100.5, 50.25],
        [33.3, 33.3],
        [101, 51],
    ].map(([width, height], index) => {
        const box = document.createElement("div");
        box.style.cssText =
            `position:absolute;left:${220 + index * 7.3}px;top:${12 + index * 40.7}px;` +
            `width:${width}px;height:${height}px`;
        stage.append(box);
        return box;
    });
    const sizes = await contentBoxes([bare, gameCanvas, ...boxes]);
    const reported = [bare, gameCanvas, ...boxes].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
            element: element.id || "box",
            css: [rect.width, rect.height],
            cssTimesDpr: [rect.width * devicePixelRatio, rect.height * devicePixelRatio],
            devicePixelContentBox: sizes.get(element) ?? null,
        };
    });
    const bareBox = sizes.get(bare);
    const gameBox = sizes.get(gameCanvas);
    spike.metric("devicePixelContentBox", reported);
    spike.info(
        "devicePixelContentBoxSize equals the backing size of both canvases",
        bareBox?.[0] === Q7_BARE.width &&
            bareBox[1] === Q7_BARE.height &&
            gameBox?.[0] === Q7_GAME.width * k &&
            gameBox[1] === Q7_GAME.height * k,
        `bare ${bareBox?.join("x") ?? "none"} (backing ${Q7_BARE.width}x${Q7_BARE.height}), ` +
            `game ${gameBox?.join("x") ?? "none"} (${Q7_GAME.width * k}x${Q7_GAME.height * k})`,
    );

    spike.check("No renderer diagnostic", errors.length === 0, errors.join(" | "));
    spike.metric("readback", {
        bare: { sameTask, afterMicrotask, afterTask, afterFrames },
        game: { ...game },
        translucent: { maxChannelError: maxError, opaqueChannelError: opaqueError },
    });
    spike.summary("Readback after render(): differing pixels", `${sameTask}`);
    spike.summary("Readback in afterFrame: frames exact / wrong", `${game.exact} / ${game.wrong}`);
    spike.summary(
        "Readback after a microtask / in the next task / two frames later: differing pixels (recorded)",
        `${afterMicrotask} / ${afterTask} / ${afterFrames}`,
    );
    spike.summary("Partially transparent texels: largest channel error", maxError.toFixed(2));
    spike.summary(
        "devicePixelContentBoxSize of the two canvases",
        `${bareBox?.join("x") ?? "none"}, ${gameBox?.join("x") ?? "none"}`,
    );

    // Leave both canvases showing their image for the runner's screenshots: the bare canvas
    // is drawn once more and stays idle, the game keeps running.
    draw();
    await nextFrame();
    await nextFrame();
});
