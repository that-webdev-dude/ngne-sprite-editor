import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CoreTags from "../../src/core/tags";
import { boxOf, collectErrors, contains, overlap, settleTimers } from "./se-006-support";
import type { Box } from "./se-006-support";
import { menuItem, menuTrigger, openEditor, openMenu, openSession } from "./se-007-support";
import { audit, dialogButton, field, nameField, setNumber } from "./se-008-support";
import {
    activeCell,
    afterFrames,
    cell,
    documentState,
    frameHeader,
    grid,
    holdAnimationFrames,
    runCommands,
    scroller,
    selectedFrames,
    timeline,
    viewport,
} from "./se-022-support";

// SE-023: the tags UI (SPEC §7.4; DESIGN §2, §5.6, §7) — the tag bar above the frame header,
// New Tag… from the selected frames, the Tag dialog, Tag Properties… and Delete Tag, resizing a
// tag by a drag of a span's end, the rows of overlapping tags, the label's contrast and the
// active tag at the active frame.

/** The tag bar: a list of the tags' spans. */
const tagBar = (page: Page) => timeline(page).getByRole("list", { name: "Tags" });
/** The span of a tag, by its name. */
const tagSpan = (page: Page, name: string) =>
    tagBar(page)
        .getByRole("listitem")
        .filter({ has: page.getByText(name, { exact: true }) });
const handle = (span: Locator, end: "from" | "to") => span.locator(`[data-end="${end}"]`);
const newTagDialog = (page: Page) => page.getByRole("dialog", { name: "New tag" });
const propertiesDialog = (page: Page) => page.getByRole("dialog", { name: "Tag properties" });
const message = (dialog: Locator) => dialog.getByRole("alert");

/** Opens the editor with a document of one layer and `frames` frames. */
async function openTags(page: Page, frames: number): Promise<void> {
    await openEditor(page);
    await openSession(page, { name: "tags", width: 8, height: 8 });
    await runCommands(
        page,
        Array.from({ length: frames - 1 }, () => "frame.newEmpty"),
    );
    await expect(frameHeader(page, frames)).toBeVisible();
}

interface TagSpec {
    name: string;
    /** Frame numbers, from 1. */
    from: number;
    to: number;
    /** 0xRRGGBBAA. */
    color?: number;
}

/** Adds tags to the active document through the tag command of SE-021, one step each. */
async function addTags(page: Page, tags: readonly TagSpec[]): Promise<void> {
    await page.evaluate(async (tags) => {
        const path = "/src/core/tags/index.ts";
        const core = (await import(/* @vite-ignore */ path)) as typeof CoreTags;
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("No document is open");
        const { doc } = document.session;
        for (const { name, from, to, color } of tags) {
            const command = core.createTagCommand(doc, {
                name,
                color: color ?? 0x73bed3ff,
                fromFrameId: doc.frames[from - 1]!.id,
                toFrameId: doc.frames[to - 1]!.id,
                direction: "forward",
                repeat: 0,
            });
            document.history.execute(command);
        }
    }, tags);
    for (const { name } of tags) await expect(tagSpan(page, name)).toBeVisible();
}

/** The tags of the active document (frames from 1) and its history. */
function tagState(page: Page) {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("No document is open");
        const { doc } = document.session;
        const frame = (id: string) => doc.frames.findIndex((entry) => entry.id === id) + 1;
        return {
            tags: doc.tags.map(({ name, color, fromFrameId, toFrameId, direction, repeat }) => ({
                name,
                color,
                from: frame(fromFrameId),
                to: frame(toFrameId),
                direction,
                repeat,
            })),
            undoCount: document.history.undoCount,
            undoLabel: document.history.undoLabel,
            redoLabel: document.history.redoLabel,
        };
    });
}

/** The box a span over frames `from`..`to` has in row `row` (DESIGN §5.6). */
async function expectedSpan(page: Page, from: number, to: number, row: number): Promise<Box> {
    const first = await boxOf(frameHeader(page, 1));
    const bar = await boxOf(timeline(page).locator(".timeline__bar"));
    return {
        x: first.x + (from - 1) * 24 + 1,
        y: bar.y + 5 + row * 18 + 1,
        width: (to - from + 1) * 24 - 2,
        height: 16,
    };
}

