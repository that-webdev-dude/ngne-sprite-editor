import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { hsvToRgb, packRgba } from "../../src/core/color";
import { RAIL, railOneColumnHeight } from "../../src/ui/shell/layout";
import { arrowToRadio, boxOf, collectErrors, openShell, region, tabTo } from "./se-006-support";
import { openEditor, openSession } from "./se-007-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import { openDocument, openViewportEditor, settle } from "./se-011-support";
import { viewportArea } from "./se-012-support";
import { setColours } from "./se-015-support";
import {
    alphaStrip,
    colourChips,
    colourPanel,
    colourState,
    contextMenus,
    hex8,
    hexField,
    hueStrip,
    numberField,
    recordContextMenus,
    resetColours,
    setColourHsv,
    svField,
    swatches,
} from "./se-016-support";

// SE-016: the colour state as the user works with it — the colour panel (DESIGN §5.3) from
// the keyboard and the pointer, the chips and the reset button of the rail (DESIGN §5.1), the
// read-only palette grid (DESIGN §5.4) — and the rail's layout with the chips at its bottom.

/** The colour 0xRRGGBBAA of an HSV colour and an alpha, as the panel stores it. */
function fromHsv(h: number, s: number, v: number, alpha = 255): number {
    const { r, g, b } = hsvToRgb(h, s, v);
    return packRgba(r, g, b, alpha);
}

async function foregroundHsv(page: Page) {
    return (await colourState(page)).foregroundHsv;
}

