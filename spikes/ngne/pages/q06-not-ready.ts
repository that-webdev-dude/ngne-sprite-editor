import { Frame } from "@ngne/core";
import { readCanvas } from "../../../src/engine/testing/readCanvas.ts";
import { describeError, nextFrame, runSpike, sleep } from "../lib/harness.ts";
import {
    bitmapOf,
    camera,
    createPreview,
    createRenderer,
    isOverloadNotice,
    placeDoc,
    readDiff,
} from "../lib/ngne.ts";
import { diffImages, expectedImage, isUniform, makeDoc } from "../lib/pattern.ts";

// Question 6: not-ready textures.
// Method (ticket): reference an unuploaded slot, then gate on first-upload resolution.
// Go: the ungated frame is skipped with one diagnostic; the gated path produces none.

const SLOT = "ed:f:0";
const CLEAR_A = 0x103010;
const CLEAR_B = 0x301010;
const SIZE = 96;

runSpike(6, async (spike) => {
    const stage = document.querySelector<HTMLElement>("#stage");
    if (!stage) throw new Error("Missing stage");
    const doc = makeDoc(32, 32, 6);
    const placement = { doc, x: 16, y: 16, scale: 2 };
    const view = camera(false);
    const newCanvas = () => {
        const canvas = document.createElement("canvas");
        stage.append(canvas);
        return canvas;
    };

    // ---- Ungated: the frame references a slot that was never uploaded -----------------------
    const ungated: string[] = [];
    const first = newCanvas();
    const rendererA = await createRenderer(first, SIZE, SIZE, (error) =>
        ungated.push(describeError(error)),
    );
    const frame = new Frame();
    frame.scene(view, 1);
    frame.rect(SIZE / 2, SIZE / 2, 32, 32, 0xff0000);
    rendererA.render(frame, CLEAR_A);
    const baseline = { sprites: rendererA.sprites, drawCalls: rendererA.drawCalls };
    await nextFrame();
    await nextFrame();

    frame.reset();
    frame.scene(view, 1);
    frame.rect(SIZE / 2, SIZE / 2, 32, 32, 0x00ff00);
    placeDoc(frame, SLOT, placement, 1);
    rendererA.render(frame, CLEAR_B);
    const skipped = { sprites: rendererA.sprites, drawCalls: rendererA.drawCalls };
    const afterOne = ungated.length;
    // What an in-page readback returns for a skipped frame (recorded only).
    const skippedImage = readCanvas(first);
    const skippedReadback = isUniform(skippedImage.data)
        ? `uniform ${[...skippedImage.data.slice(0, 4)].join(",")}`
        : "not uniform";
    for (let repeat = 0; repeat < 5; repeat++) {
        await nextFrame();
        rendererA.render(frame, CLEAR_B);
    }
    const afterRepeats = ungated.length;
    spike.metric("ungated", {
        baseline,
        skipped,
        diagnosticsAfterOneFrame: afterOne,
        diagnosticsAfterSixFrames: afterRepeats,
        messages: [...ungated],
        readbackOfSkippedFrame: skippedReadback,
        status: rendererA.status,
    });
    spike.check(
        "Ungated frame is skipped (no sprite, no draw call submitted)",
        skipped.sprites === 0 && skipped.drawCalls === 0 && baseline.sprites === 1,
        `sprites ${skipped.sprites}, draw calls ${skipped.drawCalls}; renderer ${rendererA.status}`,
    );
    spike.check(
        "Ungated frame reports exactly one diagnostic",
        afterOne === 1 && /not ready/i.test(ungated[0] ?? ""),
        `${afterOne} diagnostic(s): ${ungated[0] ?? ""}`,
    );
    spike.info(
        "Five more ungated frames add no diagnostic (one per fault episode)",
        afterRepeats === 1,
        `${afterRepeats} diagnostics after six ungated frames`,
    );

    // The same renderer recovers as soon as the slot is uploaded.
    const bitmapA = await bitmapOf(doc);
    await rendererA.texture(SLOT, bitmapA);
    bitmapA.close();
    rendererA.render(frame, CLEAR_B);
    const recovered = diffImages(
        readCanvas(first).data,
        expectedImage(SIZE, SIZE, CLEAR_B, [placement]),
        SIZE,
    );
    spike.info(
        "After the upload the same frame renders",
        recovered.count === 0 && rendererA.sprites === 2,
        recovered.count ? recovered.first : "",
    );
    rendererA.dispose();

    // ---- Gated: the slot is referenced only after its first upload has resolved -------------
    const gated: string[] = [];
    const second = newCanvas();
    const rendererB = await createRenderer(second, SIZE, SIZE, (error) =>
        gated.push(describeError(error)),
    );
    let ready = false;
    let framesBefore = 0;
    const build = () => {
        frame.reset();
        frame.scene(view, 1);
        if (ready) placeDoc(frame, SLOT, placement, 1);
        rendererB.render(frame, CLEAR_A);
    };
    const bitmapB = await bitmapOf(doc);
    const pending = rendererB.texture(SLOT, bitmapB).then(() => {
        ready = true;
    });
    // Draw every animation frame while the upload is in flight, as a stroke would.
    while (!ready) {
        build();
        framesBefore++;
        await Promise.race([pending, nextFrame()]);
    }
    await pending;
    bitmapB.close();
    build();
    const gatedDiff = readDiff(second, CLEAR_A, [placement]);
    spike.metric("gated", {
        framesBeforeUploadResolved: framesBefore,
        diagnostics: [...gated],
        differingPixels: gatedDiff.count,
    });
    spike.check(
        "Gated path produces no diagnostic and draws the slot once it is ready",
        gated.length === 0 && gatedDiff.count === 0,
        `${gated.length} diagnostics, ${framesBefore} frame(s) drawn before the upload resolved` +
            (gatedDiff.count ? `; ${gatedDiff.first}` : ""),
    );
    rendererB.dispose();

    // ---- Recorded only: the same mistake inside a BrowserGame (preview panel) ---------------
    const notices: string[] = [];
    let overload = 0;
    let frames = 0;
    const third = newCanvas();
    const preview = createPreview({
        canvas: third,
        width: SIZE,
        height: SIZE,
        clear: CLEAR_A,
        pixelSnap: false,
        draw: (target) => placeDoc(target, "pv:atlas", placement),
        diagnostic: (error) => {
            if (isOverloadNotice(error)) overload++;
            else notices.push(describeError(error));
        },
        afterFrame: () => {
            frames++;
        },
    });
    await preview.start();
    await sleep(500);
    const lifecycle = preview.app.game.lifecycle;
    const framesUngated = frames;
    spike.metric("previewUngated", {
        frames: framesUngated,
        diagnostics: [...notices],
        overloadNotices: overload,
        lifecycle,
    });
    spike.info(
        "BrowserGame: ungated frames report one diagnostic and the game keeps running",
        notices.length === 1 && lifecycle === "Running" && framesUngated > 1,
        `${notices.length} diagnostic(s) over ${framesUngated} frames, lifecycle ${lifecycle}: ` +
            (notices[0] ?? ""),
    );
    await preview.app.dispose();

    spike.summary(
        "Ungated: diagnostics after 1 frame / after 6 frames",
        `${afterOne} / ${afterRepeats}`,
    );
    spike.summary("Ungated: diagnostic text", ungated[0] ?? "(none)");
    spike.summary(
        "Ungated: sprites, draw calls submitted",
        `${skipped.sprites}, ${skipped.drawCalls}`,
    );
    spike.summary("Gated: diagnostics", `${gated.length}`);
    spike.summary(
        "BrowserGame ungated (recorded): diagnostics, lifecycle",
        `${notices.length}, ${lifecycle}`,
    );
});