/** The centre of a frame's column, at the height of `y`. */
async function frameX(page: Page, frame: number): Promise<number> {
    const box = await boxOf(frameHeader(page, frame));
    return box.x + box.width / 2;
}

/** Presses on the `end` handle of a span and waits until the span is being resized. */
async function pressHandle(page: Page, span: Locator, end: "from" | "to"): Promise<number> {
    const box = await boxOf(handle(span, end));
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await expect(span).toHaveAttribute("data-resizing", end);
    return y;
}

/**
 * Waits until the timeline has drawn the last change: it draws two animation frames and an
 * idle callback after it (`useShownTimeline`), and the next frame shows it.
 */
async function panelDrawn(page: Page): Promise<void> {
    await afterFrames(page, 3);
    await page.evaluate(() => new Promise<void>((resolve) => requestIdleCallback(() => resolve())));
}

/** sRGB channel to linear light, and the WCAG 2.1 contrast of two CSS `rgb()` colours. */
function contrast(a: string, b: string): number {
    const luminance = (css: string) => {
        const [r = 0, g = 0, bl = 0] = (css.match(/[\d.]+/g) ?? []).map(Number);
        const lin = (c: number) => {
            const v = c / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
    };
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

test("select frames 2–5, create a tag, rename it, make it ping-pong and delete it; undo takes each step back in reverse order", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 6);
    await frameHeader(page, 2).click();
    await frameHeader(page, 5).click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedFrames(page)).toEqual([2, 3, 4, 5]);
    const start = (await tagState(page)).undoCount;

    // Create: Frame → New Tag…, over the selected frames.
    await openMenu(page, "Frame");
    await menuItem(page, "frame.newTag").click();
    const created = newTagDialog(page);
    await expect(created).toBeVisible();
    await expect(nameField(created)).toBeFocused();
    await expect(field(created, "From")).toHaveValue("2");
    await expect(field(created, "To")).toHaveValue("5");
    await expect(created.getByRole("radio", { name: "Forward" })).toBeChecked();
    await dialogButton(created, "Create").click();
    await expect(created).toHaveCount(0);
    const first = { name: "Tag", from: 2, to: 5, direction: "forward", repeat: 0 };
    expect(await tagState(page)).toMatchObject({
        tags: [first],
        undoCount: start + 1,
        undoLabel: "New Tag",
    });
    await expect(tagSpan(page, "Tag")).toBeVisible();
    expect(await boxOf(tagSpan(page, "Tag"))).toEqual(await expectedSpan(page, 2, 5, 0));

    // Rename: a double-click on the span opens its properties.
    await tagSpan(page, "Tag").dblclick();
    const properties = propertiesDialog(page);
    await expect(properties).toBeVisible();
    await expect(nameField(properties)).toBeFocused();
    await expect(nameField(properties)).toHaveValue("Tag");
    await nameField(properties).fill("walk");
    await page.keyboard.press("Enter");
    await expect(properties).toHaveCount(0);
    const renamed = { ...first, name: "walk" };
    expect(await tagState(page)).toMatchObject({
        tags: [renamed],
        undoCount: start + 2,
        undoLabel: "Edit Tag",
    });
    await expect(tagSpan(page, "walk")).toBeVisible();

    // Direction: Frame → Tag Properties…, for the active tag at the active frame (5).
    await openMenu(page, "Frame");
    await menuItem(page, "frame.tagProperties").click();
    await expect(properties).toBeVisible();
    await expect(nameField(properties)).toBeFocused();
    await expect(nameField(properties)).toHaveValue("walk");
    const pingPong = properties.getByRole("radio", { name: "Ping-pong" });
    await pingPong.click();
    await expect(pingPong).toBeChecked();
    await dialogButton(properties, "OK").click();
    await expect(properties).toHaveCount(0);
    const bouncing = { ...renamed, direction: "pingpong" };
    expect(await tagState(page)).toMatchObject({
        tags: [bouncing],
        undoCount: start + 3,
        undoLabel: "Edit Tag",
    });

    // Delete: Frame → Delete Tag.
    await openMenu(page, "Frame");
    await menuItem(page, "frame.deleteTag").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await tagState(page)).toMatchObject({
        tags: [],
        undoCount: start + 4,
        undoLabel: "Delete Tag",
    });
    await expect(tagBar(page).getByRole("listitem")).toHaveCount(0);

    // Undo from the keyboard, in the timeline: each step back in reverse order.
    await activeCell(page).focus();
    await expect(activeCell(page)).toBeFocused();
    const steps = [
        { tags: [bouncing], span: "walk" },
        { tags: [renamed], span: "walk" },
        { tags: [first], span: "Tag" },
        { tags: [], span: null },
    ];
    for (const [index, step] of steps.entries()) {
        await page.keyboard.press("Control+z");
        await expect
            .poll(async () => (await tagState(page)).tags, `undo ${index + 1}`)
            .toEqual(step.tags.map((tag) => ({ ...tag, color: expect.any(Number) })));
        expect((await tagState(page)).undoCount).toBe(start + 3 - index);
        if (step.span) await expect(tagSpan(page, step.span)).toBeVisible();
        else await expect(tagBar(page).getByRole("listitem")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
});

