import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { captures, documentRect, expectImage, framesUntil, settle, shows } from "./se-011-support";
import type { FrameTimes, TestDocument } from "./se-011-support";
import { documentState, runCommands } from "./se-022-support";
import {
    VIEW,
    WIDTH,
    blendPopover,
    celPopover,
    differenceOf,
    focusInside,
    layerBlend,
    normalOver,
    openTwoLayers,
} from "./se-061-support";

// SE-061 acceptance: changing a blend mode or a cel opacity, and undoing it, updates the
// viewport within two animation frames. Each change is caused at the start of an animation
// frame, once the frames of the one before it have been drawn.

/**
 * Waits until the page is idle after the setup: three animation frames (the timeline draws a
 * change two frames late), then an idle callback, so the measured change shares no frame with
 * work the setup left behind (SE-023 review J).
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
 * Runs a registered command at the start of an animation frame, as an input event comes, and
 * returns in how many animation frames the viewport first showed `images[image]` in full —
 * never anything but `images` on the way.
 */
async function runAndCount(
    page: Page,
    document: TestDocument,
    commandId: string,
    images: number[][],
    image: number,
): Promise<number> {
    await setupDrawn(page);
    const rect = documentRect(document, VIEW);
    const times: FrameTimes = await page.evaluate(
        ({ rect, commandId }) => {
            window.__se011.record(rect);
            const command = window.__ngneTest!.commands.get(commandId);
            if (!command?.enabled()) throw new Error(`Command ${commandId} is not enabled`);
            return window.__se011.atFrameStart(() => void command.run(), 12);
        },
        { rect, commandId },
    );
    const frames = (await captures(page)).filter((capture) => capture.stamp > times.start);
    const seen = frames.map((capture) => shows(capture.crop, images, WIDTH, VIEW.scale));
    expect(seen).not.toContain(-1);
    const at = seen.indexOf(image);
    expect(at).toBeGreaterThanOrEqual(0);
    return framesUntil(times, frames[at]?.stamp ?? Infinity);
}

// @alone: the frame counts are right only when no other worker takes the processor (REVIEW E5).
test("a blend mode chosen in the layer properties popover, and its undo, show in the viewport within two animation frames @alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, lower, upper } = await openTwoLayers(page);
    const difference = differenceOf(lower, upper);
    const images = [upper, difference];

    // The mode is chosen in the popover; nothing changes until it closes.
    await runCommands(page, ["layer.properties"]);
    const popover = blendPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    const select = popover.getByRole("combobox", { name: "Blend mode" });
    await select.click();
    const listbox = page.getByRole("listbox");
    await focusInside(listbox);
    await listbox.getByRole("option", { name: "Difference", exact: true }).click();
    await expect(listbox).toBeHidden();
    await expect(select).toHaveText("Difference");
    await focusInside(popover);
    expect(await layerBlend(page, 1)).toBe("normal");

    // Closing the popover applies it (Apply Layer Properties).
    const applied = await runAndCount(page, document, "layer.applyProperties", images, 1);
    expect(applied).toBeGreaterThanOrEqual(1);
    expect(applied).toBeLessThanOrEqual(2);
    await expect(popover).toBeHidden();
    expect(await layerBlend(page, 1)).toBe("difference");
    expect((await documentState(page)).undoLabel).toBe("Blend Mode");
    await settle(page);
    await expectImage(page, document, VIEW, difference);

    const undone = await runAndCount(page, document, "edit.undo", images, 0);
    expect(undone).toBeGreaterThanOrEqual(1);
    expect(undone).toBeLessThanOrEqual(2);
    expect(await layerBlend(page, 1)).toBe("normal");
    await settle(page);
    await expectImage(page, document, VIEW, upper);
    expect(errors).toEqual([]);
});

test("a cel opacity set in the cel properties popover, and its undo, show in the viewport within two animation frames @alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, lower, upper } = await openTwoLayers(page);
    const half = normalOver(lower, upper, 128);
    const images = [upper, half];

    await runCommands(page, ["frame.celProperties"]);
    const popover = celPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    const field = popover.getByRole("spinbutton", { name: "Opacity" });
    await field.fill("128");
    await field.press("Tab");
    await focusInside(popover);
    expect((await documentState(page)).cels.map((cel) => cel[2])).toEqual([255, 255]);

    const applied = await runAndCount(page, document, "cel.applyProperties", images, 1);
    expect(applied).toBeGreaterThanOrEqual(1);
    expect(applied).toBeLessThanOrEqual(2);
    await expect(popover).toBeHidden();
    expect((await documentState(page)).undoLabel).toBe("Cel Opacity");
    await settle(page);
    await expectImage(page, document, VIEW, half);

    const undone = await runAndCount(page, document, "edit.undo", images, 0);
    expect(undone).toBeGreaterThanOrEqual(1);
    expect(undone).toBeLessThanOrEqual(2);
    await settle(page);
    await expectImage(page, document, VIEW, upper);
    expect(errors).toEqual([]);
});
