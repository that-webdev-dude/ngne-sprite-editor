import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boxOf, collectErrors, region } from "./se-006-support";
import {
    closeMenu,
    menuItem,
    openEditor,
    openMenu,
    openSession,
    rename,
    snapshot,
    statusBar,
} from "./se-007-support";

// SE-007: the stores behind the interface — sessions with their histories, per-document state
// and the status bar bound to them (DESIGN §5.7).

/** The status bar fields that describe a document. */
const DOCUMENT_FIELDS = ["cursor", "size", "zoom", "frame", "duration", "selection"];

function activate(page: Page, id: string): Promise<void> {
    return page.evaluate((id) => window.__ngneTest!.sessions.getState().activate(id), id);
}

/**
 * What the status bar has to show for the active document, read from the store at this
 * moment. The zoom is whatever the document's view holds: features that set it are not this
 * ticket's.
 */
function activeDocumentFields(page: Page): Promise<Record<string, string>> {
    return page.evaluate((): Record<string, string> => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) return {};
        const { doc, activeFrameId } = document.session;
        const index = doc.frames.findIndex((frame) => frame.id === activeFrameId);
        return {
            size: `${doc.width} × ${doc.height}`,
            zoom: `${document.view.scale}×`,
            frame: `Frame ${index + 1}/${doc.frames.length}`,
            duration: `${doc.frames[index]?.durationMs} ms`,
        };
    });
}

/** The status bar shows the active document; returns the fields for further checks. */
async function expectStatusOfActiveDocument(page: Page): Promise<Record<string, string>> {
    const shown = await statusBar(page);
    expect(shown).toMatchObject(await activeDocumentFields(page));
    return shown;
}

async function expectNoDocumentFields(page: Page): Promise<void> {
    const shown = await statusBar(page);
    for (const field of DOCUMENT_FIELDS) expect(shown, field).not.toHaveProperty(field);
}

/** The titles of Undo and Redo in the Edit menu. */
async function editTitles(page: Page): Promise<string[]> {
    await openMenu(page, "Edit");
    const titles = [
        await menuItem(page, "edit.undo").textContent(),
        await menuItem(page, "edit.redo").textContent(),
    ];
    await closeMenu(page);
    return titles.map((title) => title ?? "");
}

test("the status bar shows no document field while no document is open", async ({ page }) => {
    await openEditor(page);
    await expectNoDocumentFields(page);
    expect((await boxOf(region(page, "status-bar"))).height).toBe(24);
});

test("the test hook opens a session that the interface shows", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const id = await openSession(page, { name: "hero", width: 32, height: 24 });
    expect(await snapshot(page, id)).toMatchObject({ name: "hero", active: true, canUndo: false });
    await page.evaluate(() => window.__ngneTest!.assertInvariants());

    // Fields with a source are shown; a selection does not exist, so its field is absent.
    const shown = await expectStatusOfActiveDocument(page);
    expect(shown).toMatchObject({ size: "32 × 24", frame: "Frame 1/1", duration: "100 ms" });
    expect(shown.zoom).toMatch(/^[\d.]+×$/);
    expect(shown).not.toHaveProperty("selection");
    expect((await boxOf(region(page, "status-bar"))).height).toBe(24);
    expect(errors).toEqual([]);
});

test("switching the active session switches history, state and status bar", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);

    const hero = await openSession(page, { name: "hero", width: 32, height: 32 });
    await rename(page, hero, "hero-2", "Pencil");
    await page.evaluate((id) => {
        const sessions = window.__ngneTest!.sessions.getState();
        const document = sessions.documents.find((entry) => entry.id === id);
        if (!document) throw new Error("no document");
        // A second frame, made active, and a view of its own: state outside the history.
        document.session.doc.frames.push({ id: "second-frame", durationMs: 80 });
        document.session.activeFrameId = "second-frame";
        sessions.touch(id);
        sessions.setView(id, { scale: 12 });
    }, hero);
    expect(await expectStatusOfActiveDocument(page)).toMatchObject({
        size: "32 × 32",
        frame: "Frame 2/2",
        duration: "80 ms",
    });

    // Opening a second document makes it the active one.
    const tiles = await openSession(page, { name: "tiles", width: 16, height: 48 });
    await rename(page, tiles, "tiles-2", "Bucket");
    await rename(page, tiles, "tiles-3", "Line");
    expect(await snapshot(page, tiles)).toMatchObject({ active: true, undoLabel: "Line" });
    expect(await snapshot(page, hero)).toMatchObject({ active: false, undoLabel: "Pencil" });
    expect(await expectStatusOfActiveDocument(page)).toMatchObject({
        size: "16 × 48",
        frame: "Frame 1/1",
        duration: "100 ms",
    });
    expect(await editTitles(page)).toEqual(["Undo LineCtrl+Z", "RedoCtrl+Y"]);

    // Undo acts on the active document only.
    await page.keyboard.press("Control+KeyZ");
    expect((await snapshot(page, tiles)).name).toBe("tiles-2");
    expect((await snapshot(page, hero)).name).toBe("hero-2");
    expect(await editTitles(page)).toEqual(["Undo BucketCtrl+Z", "Redo LineCtrl+Y"]);

    await activate(page, hero);
    expect(await expectStatusOfActiveDocument(page)).toMatchObject({
        size: "32 × 32",
        frame: "Frame 2/2",
        duration: "80 ms",
    });
    expect(await editTitles(page)).toEqual(["Undo PencilCtrl+Z", "RedoCtrl+Y"]);
    await page.keyboard.press("Control+KeyZ");
    expect((await snapshot(page, hero)).name).toBe("hero");
    expect((await snapshot(page, tiles)).name).toBe("tiles-2");
    // Nothing left in this history; the other one is untouched by the extra key.
    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page, tiles)).toMatchObject({ name: "tiles-2", redoLabel: "Line" });
    expect(await editTitles(page)).toEqual(["UndoCtrl+Z", "Redo PencilCtrl+Y"]);

    await activate(page, tiles);
    expect((await expectStatusOfActiveDocument(page)).size).toBe("16 × 48");
    expect(await editTitles(page)).toEqual(["Undo BucketCtrl+Z", "Redo LineCtrl+Y"]);
    await page.keyboard.press("Control+KeyY");
    expect((await snapshot(page, tiles)).name).toBe("tiles-3");
    expect((await snapshot(page, hero)).name).toBe("hero");

    // The view is per document, and so is the zoom the bar shows.
    await page.evaluate(
        ({ hero, tiles }) => {
            const sessions = window.__ngneTest!.sessions.getState();
            sessions.setView(hero, { scale: 12 });
            sessions.setView(tiles, { scale: 4 });
        },
        { hero, tiles },
    );
    expect((await expectStatusOfActiveDocument(page)).zoom).toBe("4×");
    await activate(page, hero);
    expect((await expectStatusOfActiveDocument(page)).zoom).toBe("12×");
    await activate(page, tiles);
    expect((await expectStatusOfActiveDocument(page)).zoom).toBe("4×");

    // The dirty flag is per document as well: only "tiles" differs from its opened state.
    const dirty = await page.evaluate(() => {
        const { documents } = window.__ngneTest!.sessions.getState();
        return documents.map((document) => document.history.position !== document.savedPosition);
    });
    expect(dirty).toEqual([false, true]);

    // Closing the active document shows the other; closing the last leaves no document field.
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), tiles);
    expect(await snapshot(page, hero)).toMatchObject({ active: true });
    expect((await expectStatusOfActiveDocument(page)).size).toBe("32 × 32");
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), hero);
    await expectNoDocumentFields(page);
    expect(await editTitles(page)).toEqual(["UndoCtrl+Z", "RedoCtrl+Y"]);

    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    expect(errors).toEqual([]);
});