test("resizing a tag by a drag of either end is one undo step and cannot extend past the first or the last frame", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 6);
    await addTags(page, [{ name: "walk", from: 2, to: 3 }]);
    const span = tagSpan(page, "walk");
    const start = (await tagState(page)).undoCount;

    // The end of frame 3 to frame 5: drawn while the button is held, one step at the release.
    let y = await pressHandle(page, span, "to");
    await page.mouse.move(await frameX(page, 5), y, { steps: 4 });
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 2, 5, 0));
    expect((await tagState(page)).tags[0]).toMatchObject({ from: 2, to: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await tagState(page)).tags[0]).toMatchObject({ from: 2, to: 5 });
    expect(await tagState(page)).toMatchObject({ undoCount: start + 1, undoLabel: "Edit Tag" });
    await expect(span).not.toHaveAttribute("data-resizing");
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 2, 5, 0));

    // One step: undo restores the range.
    await activeCell(page).focus();
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await tagState(page)).tags[0]).toMatchObject({ from: 2, to: 3 });
    expect((await tagState(page)).undoCount).toBe(start);
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 2, 3, 0));

    // Far past the last frame: the end stops at frame 6.
    const panel = await boxOf(scroller(page));
    const last = await boxOf(frameHeader(page, 6));
    y = await pressHandle(page, span, "to");
    await page.mouse.move(last.x + 24 * 8, y, { steps: 6 });
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 2, 6, 0));
    await page.mouse.up();
    await expect.poll(async () => (await tagState(page)).tags[0]).toMatchObject({ from: 2, to: 6 });

    // Far before the first frame, over the transport: the start stops at frame 1.
    y = await pressHandle(page, span, "from");
    await page.mouse.move(panel.x + 20, y, { steps: 6 });
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 1, 6, 0));
    await page.mouse.up();
    await expect.poll(async () => (await tagState(page)).tags[0]).toMatchObject({ from: 1, to: 6 });
    expect((await tagState(page)).undoCount).toBe(start + 2);

    // Past the other end: the tag keeps one frame.
    y = await pressHandle(page, span, "from");
    await page.mouse.move(last.x + 24 * 4, y, { steps: 6 });
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 6, 6, 0));
    await page.mouse.up();
    await expect.poll(async () => (await tagState(page)).tags[0]).toMatchObject({ from: 6, to: 6 });
    expect((await tagState(page)).undoCount).toBe(start + 3);

    // Escape during a drag cancels it: no change, no step.
    y = await pressHandle(page, span, "from");
    await page.mouse.move(await frameX(page, 2), y, { steps: 4 });
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 2, 6, 0));
    await page.keyboard.press("Escape");
    await expect(span).not.toHaveAttribute("data-resizing");
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 6, 6, 0));
    await page.mouse.move(await frameX(page, 3), y, { steps: 2 });
    await page.mouse.up();
    expect(await tagState(page)).toMatchObject({ undoCount: start + 3 });
    expect((await tagState(page)).tags[0]).toMatchObject({ from: 6, to: 6 });

    // A press and release on a handle without a move: nothing.
    await pressHandle(page, span, "to");
    await page.mouse.up();
    await expect(span).not.toHaveAttribute("data-resizing");
    expect((await tagState(page)).undoCount).toBe(start + 3);

    // The undo steps take the drags back one by one.
    await activeCell(page).focus();
    for (const [from, to] of [
        [1, 6],
        [2, 6],
        [2, 3],
    ]) {
        await page.keyboard.press("Control+z");
        await expect.poll(async () => (await tagState(page)).tags[0]).toMatchObject({ from, to });
    }
    expect(errors).toEqual([]);
});