test("the picker is fully keyboard-operable: arrow keys on the field and the strips, then the segments, the hex field and the number fields", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await setColourHsv(page, "foreground", { h: 200, s: 0.5, v: 0.5 });

    // The field: left and right move the saturation, up and down the value; Shift by ten.
    await tabTo(page, svField(page));
    await page.keyboard.press("ArrowRight");
    expect(await foregroundHsv(page)).toEqual({ h: 200, s: 0.51, v: 0.5 });
    await page.keyboard.press("Shift+ArrowUp");
    expect(await foregroundHsv(page)).toEqual({ h: 200, s: 0.51, v: 0.6 });
    await expect(svField(page)).toHaveAttribute("aria-valuetext", "Saturation 51%, value 60%");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("ArrowDown");
    expect(await foregroundHsv(page)).toEqual({ h: 200, s: 0.41, v: 0.59 });
    expect((await colourState(page)).foreground).toBe(fromHsv(200, 0.41, 0.59));

    // The hue strip, in degrees.
    await page.keyboard.press("Tab");
    await expect(hueStrip(page)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    expect((await foregroundHsv(page)).h).toBe(199);
    await page.keyboard.press("Shift+ArrowRight");
    expect((await foregroundHsv(page)).h).toBe(209);
    await expect(hueStrip(page)).toHaveAttribute("aria-valuenow", "209");
    await page.keyboard.press("End");
    expect((await foregroundHsv(page)).h).toBe(360);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");
    expect(await foregroundHsv(page)).toEqual({ h: 1, s: 0.41, v: 0.59 });
    expect((await colourState(page)).foreground).toBe(fromHsv(1, 0.41, 0.59));

    // The alpha strip, 0..255.
    await page.keyboard.press("Tab");
    await expect(alphaStrip(page)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    expect((await colourState(page)).foreground & 0xff).toBe(254);
    await page.keyboard.press("Shift+ArrowLeft");
    expect((await colourState(page)).foreground).toBe(fromHsv(1, 0.41, 0.59, 244));
    await expect(alphaStrip(page)).toHaveAttribute("aria-valuenow", "244");

    // The segments switch the fields from H S V to R G B.
    await expect(numberField(page, "H")).toBeVisible();
    await page.keyboard.press("Tab");
    const rgb = colourPanel(page).getByRole("radio", { name: "RGB", exact: true });
    await expect(colourPanel(page).getByRole("radio", { name: "HSV", exact: true })).toBeFocused();
    await arrowToRadio(page, "ArrowRight", rgb);
    await expect(numberField(page, "R")).toBeVisible();
    await expect(numberField(page, "H")).toHaveCount(0);

    // The hex field: what is typed applies on Enter.
    await page.keyboard.press("Tab");
    await expect(hexField(page)).toBeFocused();
    await page.keyboard.press("Control+A");
    // White space around the digits, as pasted text often has: no length limit cuts it.
    await page.keyboard.type("  #12ab9f80 ");
    await expect(hexField(page)).toHaveValue("  #12ab9f80 ");
    await page.keyboard.press("Enter");
    expect((await colourState(page)).foreground).toBe(0x12ab9f80);
    await expect(hexField(page)).toHaveValue("#12AB9F80");

    // The number fields: arrows ±1, Shift ±10.
    await page.keyboard.press("Tab");
    await expect(numberField(page, "R")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    expect((await colourState(page)).foreground).toBe(0x13ab9f80);
    await page.keyboard.press("Tab");
    await expect(numberField(page, "G")).toBeFocused();
    await page.keyboard.press("Shift+ArrowDown");
    expect((await colourState(page)).foreground).toBe(0x13a19f80);
    expect(errors).toEqual([]);
});

test("dragging in the SV field does not change the stored hue when saturation or value reach 0", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await setColourHsv(page, "foreground", { h: 200, s: 0.8, v: 0.8 });
    const box = await boxOf(svField(page));

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Past the left edge: saturation 0, a grey.
    await page.mouse.move(box.x - 20, box.y + box.height / 2);
    await expect.poll(async () => (await foregroundHsv(page)).s).toBe(0);
    expect((await foregroundHsv(page)).h).toBe(200);
    const grey = (await colourState(page)).foreground;
    expect(grey >>> 24).toBe((grey >>> 16) & 0xff);
    expect(grey >>> 24).toBe((grey >>> 8) & 0xff);
    // Past the bottom as well: value 0, black.
    await page.mouse.move(box.x - 20, box.y + box.height + 20);
    await expect.poll(async () => (await foregroundHsv(page)).v).toBe(0);
    expect(await colourState(page)).toMatchObject({
        foreground: 0x000000ff,
        foregroundHsv: { h: 200, s: 0, v: 0 },
    });
    // Along the bottom edge: still black; the hue stays, the saturation follows the pointer.
    await page.mouse.move(box.x + box.width + 20, box.y + box.height + 20);
    await expect.poll(async () => (await foregroundHsv(page)).s).toBe(1);
    expect(await colourState(page)).toMatchObject({
        foreground: 0x000000ff,
        foregroundHsv: { h: 200, v: 0 },
    });
    await expect(hueStrip(page)).toHaveAttribute("aria-valuenow", "200");
    // Back to the top-right corner: the colour has its hue again.
    await page.mouse.move(box.x + box.width + 20, box.y - 20);
    await expect.poll(async () => (await colourState(page)).foreground).toBe(fromHsv(200, 1, 1));
    await page.mouse.up();
    expect(await foregroundHsv(page)).toEqual({ h: 200, s: 1, v: 1 });
    expect(errors).toEqual([]);
});

test("held down in the field or a strip, the right button edits the background, which the panel shows until the release; no menu opens", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await recordContextMenus(page);
    await setColourHsv(page, "foreground", { h: 120, s: 1, v: 1 });
    await setColourHsv(page, "background", { h: 0, s: 0.5, v: 0.5 }, 200);
    const box = await boxOf(svField(page));

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "right" });
    await expect(colourPanel(page)).toHaveAttribute("data-editing", "background");
    await expect(hueStrip(page)).toHaveAttribute("aria-valuenow", "0");
    await expect(alphaStrip(page)).toHaveAttribute("aria-valuenow", "200");
    // To the top-right corner and beyond, released over the dock's padding.
    await page.mouse.move(box.x + box.width + 6, box.y - 6);
    await expect.poll(async () => (await colourState(page)).background).toBe(fromHsv(0, 1, 1, 200));
    // A key pressed during the drag edits the colour the panel shows: the background.
    await expect(svField(page)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    expect(await colourState(page)).toMatchObject({
        foreground: 0x00ff00ff,
        foregroundHsv: { h: 120, s: 1, v: 1 },
        background: fromHsv(0, 0.99, 1, 200),
        backgroundHsv: { h: 0, s: 0.99, v: 1 },
    });
    await page.mouse.up({ button: "right" });
    await expect(colourPanel(page)).toHaveAttribute("data-editing", "foreground");
    await expect(hueStrip(page)).toHaveAttribute("aria-valuenow", "120");
    expect((await colourState(page)).foreground).toBe(0x00ff00ff);

    // A right click on the hue strip gives the background that hue.
    const hue = await boxOf(hueStrip(page));
    await page.mouse.click(hue.x + hue.width * 0.5, hue.y + hue.height / 2, { button: "right" });
    const after = await colourState(page);
    expect(Math.abs(after.backgroundHsv.h - 180)).toBeLessThan(3);
    // Saturation and value as the key during the drag left them.
    expect(after.backgroundHsv).toMatchObject({ s: 0.99, v: 1 });
    expect(after.foreground).toBe(0x00ff00ff);
    await expect(colourPanel(page)).toHaveAttribute("data-editing", "foreground");

    // Held on the alpha strip, the arrow keys move the background's alpha, not the foreground's.
    const alpha = await boxOf(alphaStrip(page));
    await page.mouse.move(alpha.x + alpha.width * 0.5, alpha.y + alpha.height / 2);
    await page.mouse.down({ button: "right" });
    await expect(alphaStrip(page)).toBeFocused();
    const held = (await colourState(page)).background & 0xff;
    await page.keyboard.press("Shift+ArrowRight");
    expect((await colourState(page)).background & 0xff).toBe(held + 10);
    await page.keyboard.press("ArrowLeft");
    expect((await colourState(page)).background & 0xff).toBe(held + 9);
    expect((await colourState(page)).foreground).toBe(0x00ff00ff);
    await page.mouse.up({ button: "right" });
    await expect(colourPanel(page)).toHaveAttribute("data-editing", "foreground");

    const menus = await contextMenus(page);
    expect(menus.length).toBeGreaterThan(0);
    expect(menus.every((menu) => menu.prevented)).toBe(true);
    expect(errors).toEqual([]);
});

