import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import {
    addFrame,
    captures,
    documentRect,
    expectImage,
    framesUntil,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
    shows,
} from "./se-011-support";
import type { FrameTimes, TestDocument } from "./se-011-support";
import { cell, documentState, layerHeader, runCommands, viewport } from "./se-022-support";
import { expectWithinBudget } from "./se-070-frame-budget";

// SE-022: what the timeline does to the viewport — a layer's visibility, and the frame a click
// or a key makes active, shown from the composite cache.

const VIEW = { scale: 8, originX: 64, originY: 40 };
const WIDTH = 5;
const HEIGHT = 3;

/**
 * A 5 × 3 document with two layers, each painted with an opaque pattern of its own: the
 * viewport shows the upper one.
 */
async function openTwoLayers(page: Page): Promise<{
    document: TestDocument;
    lower: number[];
    upper: number[];
}> {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const lower = pattern(WIDTH, HEIGHT, 1);
    const upper = pattern(WIDTH, HEIGHT, 7);
    await paint(page, document.id, lower);
    await runCommands(page, ["layer.new"]);
    await paint(page, document.id, upper);
    await settle(page);
    await expectImage(page, document, VIEW, upper);
    return { document, lower, upper };
}

/**
 * Waits until the timeline has drawn the setup's last change and the page is idle: three
 * animation frames (the panel draws two frames and an idle callback after a change, SE-022),
 * then an idle callback. The measured toggle then does not share its frames with work the
 * setup left behind (SE-023 review J).
 */
function setupDrawn(page: Page): Promise<void> {
    return page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                let left = 3;
                const next = () => {
                    if (--left > 0) requestAnimationFrame(next);
                    else requestIdleCallback(() => resolve());
                };
                requestAnimationFrame(next);
            }),
    );
}

/**
 * Clicks the upper layer's visibility toggle at the start of an animation frame, as a pointer
 * event comes, and returns in how many animation frames the viewport first showed `image` in
 * full — never anything but the two images on the way.
 */
async function toggleUpper(
    page: Page,
    document: TestDocument,
    images: number[][],
    image: number,
): Promise<number> {
    await setupDrawn(page);
    const rect = documentRect(document, VIEW);
    const toggle = layerHeader(page, "Layer 2").getByRole("button", { name: "Visible" });
    const handle = await toggle.elementHandle();
    const times: FrameTimes = await page.evaluate(
        ({ rect, button }) => {
            window.__se011.record(rect);
            return window.__se011.atFrameStart(() => (button as HTMLButtonElement).click(), 12);
        },
        { rect, button: handle },
    );
    const frames = (await captures(page)).filter((capture) => capture.stamp > times.start);
    const seen = frames.map((capture) => shows(capture.crop, images, WIDTH, VIEW.scale));
    expect(seen).not.toContain(-1);
    const at = seen.indexOf(image);
    expect(at).toBeGreaterThanOrEqual(0);
    return framesUntil(times, frames[at]?.stamp ?? Infinity);
}

// @alone: the frame counts are right only when no other worker takes the processor (REVIEW E5).
test("toggling a layer's visibility in the timeline changes the viewport image within two animation frames @alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, lower, upper } = await openTwoLayers(page);
    const images = [lower, upper];

    const hidden = await toggleUpper(page, document, images, 0);
    expect(hidden).toBeGreaterThanOrEqual(1);
    expectWithinBudget(hidden, 2, "animation frames to show the hidden layer");
    expect((await documentState(page)).layers[1]?.visible).toBe(false);
    // Each toggle is caused once the frames of the one before it have been drawn.
    await settle(page);
    await expectImage(page, document, VIEW, lower);

    const shown = await toggleUpper(page, document, images, 1);
    expect(shown).toBeGreaterThanOrEqual(1);
    expectWithinBudget(shown, 2, "animation frames to show the shown layer");
    await settle(page);
    await expectImage(page, document, VIEW, upper);
    expect(errors).toEqual([]);
});

test("a click on a cel shows its frame; on the canvas ← and → step through the frames", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const images = [1, 2, 3].map((seed) => pattern(WIDTH, HEIGHT, seed));
    await paint(page, document.id, images[0] ?? []);
    for (const image of images.slice(1)) {
        await addFrame(page, document.id);
        await paint(page, document.id, image);
    }
    await settle(page);
    await expectImage(page, document, VIEW, images[2] ?? []);

    await cell(page, "Layer 1", 1).click();
    await settle(page);
    await expectImage(page, document, VIEW, images[0] ?? []);
    expect((await documentState(page)).activeFrame).toBe(1);

    await viewport(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await documentState(page)).activeFrame).toBe(2);
    await settle(page);
    await expectImage(page, document, VIEW, images[1] ?? []);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await documentState(page)).activeFrame).toBe(1);
    await settle(page);
    await expectImage(page, document, VIEW, images[0] ?? []);
    expect(errors).toEqual([]);
});