test("three overlapping tags render in three rows with no overlapping bounding boxes; a fourth row scrolls", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 8);
    const bar = timeline(page).locator(".timeline__bar");
    const header = grid(page).getByRole("row").first();
    // No tag: the bar is one 28 px row, as SE-022 laid it out.
    expect(await boxOf(bar)).toMatchObject({ height: 28 });

    await addTags(page, [
        { name: "a", from: 1, to: 4 },
        { name: "b", from: 2, to: 5 },
        { name: "c", from: 3, to: 6 },
    ]);
    const boxes = await Promise.all(["a", "b", "c"].map((name) => boxOf(tagSpan(page, name))));
    for (let one = 0; one < boxes.length; one++) {
        for (let other = one + 1; other < boxes.length; other++) {
            expect(overlap(boxes[one]!, boxes[other]!), `${one} ${other}`).toBe(0);
        }
    }
    // Rows of 18 px, the first to start on top, each span over its frames.
    expect(boxes).toEqual([
        await expectedSpan(page, 1, 4, 0),
        await expectedSpan(page, 2, 5, 1),
        await expectedSpan(page, 3, 6, 2),
    ]);
    // The bar grows 18 px per row; the frame header stays right below it.
    const panel = await boxOf(scroller(page));
    await expect.poll(async () => (await boxOf(bar)).height).toBe(28 + 2 * 18);
    expect(await boxOf(header)).toMatchObject({ y: panel.y + 64, height: 28 });
    const tags = await boxOf(timeline(page).locator("[data-timeline-tags]"));
    for (const [index, box] of boxes.entries()) expect(contains(tags, box), `${index}`).toBe(true);
    // The transport stays on the first row.
    const transport = await boxOf(timeline(page).getByRole("group", { name: "Transport" }));
    const play = await boxOf(
        timeline(page).getByRole("group", { name: "Transport" }).getByRole("button").first(),
    );
    expect(play.y).toBe(transport.y + 2);

    // A fourth level: the bar stays three rows tall and the tag bar scrolls to the fourth.
    await addTags(page, [{ name: "d", from: 4, to: 8 }]);
    expect(await boxOf(bar)).toMatchObject({ height: 64 });
    const scrollable = timeline(page).locator("[data-timeline-tags]");
    const sizes = await scrollable.evaluate((element) => ({
        client: element.clientHeight,
        scroll: element.scrollHeight,
    }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    await scrollable.evaluate((element) => (element.scrollTop = element.scrollHeight));
    const fourth = await boxOf(tagSpan(page, "d"));
    expect(contains(await boxOf(scrollable), fourth)).toBe(true);
    expect(errors).toEqual([]);
});