test("the rail chips show the colours; a click swaps them, as X does; the reset button restores black on white", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await openDocument(page, { width: 16, height: 16 });
    await settle(page);
    await setColours(page, 0x336699ff, 0xcc884480);
    const chip = (slot: string) => colourChips(page).locator(`[data-colour-chip="${slot}"]`);
    await expect(chip("foreground")).toHaveAttribute("data-colour", "#336699FF");
    await expect(chip("background")).toHaveAttribute("data-colour", "#CC884480");

    await colourChips(page).click();
    expect(await colourState(page)).toMatchObject({
        foreground: 0xcc884480,
        background: 0x336699ff,
    });
    await expect(chip("foreground")).toHaveAttribute("data-colour", "#CC884480");
    await expect(hexField(page)).toHaveValue("#CC884480");
    // The click gave the focus back to the viewport (SPEC §7.8): X acts at once.
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("x");
    expect(await colourState(page)).toMatchObject({
        foreground: 0x336699ff,
        background: 0xcc884480,
    });
    await expect(chip("background")).toHaveAttribute("data-colour", "#CC884480");

    await resetColours(page).click();
    expect(await colourState(page)).toMatchObject({
        foreground: 0x000000ff,
        background: 0xffffffff,
    });
    await expect(chip("foreground")).toHaveAttribute("data-colour", "#000000FF");
    await expect(chip("background")).toHaveAttribute("data-colour", "#FFFFFFFF");
    await expect(viewportArea(page)).toBeFocused();
    expect(errors).toEqual([]);
});

test("clicking a palette swatch sets the foreground to exactly that colour; a right click sets the background; the keyboard does both, and the canvas keys act from a focused swatch", async ({
    page,
}) => {
    const errors = collectErrors(page);
    // Tall enough for the palette section to start expanded (DESIGN §2).
    await page.setViewportSize({ width: 1440, height: 900 });
    await openViewportEditor(page);
    const document = await openDocument(page, { width: 16, height: 16 });
    await settle(page);
    // The document's palette with a colour that is not opaque, as the test hook sets it.
    const colors = await page.evaluate((id) => {
        const sessions = window.__ngneTest!.sessions.getState();
        const { session } = sessions.documents.find((entry) => entry.id === id)!;
        session.doc.palette.colors.push(0x12345680, 0x00000000);
        sessions.touch(id);
        return [...session.doc.palette.colors];
    }, document.id);
    await expect(swatches(page)).toHaveCount(colors.length);
    expect(
        await swatches(page).evaluateAll((items) =>
            items.map((item) => item.getAttribute("data-colour")),
        ),
    ).toEqual(colors.map(hex8));

    await recordContextMenus(page);
    for (const index of [0, 5, colors.length - 2, colors.length - 1]) {
        await swatches(page).nth(index).click();
        expect((await colourState(page)).foreground, `swatch ${index}`).toBe(colors[index]);
        // The foreground's swatch is marked.
        await expect(swatches(page).nth(index)).toHaveAttribute("aria-selected", "true");
    }
    const background = (await colourState(page)).background;
    await swatches(page).nth(3).click({ button: "right" });
    expect(await colourState(page)).toMatchObject({
        foreground: colors[colors.length - 1],
        background: colors[3],
    });
    expect(colors[3]).not.toBe(background);
    const menus = await contextMenus(page);
    expect(menus.length).toBeGreaterThan(0);
    expect(menus.every((menu) => menu.prevented)).toBe(true);
    // A pointer press hands the focus to the viewport (SPEC §7.8).
    await expect(viewportArea(page)).toBeFocused();

    // From the keyboard: arrows move, Enter takes the foreground, Shift+Enter the background.
    const tops = await swatches(page).evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top),
    );
    const columns = tops.filter((top) => top === tops[0]).length;
    expect(columns).toBeGreaterThan(1);
    await swatches(page).nth(3).focus();
    await expect(swatches(page).nth(3)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(swatches(page).nth(4)).toBeFocused();
    await page.keyboard.press("Enter");
    expect((await colourState(page)).foreground).toBe(colors[4]);
    await page.keyboard.press("ArrowDown");
    await expect(swatches(page).nth(4 + columns)).toBeFocused();
    await page.keyboard.press("Shift+Enter");
    expect((await colourState(page)).background).toBe(colors[4 + columns]);
    await page.keyboard.press("End");
    await expect(swatches(page).nth(colors.length - 1)).toBeFocused();
    // X still swaps the colours (SPEC §7.8): a focused swatch takes no letter for itself.
    await page.keyboard.press("x");
    expect(await colourState(page)).toMatchObject({
        foreground: colors[4 + columns],
        background: colors[4],
    });
    await expect(swatches(page).nth(colors.length - 1)).toBeFocused();
    expect(errors).toEqual([]);
});

