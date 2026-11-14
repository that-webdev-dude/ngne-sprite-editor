import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { documentState, runCommands } from "./se-022-support";
import { blendPopover, celPopover, focusInside, openTwoLayers } from "./se-061-support";

// Issue #2: a timeline popover's history step closes it, and the canvas has two animation
// frames to show the step. The close hands the page back at once (DESIGN §5.6), but its field
// lets go of the focus before the page's marks and lock are lifted: `blur()` brings the style
// up to date at once, and after the lift that restyled the whole page inside the step's task,
// ahead of the upload the canvas waits for (se-061-viewport).

interface CloseOrder {
    /** At the field's `focusout`: the body's pointer lock and the page's `aria-hidden` marks. */
    atBlur: { pointerEvents: string; marks: number } | null;
    /** Before the step's task ends: the same, and whether the focus is still in the popover. */
    afterStep: { pointerEvents: string; marks: number; focusInPopover: boolean };
}

/** Runs `commandId`, which closes `popover`, and reads the page at the blur and after it. */
async function closeOrder(popover: Locator, commandId: string): Promise<CloseOrder> {
    return popover.evaluate(async (content, commandId) => {
        const page = () => ({
            pointerEvents: document.body.style.pointerEvents,
            marks: document.querySelectorAll("[data-aria-hidden]").length,
        });
        let atBlur: CloseOrder["atBlur"] = null;
        content.addEventListener("focusout", () => (atBlur ??= page()), { once: true });
        const command = window.__ngneTest!.commands.get(commandId);
        if (!command?.enabled()) throw new Error(`Command ${commandId} is not enabled`);
        void command.run();
        // React commits the close in a microtask of the step's task; nothing waits a frame.
        await Promise.resolve();
        await Promise.resolve();
        return {
            atBlur,
            afterStep: { ...page(), focusInPopover: content.contains(document.activeElement) },
        };
    }, commandId);
}

async function expectBlurBeforeLift(popover: Locator, commandId: string) {
    const order = await closeOrder(popover, commandId);
    // The page was still modal when the field let go of the focus.
    expect(order.atBlur).not.toBeNull();
    expect(order.atBlur!.pointerEvents).toBe("none");
    expect(order.atBlur!.marks).toBeGreaterThan(0);
    // And it is handed back within the step's task: nothing is deferred to a later frame.
    expect(order.afterStep).toEqual({ pointerEvents: "", marks: 0, focusInPopover: false });
    await expect(popover).toBeHidden();
}

test("closing the cel properties popover blurs its field before the page is handed back, in the step's task", async ({
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

    await expectBlurBeforeLift(popover, "cel.applyProperties");
    expect((await documentState(page)).undoLabel).toBe("Cel Opacity");
    expect(errors).toEqual([]);
});

test("closing the layer properties popover blurs its field before the page is handed back, in the step's task", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTwoLayers(page);
    await runCommands(page, ["layer.properties"]);
    const popover = blendPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    await popover.getByRole("textbox", { name: "Name" }).fill("Glow");

    await expectBlurBeforeLift(popover, "layer.applyProperties");
    expect((await documentState(page)).layers[1]?.name).toBe("Glow");
    expect(errors).toEqual([]);
});