test("the Tag dialog rejects an empty name and a From after To with inline messages", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 6);
    await openMenu(page, "Frame");
    await menuItem(page, "frame.newTag").click();
    const dialog = newTagDialog(page);
    await expect(nameField(dialog)).toBeFocused();
    const create = dialogButton(dialog, "Create");
    await expect(message(dialog)).toHaveText("");
    await expect(create).toBeEnabled();

    // An empty name.
    await nameField(dialog).fill("");
    await expect(message(dialog)).toHaveText("Enter a name.");
    await expect(nameField(dialog)).toHaveAttribute("aria-invalid", "true");
    await expect(create).toBeDisabled();
    await expect(nameField(dialog)).toBeFocused();
    await page.keyboard.press("Enter");
    await settleTimers(page);
    await expect(dialog).toBeVisible();
    // Only white space is empty too.
    await nameField(dialog).fill("   ");
    await expect(message(dialog)).toHaveText("Enter a name.");
    await nameField(dialog).fill("jump");
    await expect(message(dialog)).toHaveText("");
    await expect(nameField(dialog)).not.toHaveAttribute("aria-invalid");

    // From after To.
    await setNumber(field(dialog, "From"), 5);
    await setNumber(field(dialog, "To"), 2);
    await expect(message(dialog)).toHaveText("From must not be after To.");
    await expect(create).toBeDisabled();
    // Both at once: both messages.
    await nameField(dialog).fill("");
    await expect(message(dialog)).toHaveText("Enter a name. From must not be after To.");

    // A colour that is not one; a preset puts one back.
    await nameField(dialog).fill("jump");
    const colour = dialog.getByRole("textbox", { name: "Colour" });
    await colour.fill("#12");
    await expect(message(dialog)).toHaveText(
        "Enter a colour as #RRGGBB. From must not be after To.",
    );
    await expect(colour).toHaveAttribute("aria-invalid", "true");
    const green = dialog.getByRole("radio", { name: "Green" });
    await green.click();
    await expect(green).toBeChecked();
    await expect(colour).toHaveValue("#A8CA58");

    // Fixed: no message, and Create adds the tag.
    await setNumber(field(dialog, "To"), 6);
    await expect(message(dialog)).toHaveText("");
    await expect(create).toBeEnabled();
    const before = (await tagState(page)).undoCount;
    await create.click();
    await expect(dialog).toHaveCount(0);
    expect(await tagState(page)).toMatchObject({
        tags: [{ name: "jump", from: 5, to: 6, color: 0xa8ca58ff }],
        undoCount: before + 1,
    });

    // Escape cancels a dialog: nothing changes.
    await tagSpan(page, "jump").dblclick();
    const properties = propertiesDialog(page);
    await expect(nameField(properties)).toBeFocused();
    await nameField(properties).fill("other");
    await page.keyboard.press("Escape");
    await expect(properties).toHaveCount(0);
    expect(await tagState(page)).toMatchObject({
        tags: [{ name: "jump" }],
        undoCount: before + 1,
    });
    expect(errors).toEqual([]);
});

test("a tag's label contrasts at least 4.5:1 with black, white and mid-grey spans", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 6);
    const spans = [
        { name: "black", from: 1, to: 2, color: 0x000000ff, label: "rgb(255, 255, 255)" },
        { name: "white", from: 3, to: 4, color: 0xffffffff, label: "rgb(0, 0, 0)" },
        { name: "grey", from: 5, to: 6, color: 0x808080ff, label: "rgb(0, 0, 0)" },
    ];
    await addTags(page, spans);
    for (const { name, label } of spans) {
        const colours = await tagSpan(page, name).evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, color: style.color };
        });
        expect(colours.color, name).toBe(label);
        expect(contrast(colours.background, colours.color), name).toBeGreaterThanOrEqual(4.5);
    }
    // axe judges the labels against their spans too.
    const result = await audit(page, "[data-timeline-tags]");
    expect(result.violations).toEqual([]);
    expect(result.contrastUndecided).toEqual([]);
    expect(result.contrastChecked).toBeGreaterThanOrEqual(spans.length);
    expect(errors).toEqual([]);
});

