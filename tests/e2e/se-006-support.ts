import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Shared helpers of the SE-006 specs.

/** The seven regions of DESIGN §2, by their `data-region` value. */
export const REGIONS = [
    "menu-bar",
    "tool-rail",
    "context-bar",
    "viewport",
    "dock",
    "timeline",
    "status-bar",
] as const;
export type Region = (typeof REGIONS)[number];

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function region(page: Page, id: Region): Locator {
    return page.locator(`[data-region="${id}"]`);
}

export async function boxOf(locator: Locator): Promise<Box> {
    return locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
}

export async function regionBoxes(page: Page): Promise<Record<Region, Box>> {
    const entries = [];
    for (const id of REGIONS) entries.push([id, await boxOf(region(page, id))] as const);
    return Object.fromEntries(entries) as Record<Region, Box>;
}

/** Area shared by two boxes, in square pixels. */
export function overlap(a: Box, b: Box): number {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return Math.max(0, width) * Math.max(0, height);
}

/** Whether `inner` lies completely inside `outer`. */
export function contains(outer: Box, inner: Box): boolean {
    const slack = 0.01;
    return (
        inner.x >= outer.x - slack &&
        inner.y >= outer.y - slack &&
        inner.x + inner.width <= outer.x + outer.width + slack &&
        inner.y + inner.height <= outer.y + outer.height + slack
    );
}

/** Opens the app and waits for the shell. */
export async function openShell(page: Page, size?: { width: number; height: number }) {
    if (size) await page.setViewportSize(size);
    await page.goto("/");
    await expect(region(page, "viewport")).toBeVisible();
}

/** Opens the gallery with transitions off, so colours are final when they are read. */
export async function openGallery(page: Page) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/gallery");
    await expect(page.getByRole("heading", { name: "Interface gallery" })).toBeVisible();
}

/** Moves keyboard focus to `target` with the Tab key, as a keyboard user would. */
export async function tabTo(page: Page, target: Locator): Promise<void> {
    for (let presses = 0; presses < 200; presses++) {
        await page.keyboard.press("Tab");
        if (await target.evaluate((element) => element === document.activeElement)) return;
    }
    throw new Error("Tab did not reach the target");
}

/**
 * Records uncaught errors and console errors of the page. The dev server has no favicon, and
 * Chrome logs that missing resource; it is not an application error.
 */
export function collectErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (message.location().url.endsWith("/favicon.ico")) return;
        errors.push(`console: ${message.text()}`);
    });
    return errors;
}

/** Drags with the mouse from the centre of `handle` by the given offset. */
/**
 * Lets the timers the page has already queued run. Radix registers its outside-press listener
 * one timer after a layer opens; a pointer press sent before that is not seen.
 */
export async function settleTimers(page: Page): Promise<void> {
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

export async function dragBy(page: Page, handle: Locator, dx: number, dy: number) {
    const box = await boxOf(handle);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2);
    await page.mouse.move(x + dx, y + dy);
    await page.mouse.up();
}
