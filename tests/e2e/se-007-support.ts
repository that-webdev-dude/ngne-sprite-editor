import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { region } from "./se-006-support";

// Shared helpers of the SE-007 specs that drive the real app through its test hook.

/** Opens the app and waits for the shell and the test hook. */
export async function openEditor(page: Page): Promise<void> {
    await page.goto("/");
    await expect(region(page, "viewport")).toBeVisible();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
}

/** Opens a new document as the active session; returns its id. */
export function openSession(
    page: Page,
    options: { name: string; width: number; height: number },
): Promise<string> {
    return page.evaluate((document) => window.__ngneTest!.openSession(document), options);
}

/**
 * Executes an undoable test command on a document's history: it renames the document, and
 * undo restores the previous name. `label` is what the Edit menu shows after "Undo".
 */
export function rename(page: Page, id: string, name: string, label: string): Promise<void> {
    return page.evaluate(
        ({ id, name, label }) => {
            const { documents } = window.__ngneTest!.sessions.getState();
            const document = documents.find((entry) => entry.id === id);
            if (!document) throw new Error(`No open document ${id}`);
            let previous = "";
            document.history.execute({
                label,
                bytes: 0,
                touched: { frameIds: [], layerIds: [], structure: false },
                do(session) {
                    previous = session.doc.name;
                    session.doc.name = name;
                },
                undo(session) {
                    session.doc.name = previous;
                },
            });
        },
        { id, name, label },
    );
}

/** What a spec reads of one open document. */
export interface DocumentSnapshot {
    name: string;
    active: boolean;
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    position: number;
}

export function snapshot(page: Page, id: string): Promise<DocumentSnapshot> {
    return page.evaluate((id) => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === id);
        if (!document) throw new Error(`No open document ${id}`);
        const { history } = document;
        return {
            name: document.session.doc.name,
            active: state.activeId === id,
            canUndo: history.canUndo,
            canRedo: history.canRedo,
            undoLabel: history.undoLabel,
            redoLabel: history.redoLabel,
            position: history.position,
        };
    }, id);
}

/** A menu of the menu bar, opened by its trigger. */
export async function openMenu(page: Page, name: string): Promise<Locator> {
    await menuTrigger(page, name).click();
    const menu = page.getByRole("menu", { name });
    await expect(menu).toBeVisible();
    return menu;
}

export function menuTrigger(page: Page, name: string): Locator {
    return region(page, "menu-bar").getByRole("menuitem", { name, exact: true });
}

export async function closeMenu(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
}

/** The item of a command in the open menu. */
export function menuItem(page: Page, commandId: string): Locator {
    return page.locator(`[role="menuitem"][data-command="${commandId}"]`);
}

/** Adds a text field to a region of the shell (or to the page) and returns it. */
export async function addTextField(page: Page, regionId?: string): Promise<Locator> {
    await page.evaluate((regionId) => {
        const field = document.createElement("input");
        field.setAttribute("aria-label", "Test field");
        field.dataset.testid = "test-field";
        const parent = regionId ? document.querySelector(`[data-region="${regionId}"]`) : null;
        (parent ?? document.body).append(field);
    }, regionId);
    return page.getByTestId("test-field");
}

/** The texts of the status bar by field name; a field that is not rendered is missing. */
export function statusBar(page: Page): Promise<Record<string, string>> {
    return region(page, "status-bar").evaluate((bar) =>
        Object.fromEntries(
            Array.from(bar.querySelectorAll<HTMLElement>("[data-status]"), (field) => [
                field.dataset.status ?? "",
                field.textContent ?? "",
            ]),
        ),
    );
}