test("the active tag at the active frame is marked, and a double-click edits the tag of its span", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 7);
    await addTags(page, [
        { name: "outer", from: 1, to: 6 },
        { name: "inner", from: 3, to: 4 },
    ]);
    const current = () =>
        tagBar(page)
            .locator('[role="listitem"][aria-current="true"]')
            .evaluateAll((items) => items.map((item) => item.textContent));

    // Frame 3 is in both: the shorter one is the active tag (SPEC §7.4).
    await frameHeader(page, 3).click();
    await expect.poll(current).toEqual(["inner"]);
    await frameHeader(page, 6).click();
    await expect.poll(current).toEqual(["outer"]);
    // Outside every tag: none, and the tag commands of the Frame menu are disabled.
    await frameHeader(page, 7).click();
    await expect.poll(current).toEqual([]);
    await openMenu(page, "Frame");
    await expect(menuItem(page, "frame.newTag")).not.toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "frame.tagProperties")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "frame.deleteTag")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(menuTrigger(page, "Frame")).toBeFocused();

    // Each span is named by its tag and frames.
    await expect(tagBar(page).getByRole("listitem", { name: "outer, frames 1–6" })).toBeVisible();
    await expect(tagBar(page).getByRole("listitem", { name: "inner, frames 3–4" })).toBeVisible();

    // The outer tag's span, with the inner one active: its own properties. Both tags are at
    // the active frame, so the dialog's Tag select comes first, with the outer one chosen.
    await frameHeader(page, 3).click();
    await expect.poll(current).toEqual(["inner"]);
    await tagSpan(page, "outer").dblclick();
    const properties = propertiesDialog(page);
    const choice = properties.getByRole("combobox", { name: "Tag", exact: true });
    await expect(choice).toBeFocused();
    await expect(choice).toHaveText("outer, frames 1–6");
    await expect(nameField(properties)).toHaveValue("outer");
    await expect(field(properties, "From")).toHaveValue("1");
    await expect(field(properties, "To")).toHaveValue("6");
    await dialogButton(properties, "Cancel").click();
    await expect(properties).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("a press on the tag bar keeps the focus in the timeline, on the active cell", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 4);
    await addTags(page, [{ name: "walk", from: 2, to: 3 }]);
    await viewport(page).focus();
    await expect(viewport(page)).toBeFocused();
    const before = await documentState(page);
    await tagSpan(page, "walk").click();
    await expect(activeCell(page)).toBeFocused();
    // Nothing was selected or made active, once the panel has drawn what the press did.
    await panelDrawn(page);
    const after = await documentState(page);
    expect(after.activeFrame).toBe(before.activeFrame);
    expect(after.undoCount).toBe(before.undoCount);
    expect(await selectedFrames(page)).toEqual([]);

    // A press on the bar beside the spans as well.
    await viewport(page).focus();
    await expect(viewport(page)).toBeFocused();
    const bar = await boxOf(timeline(page).locator("[data-timeline-tags]"));
    await page.mouse.click(await frameX(page, 4), bar.y + bar.height / 2);
    await expect(activeCell(page)).toBeFocused();
    expect((await documentState(page)).activeFrame).toBe(before.activeFrame);
    expect(errors).toEqual([]);
});

/**
 * Frame → Tag Properties… from the keyboard: the menu bar's Frame menu with Enter, its item by
 * typing, Enter. The focus starts on the Frame menu's trigger.
 */
async function tagPropertiesFromKeyboard(page: Page): Promise<Locator> {
    await expect(menuTrigger(page, "Frame")).toBeFocused();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Frame" });
    await expect(menu).toBeVisible();
    // Radix focuses the first item one timer after the menu opens; typing acts on the focus.
    await expect(menu.locator(":focus")).toHaveCount(1);
    await page.keyboard.type("Tag P");
    await expect(menuItem(page, "frame.tagProperties")).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = propertiesDialog(page);
    await expect(dialog).toBeVisible();
    return dialog;
}