test("the rail is in one column exactly when the chips fit under the tools there, and never switches back and forth", async ({
    page,
}) => {
    await openShell(page, { width: 1280, height: 720 });
    const rail = region(page, "tool-rail");
    const groups = await rail
        .locator("[data-rail-group]")
        .evaluateAll((items) => items.map((item) => item.querySelectorAll("button").length));
    // The footer stacked in one column: the chips, the gap, the reset button.
    const footer = await rail.locator("[data-rail-footer]").evaluate((element) => {
        const heights = [...element.children].map((child) => (child as HTMLElement).offsetHeight);
        return heights.reduce((sum, height) => sum + height, 0) + 2 * (heights.length - 1);
    });
    expect(footer).toBe(RAIL.footer);
    const needed = railOneColumnHeight(groups, footer);
    const splitter = page.getByRole("separator", { name: "Resize timeline" });
    await splitter.focus();
    await expect(splitter).toBeFocused();

    const seen = new Set<string>();
    // The timeline from 200 px down to 152 px: the rail from 460 px to 508 px, across the
    // heights where the chips fit beside each other in two columns only.
    for (let step = 0; step <= 6; step++) {
        const height = (await boxOf(rail)).height;
        expect(height).toBe(460 + 8 * step);
        const columns = needed > height ? "2" : "1";
        seen.add(columns);
        await expect(rail, `rail ${height} px`).toHaveAttribute("data-columns", columns);
        const changes = await rail.evaluate(
            (element) =>
                new Promise<number>((resolve) => {
                    let count = 0;
                    const observer = new MutationObserver(() => count++);
                    observer.observe(element, {
                        attributes: true,
                        attributeFilter: ["data-columns"],
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        resolve(count);
                    }, 300);
                }),
        );
        expect(changes, `rail ${height} px`).toBe(0);
        // Nothing clipped: no scroll, and the footer's buttons inside the rail.
        const fits = await rail.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return (
                [...element.querySelectorAll("[data-rail-footer] button")].every((button) => {
                    const inner = button.getBoundingClientRect();
                    return (
                        inner.top >= box.top &&
                        inner.bottom <= box.bottom &&
                        inner.right <= box.right
                    );
                }) && element.scrollHeight <= element.clientHeight
            );
        });
        expect(fits, `rail ${height} px`).toBe(true);
        await page.keyboard.press("ArrowDown");
    }
    expect([...seen].sort()).toEqual(["1", "2"]);
});

for (const theme of THEMES) {
    test(`axe reports no AA violations on the colour panel, the palette and the rail chips in the ${theme} theme`, async ({
        page,
    }) => {
        // Several audits in one test: about 10 s alone, longer while other workers are busy.
        test.setTimeout(90_000);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width: 1440, height: 900 });
        await startInTheme(page, theme);
        await openEditor(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await openSession(page, { name: "colours", width: 16, height: 16 });
        await expect(swatches(page).first()).toBeVisible();
        await setColours(page, 0x12ab9f80, 0xffffffff);

        const whole = await audit(page);
        expect(whole.violations).toEqual([]);
        for (const scope of [
            '[data-dock-panel="colour"]',
            '[data-dock-panel="palette"]',
            '[data-region="tool-rail"] [data-rail-footer]',
        ]) {
            const own = await audit(page, scope);
            expect(own.violations, scope).toEqual([]);
            expect(own.contrastUndecided, scope).toEqual([]);
        }
        // The RGB fields as well.
        await colourPanel(page).getByRole("radio", { name: "RGB", exact: true }).click();
        await expect(numberField(page, "R")).toBeVisible();
        const fields = await audit(page, '[data-dock-panel="colour"]');
        expect(fields.violations).toEqual([]);
        expect(fields.contrastChecked).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
}
