import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as ToastModule from "../../src/ui/toast/toast";
import { collectErrors, region, settleTimers } from "./se-006-support";
import { menuTrigger } from "./se-007-support";
import {
    closeAll,
    openRichDocument,
    runCommand,
    startEditor,
    surfaceOpened,
} from "./se-071-support";

// SE-071: `prefers-reduced-motion` (DESIGN §3.3): transitions off, popovers without their
// fade. With the preference set, no element of the shell or of a menu, dialog, popover,
// tooltip or toast has a transition or an animation of more than 0 s, and the page runs no
// animation while the pointer moves over controls and surfaces open and close. The marching
// ants stand still then: `se-030-motion.spec.ts` (SE-030) checks their timer. Without the
// preference the same walk does run transitions, so the check can see one.

/** Elements whose computed transition or animation lasts longer than 0 s. */
function movingElements(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const longest = (list: string) =>
            Math.max(...list.split(",").map((value) => parseFloat(value) || 0));
        const found: string[] = [];
        for (const element of document.querySelectorAll("*")) {
            for (const pseudo of [null, "::before", "::after"]) {
                const style = getComputedStyle(element, pseudo);
                const transition =
                    style.transitionProperty !== "none" && longest(style.transitionDuration) > 0;
                const animation =
                    style.animationName !== "none" && longest(style.animationDuration) > 0;
                if (transition || animation) {
                    const name = element.getAttribute("aria-label") ?? element.className;
                    found.push(`${element.tagName.toLowerCase()}${pseudo ?? ""} ${String(name)}`);
                }
            }
        }
        return found;
    });
}

/** The animations the page runs now (CSS transitions and animations, Web Animations). */
function runningAnimations(page: Page): Promise<number> {
    return page.evaluate(() => document.getAnimations().length);
}

/**
 * Moves the pointer over the controls of the shell, opens a menu, a dialog, a popover, a
 * tooltip and toasts, and reports after each step what moves and what runs.
 */
async function walk(page: Page): Promise<{ moving: string[]; running: number }> {
    const moving = new Set<string>();
    let running = 0;
    const look = async () => {
        for (const name of await movingElements(page)) moving.add(name);
        running = Math.max(running, await runningAnimations(page));
    };
    // Hover: buttons of every region.
    const buttons = page.locator("[data-region] button:visible");
    const count = Math.min(await buttons.count(), 40);
    for (let index = 0; index < count; index++) {
        await buttons.nth(index).hover();
        running = Math.max(running, await runningAnimations(page));
    }
    await look();
    // A menu.
    await menuTrigger(page, "File").click();
    await expect(page.getByRole("menu", { name: "File" })).toBeVisible();
    await page.getByRole("menu", { name: "File" }).getByRole("menuitem").first().hover();
    await look();
    await closeAll(page);
    // A dialog.
    await runCommand(page, "file.new");
    expect(await surfaceOpened(page)).toBe(true);
    await look();
    await closeAll(page);
    // A popover: the onion skin settings.
    await page.getByRole("button", { name: "Onion skin settings" }).click();
    expect(await surfaceOpened(page)).toBe(true);
    await look();
    await closeAll(page);
    // A tooltip, on keyboard focus.
    const tool = region(page, "tool-rail").locator("[data-tool]").first();
    await tool.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tooltip")).toBeVisible();
    await look();
    // Toasts.
    await page.evaluate(async () => {
        const path = "/src/ui/toast/toast.ts";
        const { toast } = (await import(/* @vite-ignore */ path)) as typeof ToastModule;
        toast.info("Saved hero.ngsprite");
        toast.error("Could not save “hero.ngsprite”.");
    });
    await expect(page.locator(".ui-toast")).toHaveCount(2);
    await look();
    await settleTimers(page);
    return { moving: [...moving].sort(), running };
}

test("with prefers-reduced-motion no transition or animation runs anywhere in the interface", async ({
    page,
}) => {
    test.setTimeout(3 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
        true,
    );
    await openRichDocument(page);
    await runCommand(page, "select.all");
    const { moving, running } = await walk(page);
    expect(moving).toEqual([]);
    expect(running).toBe(0);
    expect(errors).toEqual([]);
});

test("without the preference the same walk finds the transitions and the fades it would turn off", async ({
    page,
}) => {
    test.setTimeout(3 * 60_000);
    await startEditor(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openRichDocument(page);
    const { moving, running } = await walk(page);
    expect(moving.length).toBeGreaterThan(0);
    expect(running).toBeGreaterThan(0);
});
