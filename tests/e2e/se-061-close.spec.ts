import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { documentState, runCommands } from "./se-022-support";
import { blendPopover, celPopover, focusInside, openTwoLayers } from "./se-061-support";

// SE-061 CI: closing a timeline popover in its history step does not position it again. The
// close rendered the host once with nothing shown, which gave the popover a new anchor; Radix
// then measured and positioned it in a task of its own between the step and the frames the
// viewport has to show it in, and on the CI runner the viewport missed them
// (se-061-viewport). The popover keeps its place until it is taken down.

/**
 * Counts, from now on, the element measurements made while positioning a floating element
 * (Floating UI's `computePosition`, under Radix's popper).
 */
function countPositioning(page: Page): Promise<void> {
    return page.evaluate(() => {
        const measure = Element.prototype.getBoundingClientRect;
        const counter = window as unknown as { __se061Positioning: number };
        counter.__se061Positioning = 0;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            if (new Error().stack?.includes("computePosition")) counter.__se061Positioning++;
            return measure.call(this);
        };
    });
}

function positioning(page: Page): Promise<number> {
    return page.evaluate(
        () => (window as unknown as { __se061Positioning: number }).__se061Positioning,
    );
}

/** Runs `commandId`, which closes `popover`, and waits until the popover is gone. */
async function closeBy(page: Page, popover: Locator, commandId: string): Promise<number> {
    await countPositioning(page);
    await runCommands(page, [commandId]);
    await expect(popover).toBeHidden();
    return positioning(page);
}

test("the layer properties popover is not positioned again when its history step closes it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTwoLayers(page);
    await runCommands(page, ["layer.properties"]);
    const popover = blendPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    await popover.getByRole("textbox", { name: "Name" }).fill("Glow");

    expect(await closeBy(page, popover, "layer.applyProperties")).toBe(0);
    expect((await documentState(page)).layers[1]?.name).toBe("Glow");
    expect(errors).toEqual([]);
});

test("the cel properties popover is not positioned again when its history step closes it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTwoLayers(page);
    await runCommands(page, ["frame.celProperties"]);
    const popover = celPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    const field = popover.getByRole("spinbutton", { name: "Opacity" });
    await field.fill("128");
    await field.press("Tab");
    await focusInside(popover);

    expect(await closeBy(page, popover, "cel.applyProperties")).toBe(0);
    expect((await documentState(page)).undoLabel).toBe("Cel Opacity");
    expect(errors).toEqual([]);
});
