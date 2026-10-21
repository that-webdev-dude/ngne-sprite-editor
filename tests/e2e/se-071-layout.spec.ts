import { expect, test } from "@playwright/test";
import type * as ToolRegistryModule from "../../src/app/tools/toolRegistry";
import { boxOf, collectErrors, contains, region, REGIONS, settleTimers } from "./se-006-support";
import { settleSize } from "./se-047-support";
import {
    cutToastMessages,
    layoutProblems,
    NOTIFICATIONS,
    showEveryToast,
    openRichDocument,
    runCommand,
    startEditor,
    visitAllSurfaces,
    WINDOWS,
} from "./se-071-support";

// SE-071: the layout at the minimum window, 1280 × 720, and at 125% browser zoom on a
// 1920 × 1080 display, which lays the page out in 1536 × 864 CSS pixels (DESIGN §8). In the
// shell — empty, with a document, with every dock section expanded — and in every dialog and
// surface a command or a situation opens (`visitAllSurfaces`), no interactive control is
// clipped or overlaps another (`layoutProblems` defines both), and every surface lies inside
// the window.

for (const size of WINDOWS) {
    test(`no clipped or overlapping control in the shell or any dialog at ${size.name}`, async ({
        page,
    }) => {
        test.setTimeout(10 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { size });
        await settleSize(page);
        expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([
            size.width,
            size.height,
        ]);
        expect(await layoutProblems(page), "empty shell").toEqual([]);

        await openRichDocument(page, "layout");
        await runCommand(page, "select.all");
        for (const id of REGIONS) await expect(region(page, id)).toBeVisible();
        expect(await layoutProblems(page), "shell with a document").toEqual([]);
        // The context bar of every tool of the tool registry.
        const tools = await page.evaluate(async () => {
            const path = "/src/app/tools/toolRegistry.ts";
            const { toolRegistry } = (await import(
                /* @vite-ignore */ path
            )) as typeof ToolRegistryModule;
            return toolRegistry.list().map((tool) => tool.id);
        });
        expect(tools.length).toBeGreaterThan(10);
        const initialTool = await page.evaluate(() => window.__ngneTest!.editor.getState().tool);
        for (const tool of tools) {
            await runCommand(page, `tool.${tool}`);
            await expect
                .poll(() => page.evaluate(() => window.__ngneTest!.editor.getState().tool))
                .toBe(tool);
            await settleTimers(page);
            expect(
                await layoutProblems(page, '[data-region="context-bar"]'),
                `context bar of ${tool}`,
            ).toEqual([]);
        }
        await runCommand(page, `tool.${initialTool}`);
        // Every dock section expanded: the dock scrolls, nothing is cut off.
        const toggles = page.locator('.dock-section__toggle[aria-expanded="false"]');
        while ((await toggles.count()) > 0) await toggles.first().click();
        expect(await layoutProblems(page), "shell with every dock section expanded").toEqual([]);

        const windowBox = { x: 0, y: 0, width: size.width, height: size.height };
        const visited: string[] = [];
        await visitAllSurfaces(page, async ({ source, name, selector, surface }) => {
            visited.push(`${source}: ${name}`);
            expect(
                contains(windowBox, await boxOf(surface)),
                `${source}: ${name} inside the window`,
            ).toBe(true);
            expect(await layoutProblems(page, selector), `${source}: ${name}`).toEqual([]);
        });
        test.info().annotations.push({ type: "surfaces", description: visited.join("; ") });

        // A toast of every kind, SE-072's update toast with Reload among them.
        await showEveryToast(page);
        const toasts = page.locator(NOTIFICATIONS);
        expect(contains(windowBox, await boxOf(toasts)), "toasts inside the window").toBe(true);
        expect(await layoutProblems(page, NOTIFICATIONS), "toasts").toEqual([]);
        expect(await cutToastMessages(page), "toast messages cut off").toEqual([]);
        expect(errors).toEqual([]);
    });
}

