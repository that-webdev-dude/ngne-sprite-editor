import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, REGIONS } from "./se-006-support";
import { menuTrigger, openEditor } from "./se-007-support";

// SE-007: focus regions — F6 and Shift+F6 move keyboard focus between the regions of the
// shell (SPEC §7.8, DESIGN §8).
//
// Which regions hold something focusable changes as features land, so the tests read the
// cycle from the app and check its rules; the cases that need a particular content use
// regions of their own, added after the status bar.

interface Stop {
    /** `data-region` of the region that holds focus. */
    region: string;
    /** `data-testid` of the focused element, when it has one. */
    testId: string | null;
    role: string | null;
}

/** Where keyboard focus is, or null when it is outside every region. */
function focusStop(page: Page): Promise<Stop | null> {
    return page.evaluate(() => {
        const active = document.activeElement;
        const region = active?.closest("[data-region]")?.getAttribute("data-region");
        if (!active || !region) return null;
        return {
            region,
            testId: active.getAttribute("data-testid"),
            role: active.getAttribute("role"),
        };
    });
}

/** Presses `key` until a region comes up a second time; returns the stops before that. */
async function lap(page: Page, key: "F6" | "Shift+F6"): Promise<Stop[]> {
    const stops: Stop[] = [];
    for (let presses = 0; presses < 16; presses++) {
        await page.keyboard.press(key);
        const stop = await focusStop(page);
        if (!stop) throw new Error(`${key} left focus outside every region`);
        if (stops.some((seen) => seen.region === stop.region)) return stops;
        stops.push(stop);
    }
    throw new Error(`${key} never came back to a region`);
}

const regionsOf = (stops: Stop[]) => stops.map((stop) => stop.region);

/** Adds a region with the given content to the shell, after the status bar. */
async function addRegion(page: Page, id: string, html: string): Promise<void> {
    await page.evaluate(
        ({ id, html }) => {
            const region = document.createElement("div");
            region.dataset.region = id;
            // Out of the shell's grid, so the layout of the real regions is untouched.
            region.style.cssText = "position: absolute; left: 0; bottom: 0;";
            region.innerHTML = html;
            document.querySelector(".shell")?.append(region);
        },
        { id, html },
    );
}

test("F6 and Shift+F6 cycle through the regions that can take focus, in shell order", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    expect(await focusStop(page)).toBeNull();

    const forward = await lap(page, "F6");
    // The menu bar and the dock always hold controls; more regions join as features land.
    expect(regionsOf(forward)).toEqual(expect.arrayContaining(["menu-bar", "dock"]));
    expect(regionsOf(forward)[0]).toBe("menu-bar");
    // Each region once, in the order of the shell, then around again.
    const shellOrder: readonly string[] = REGIONS;
    expect(regionsOf(forward)).toEqual(shellOrder.filter((id) => regionsOf(forward).includes(id)));
    expect((await focusStop(page))?.region).toBe("menu-bar");
    await expect(menuTrigger(page, "File")).toBeFocused();

    // Backwards the same regions in reverse.
    const backward = await lap(page, "Shift+F6");
    expect(regionsOf(backward)).toEqual([...regionsOf(forward)].reverse());

    // A region with controls is entered at a control, not at the splitter on its edge.
    expect(forward.find((stop) => stop.region === "dock")?.role).not.toBe("separator");

    // Focus moved by the keyboard shows the focus ring.
    await expect(page.locator("html")).toHaveAttribute("data-modality", "keyboard");
    const outline = await page.evaluate(
        () => getComputedStyle(document.activeElement ?? document.body).outlineStyle,
    );
    expect(outline).toBe("solid");
    expect(errors).toEqual([]);
});

test("with focus outside every region, Shift+F6 enters the last one", async ({ page }) => {
    await openEditor(page);
    const forward = await lap(page, "F6");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await focusStop(page)).toBeNull();
    await page.keyboard.press("Shift+F6");
    expect((await focusStop(page))?.region).toBe(forward.at(-1)?.region);
});

test("a region joins the cycle when it holds a focusable element", async ({ page }) => {
    await openEditor(page);
    const before = regionsOf(await lap(page, "F6"));

    // The first tabbable element is the target …
    await addRegion(
        page,
        "se007-plain",
        '<span>Label</span><button data-testid="plain-first">First</button><button>Second</button>',
    );
    // … a splitter only when the region holds nothing else …
    await addRegion(
        page,
        "se007-splitter",
        '<div role="separator" tabindex="0"></div><button data-testid="beside-splitter">Control</button>',
    );
    await addRegion(
        page,
        "se007-only-splitter",
        '<div role="separator" tabindex="0" data-testid="only-splitter"></div>',
    );
    // … and an element marked as the region's focus target comes before all others.
    await addRegion(
        page,
        "se007-marked",
        '<button>First</button><div tabindex="0" data-region-focus data-testid="marked">Canvas</div>',
    );
    // Nothing focusable: not part of the cycle.
    await addRegion(
        page,
        "se007-empty",
        '<button disabled>Disabled</button><button tabindex="-1">Skipped</button><span>Text</span>',
    );

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const stops = await lap(page, "F6");
    expect(regionsOf(stops)).toEqual([
        ...before,
        "se007-plain",
        "se007-splitter",
        "se007-only-splitter",
        "se007-marked",
    ]);
    expect(stops.slice(before.length).map((stop) => stop.testId)).toEqual([
        "plain-first",
        "beside-splitter",
        "only-splitter",
        "marked",
    ]);

    // From the last region F6 wraps to the first, and Shift+F6 comes back.
    await page.getByTestId("marked").focus();
    await page.keyboard.press("F6");
    expect((await focusStop(page))?.region).toBe(before[0]);
    await page.keyboard.press("Shift+F6");
    await expect(page.getByTestId("marked")).toBeFocused();
    await page.keyboard.press("Shift+F6");
    await expect(page.getByTestId("only-splitter")).toBeFocused();
});

test("F6 also acts while a text field has focus", async ({ page }) => {
    await openEditor(page);
    await addRegion(page, "se007-field", '<input aria-label="Test field" data-testid="field" />');
    const field = page.getByTestId("field");
    await field.focus();
    await page.keyboard.press("KeyA");
    await page.keyboard.press("F6");
    await expect(field).not.toBeFocused();
    expect((await focusStop(page))?.region).toBe("menu-bar");
    await page.keyboard.press("Shift+F6");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("a");
});

test("F6 does nothing while a menu is open", async ({ page }) => {
    await openEditor(page);
    await menuTrigger(page, "View").click();
    const menu = page.getByRole("menu", { name: "View" });
    await expect(menu).toBeVisible();
    const before = await focusStop(page);
    await page.keyboard.press("F6");
    await page.keyboard.press("Shift+F6");
    await expect(menu).toBeVisible();
    expect(await focusStop(page)).toEqual(before);
});