test("the status bar shows cursor, selection and messages once they have a source", async ({
    page,
}) => {
    await openEditor(page);
    const id = await openSession(page, { name: "hero", width: 32, height: 32 });
    await page.evaluate((id) => {
        const { sessions, status } = window.__ngneTest!;
        const document = sessions.getState().documents.find((entry) => entry.id === id);
        if (!document) throw new Error("no document");
        status.getState().setCursor({ x: 14, y: 9 });
        status.getState().setHint("Shift: constrain line");
        document.session.selection = {
            mask: { width: 32, height: 32, data: new Uint8Array(128) },
            bounds: { x: 2, y: 3, width: 11, height: 8 },
        };
        sessions.getState().touch(id);
    }, id);

    // Left to right in the order of DESIGN §5.7, the message on the right.
    const bar = region(page, "status-bar");
    const { zoom = "" } = await activeDocumentFields(page);
    await expect(bar.locator("[data-status]")).toHaveText([
        "14, 9",
        "32 × 32",
        zoom,
        "Frame 1/1",
        "100 ms",
        "Selection 11 × 8",
        "Shift: constrain line",
    ]);
    const names = await bar
        .locator("[data-status]")
        .evaluateAll((fields) => fields.map((field) => field.getAttribute("data-status")));
    expect(names).toEqual([...DOCUMENT_FIELDS, "message"]);

    const message = bar.locator('[data-status="message"]');
    const barBox = await boxOf(bar);
    const messageBox = await boxOf(message);
    expect(Math.round(barBox.x + barBox.width - (messageBox.x + messageBox.width))).toBe(12);
    await expect(message).toHaveAttribute("data-kind", "hint");
    expect(barBox.height).toBe(24);

    // Transient tool feedback replaces the hint, in the warning colour.
    await page.evaluate(() => window.__ngneTest!.status.getState().setFeedback("Layer is locked"));
    await expect(message).toHaveText("Layer is locked");
    await expect(message).toHaveAttribute("data-kind", "feedback");
    const colours = await message.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--warn");
        document.body.append(probe);
        const warn = getComputedStyle(probe).color;
        probe.remove();
        return { warn, shown: getComputedStyle(element).color };
    });
    expect(colours.shown).toBe(colours.warn);

    await page.evaluate(() => {
        const { status } = window.__ngneTest!;
        status.getState().setFeedback(null);
        status.getState().setHint(null);
        status.getState().setCursor(null);
    });
    await expect(bar.locator('[data-status="message"]')).toHaveCount(0);
    await expect(bar.locator('[data-status="cursor"]')).toHaveCount(0);
});

test("global editor state does not change with the active document", async ({ page }) => {
    await openEditor(page);
    const read = () =>
        page.evaluate(() => {
            const { tool, foreground, background, toolOptions } =
                window.__ngneTest!.editor.getState();
            return { tool, foreground, background, toolOptions };
        });
    await page.evaluate(() => {
        const editor = window.__ngneTest!.editor.getState();
        editor.setTool("eraser");
        editor.setForeground(0x83e8e1ff);
        editor.setBackground(0x0f0f10ff);
        editor.setToolOptions("eraser", { size: 4 });
    });
    const expected = {
        tool: "eraser",
        foreground: 0x83e8e1ff,
        background: 0x0f0f10ff,
        toolOptions: { eraser: { size: 4 } },
    };
    expect(await read()).toMatchObject(expected);

    const first = await openSession(page, { name: "a", width: 8, height: 8 });
    const second = await openSession(page, { name: "b", width: 8, height: 8 });
    await activate(page, first);
    expect(await read()).toMatchObject(expected);
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), second);
    expect(await read()).toMatchObject(expected);
});