/** Chooses a tag in the Tag select of the dialog from the keyboard: Enter, ↑ or ↓, Enter. */
async function chooseTag(page: Page, dialog: Locator, from: string, to: string, key: string) {
    const choice = dialog.getByRole("combobox", { name: "Tag", exact: true });
    await expect(choice).toBeFocused();
    await expect(choice).toHaveText(from);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: from, exact: true })).toBeFocused();
    await page.keyboard.press(key);
    await expect(page.getByRole("option", { name: to, exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(choice).toHaveText(to);
    await expect(choice).toBeFocused();
}

test("keyboard only: a tag that another covers is chosen in Tag Properties…, edited with Enter and deleted from the dialog", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 5);
    // "walk" and "loop" share frames 2–4; "loop", created later, is the active tag all over
    // them, so "walk" is never the active tag.
    await addTags(page, [
        { name: "walk", from: 2, to: 4 },
        { name: "loop", from: 2, to: 4 },
    ]);
    const start = (await tagState(page)).undoCount;

    // No pointer from here on: the active cell, then Home and → to frame 3.
    await activeCell(page).focus();
    await page.keyboard.press("Home");
    await expect(cell(page, "Layer 1", 1)).toBeFocused();
    for (const frame of [2, 3]) {
        await page.keyboard.press("ArrowRight");
        await expect(cell(page, "Layer 1", frame)).toBeFocused();
    }
    // F6 to the menu bar (its first trigger), then → to Frame.
    const inMenuBar = () =>
        page.evaluate(() => document.activeElement?.closest('[data-region="menu-bar"]') !== null);
    for (let presses = 0; presses < 8 && !(await inMenuBar()); presses++) {
        await page.keyboard.press("F6");
        await afterFrames(page, 1);
    }
    await expect(menuTrigger(page, "File")).toBeFocused();
    for (const name of ["Edit", "Sprite", "Layer", "Frame"]) {
        await page.keyboard.press("ArrowRight");
        await expect(menuTrigger(page, name)).toBeFocused();
    }

    // The dialog opens on the active tag; the covered one is chosen and renamed.
    let dialog = await tagPropertiesFromKeyboard(page);
    await chooseTag(page, dialog, "loop, frames 2–4", "walk, frames 2–4", "ArrowUp");
    await expect(nameField(dialog)).toHaveValue("walk");
    await page.keyboard.press("Tab");
    await expect(nameField(dialog)).toBeFocused();
    // The field's text is selected when it takes the focus: typing replaces it.
    await page.keyboard.type("stride");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    expect(await tagState(page)).toMatchObject({
        tags: [
            { name: "stride", from: 2, to: 4 },
            { name: "loop", from: 2, to: 4 },
        ],
        undoCount: start + 1,
        undoLabel: "Edit Tag",
    });

    // Delete from the dialog: the covered tag chosen again, then its Delete button, the third
    // control from the end (Delete, Cancel, OK): Shift+Tab from the first control wraps.
    dialog = await tagPropertiesFromKeyboard(page);
    await chooseTag(page, dialog, "loop, frames 2–4", "stride, frames 2–4", "ArrowUp");
    for (const name of ["OK", "Cancel", "Delete"]) {
        await page.keyboard.press("Shift+Tab");
        await expect(dialogButton(dialog, name)).toBeFocused();
    }
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    expect(await tagState(page)).toMatchObject({
        tags: [{ name: "loop", from: 2, to: 4 }],
        undoCount: start + 2,
        undoLabel: "Delete Tag",
    });
    await expect(menuTrigger(page, "Frame")).toBeFocused();
    expect(errors).toEqual([]);
});

test("after a resize the span keeps the new range until the panel draws it", async ({ page }) => {
    const errors = collectErrors(page);
    await openTags(page, 6);
    await addTags(page, [{ name: "walk", from: 2, to: 3 }]);
    const span = tagSpan(page, "walk");
    const y = await pressHandle(page, span, "to");
    await page.mouse.move(await frameX(page, 5), y, { steps: 4 });
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 2, 5, 0));

    // With the animation frames held the panel cannot draw the tag's new range: the span
    // shows it all the same after the release, in no frame the old one.
    const release = await holdAnimationFrames(page);
    await page.mouse.up();
    await expect.poll(async () => (await tagState(page)).tags[0]).toMatchObject({ from: 2, to: 5 });
    await expect(span).not.toHaveAttribute("data-resizing");
    for (let round = 0; round < 3; round++) {
        expect(await boxOf(span), `round ${round}`).toEqual(await expectedSpan(page, 2, 5, 0));
        await settleTimers(page);
    }
    // Its name gives the frames it shows.
    await expect(span).toHaveAttribute("aria-label", "walk, frames 2–5");
    await release();
    await panelDrawn(page);
    expect(await boxOf(span)).toEqual(await expectedSpan(page, 2, 5, 0));
    expect(errors).toEqual([]);
});

