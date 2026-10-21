import { expect, test } from "@playwright/test";
import { boxOf, collectErrors, contains, region, REGIONS } from "./se-006-support";
import { settleSize } from "./se-047-support";
import {
    layoutProblems,
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
        expect(errors).toEqual([]);
    });
}

test("the layout check sees an overlap, a control cut off by its panel and one cut off by the page", async ({
    page,
}) => {
    await startEditor(page);
    expect(await layoutProblems(page)).toEqual([]);
    await page.evaluate(() => {
        const root = document.createElement("div");
        root.id = "se071-probe";
        root.innerHTML = `
            <div style="position:fixed;left:300px;top:200px;width:200px;height:100px">
                <button style="position:absolute;left:0;top:0;width:60px;height:24px">A</button>
                <button style="position:absolute;left:40px;top:10px;width:60px;height:24px">B</button>
                <button style="position:absolute;left:30px;top:50px;width:60px;height:24px;margin-left:1px">C</button>
            </div>
            <div style="position:fixed;left:600px;top:200px;width:100px;height:40px;overflow:hidden">
                <button style="position:absolute;left:70px;top:0;width:60px;height:24px">D</button>
            </div>
            <button style="position:fixed;left:-20px;top:300px;width:60px;height:24px">E</button>`;
        document.body.append(root);
    });
    expect(await layoutProblems(page, "#se071-probe")).toEqual([
        'overlap: button "A" and button "B" share 20.0 × 14.0 px',
        'clipped: button "D" by div',
        'clipped: button "E" by body',
    ]);
});