test("the transport buttons take the presses on their top edge, where the timeline's splitter reaches into the panel", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page, "transport");
    const buttons = page.getByRole("group", { name: "Transport" }).locator("button");
    await expect(buttons.first()).toBeVisible();
    const splitter = page.getByRole("separator", { name: "Resize timeline" });
    const line = (await splitter.boundingBox())!;
    const count = await buttons.count();
    expect(count).toBeGreaterThan(3);
    for (let index = 0; index < count; index++) {
        const button = buttons.nth(index);
        const name = (await button.getAttribute("aria-label")) ?? `${index}`;
        const box = (await button.boundingBox())!;
        // The splitter's hit area does reach over the button's top edge.
        expect(line.y + line.height, `${name}: under the splitter's hit area`).toBeGreaterThan(
            box.y + 1,
        );
        // Inside the rounded corners (4 px), which take no presses.
        const xs = [box.x + 4, box.x + box.width / 2, box.x + box.width - 4];
        for (const y of [box.y + 0.5, box.y + 1.5, line.y + line.height - 0.5]) {
            for (const x of xs) {
                const owner = await button.evaluate(
                    (element, [x, y]) => {
                        const hit = document.elementFromPoint(x!, y!);
                        return hit && element.contains(hit)
                            ? "button"
                            : `${hit?.tagName.toLowerCase()}.${String(hit?.getAttribute("class"))}`;
                    },
                    [x, y],
                );
                expect(owner, `${name} at ${x.toFixed(1)}, ${y.toFixed(1)}`).toBe("button");
            }
        }
        // Above the panel's border the splitter keeps its hit area.
        const above = await splitter.evaluate(
            (element, [x, y]) => element === document.elementFromPoint(x!, y!),
            [box.x + box.width / 2, line.y + 1],
        );
        expect(above, `${name}: the splitter above it`).toBe(true);
    }
    expect(errors).toEqual([]);
});

test("the layout check sees an overlap, a control cut off by its panel and one cut off by the page, and keeps its exemptions narrow", async ({
    page,
}) => {
    await startEditor(page);
    expect(await layoutProblems(page)).toEqual([]);
    await page.evaluate(() => {
        const root = document.createElement("div");
        root.id = "se071-probe";
        // Each group lies above the app (z-index), so that hit-testing finds the probes.
        const group = (left: number, top: number, html: string, style = "") =>
            `<div style="position:fixed;z-index:1000;left:${left}px;top:${top}px;width:200px;height:60px;${style}">${html}</div>`;
        const at = (left: number, top = 0, more = "") =>
            `position:absolute;left:${left}px;top:${top}px;${more}`;
        const button = (name: string, left: number, top = 0, more = "") =>
            `<button style="${at(left, top, `width:60px;height:24px;${more}`)}">${name}</button>`;
        const splitter = (name: string, left: number, top = 0, more = "") =>
            `<div role="separator" aria-label="${name}" style="${at(left, top, `width:8px;height:24px;${more}`)}"></div>`;
        root.innerHTML = [
            // A and B overlap; C shares a 1 px hairline with B, which is no overlap.
            group(
                300,
                200,
                button("A", 0) + button("B", 40, 10) + button("C", 31, 33),
                "height:100px",
            ),
            // D is cut off by a panel that clips and cannot scroll.
            group(600, 200, button("D", 70), "width:100px;height:40px;overflow:hidden"),
            // E is cut off by the page.
            `<button style="position:fixed;z-index:1000;left:-20px;top:300px;width:60px;height:24px">E</button>`,
            // A splitter on top of a button takes its presses: an overlap.
            group(300, 340, button("F", 0) + splitter("S1", 50, 0, "z-index:1")),
            // A button on top of a splitter takes every press there: none.
            group(300, 380, button("G", 0, 0, "z-index:2") + splitter("S2", 50, 0, "z-index:1")),
            // A splitter that takes some presses on a button and leaves it others: an overlap.
            group(
                300,
                420,
                button("H", 0) + splitter("S3", 50, 0, "z-index:1;clip-path:inset(0 0 50% 0)"),
            ),
            // A splitter over a region that is no control (as over the viewport): none.
            group(
                300,
                460,
                `<div tabindex="0" style="${at(0, 0, "width:60px;height:24px")}"></div>` +
                    splitter("S4", 50, 0, "z-index:1"),
            ),
            // Two splitters that cross: an overlap.
            group(
                300,
                500,
                splitter("S5", 8) + splitter("S6", 0, 8, "width:24px;height:8px;z-index:1"),
            ),
            // Two buttons side by side sharing a 1 px border: none.
            group(300, 540, button("M1", 0) + button("M2", 59)),
            // A button scrolled out of a scrolling panel's view: scrolling shows it, none.
            group(
                600,
                340,
                `<div style="height:200px"></div>${button("K", 0, 0, "position:static")}`,
                "width:100px;height:40px;overflow:auto",
            ),
            // A panel that scrolls but cannot show a button past its start edge clips it.
            group(600, 420, button("L", -30), "width:100px;height:40px;overflow:auto"),
        ].join("");
        document.body.append(root);
    });
    expect(await layoutProblems(page, "#se071-probe")).toEqual([
        'overlap: button "A" and button "B" share 20.0 × 14.0 px',
        'overlap: button "F" and separator "S1" share 8.0 × 24.0 px',
        'overlap: button "H" and separator "S3" share 8.0 × 24.0 px',
        'overlap: separator "S5" and separator "S6" share 8.0 × 8.0 px',
        'clipped: button "D" by div',
        'clipped: button "E" by body',
        'clipped: button "L" by div',
    ]);
});