test("closing the Tag dialog opened by a double-click leaves the timeline where it is scrolled", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 80);
    await addTags(page, [{ name: "far", from: 70, to: 75 }]);
    // Frame 1 active, the timeline scrolled to its end: the active cell is out of view.
    await frameHeader(page, 1).click();
    await expect.poll(async () => (await documentState(page)).activeFrame).toBe(1);
    await panelDrawn(page);
    const panel = scroller(page);
    await panel.evaluate((element) => void (element.scrollLeft = element.scrollWidth));
    const left = await panel.evaluate((element) => element.scrollLeft);
    expect(left).toBeGreaterThan(0);
    const first = await boxOf(cell(page, "Layer 1", 1));
    const column = await boxOf(timeline(page).getByRole("group", { name: "Transport" }));
    expect(first.x + first.width).toBeLessThanOrEqual(column.x + column.width);
    const scrolled = () => panel.evaluate((element) => element.scrollLeft);

    // Escape.
    const dialog = propertiesDialog(page);
    await tagSpan(page, "far").dblclick();
    await expect(nameField(dialog)).toBeFocused();
    expect(await scrolled()).toBe(left);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(cell(page, "Layer 1", 1)).toBeFocused();
    expect(await scrolled()).toBe(left);

    // OK.
    await tagSpan(page, "far").dblclick();
    await expect(nameField(dialog)).toBeFocused();
    await dialogButton(dialog, "OK").click();
    await expect(dialog).toHaveCount(0);
    await expect(cell(page, "Layer 1", 1)).toBeFocused();
    expect(await scrolled()).toBe(left);
    expect(errors).toEqual([]);
});

test("a drag whose tag goes away while the button is held ends there; the next press starts a drag", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTags(page, 6);
    await addTags(page, [{ name: "walk", from: 2, to: 3 }]);
    const span = tagSpan(page, "walk");
    const y = await pressHandle(page, span, "to");
    await page.mouse.move(await frameX(page, 5), y, { steps: 4 });
    await expect.poll(() => boxOf(span)).toEqual(await expectedSpan(page, 2, 5, 0));

    // Undo the tag's creation with the button held: the span goes, and the release finds no
    // drag to apply.
    await expect(activeCell(page)).toBeFocused();
    await page.keyboard.press("Control+z");
    await expect(tagBar(page).getByRole("listitem")).toHaveCount(0);
    const undone = await tagState(page);
    expect(undone).toMatchObject({ tags: [], redoLabel: "New Tag" });
    await page.mouse.up();
    await panelDrawn(page);
    // No Apply Tag Range: no step, and the redo is still there.
    expect(await tagState(page)).toEqual(undone);

    // Redo brings the tag back as it was: nothing of the drag that ended comes back with it.
    await page.keyboard.press("Control+y");
    await expect(span).toBeVisible();
    await panelDrawn(page);
    await expect(span).not.toHaveAttribute("data-resizing");
    expect(await boxOf(span)).toEqual(await expectedSpan(page, 2, 3, 0));
    // A press on a handle starts a drag again (with the mouse, the same pointer as the drag
    // that ended).
    const again = await pressHandle(page, span, "to");
    await page.mouse.move(await frameX(page, 4), again, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await tagState(page)).tags[0]).toMatchObject({ from: 2, to: 4 });
    expect((await tagState(page)).undoCount).toBe(undone.undoCount + 2);
    expect(errors).toEqual([]);
});
