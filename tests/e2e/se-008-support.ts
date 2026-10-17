import { AxeBuilder } from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { region } from "./se-006-support";
import { menuItem, openMenu } from "./se-007-support";

// Shared helpers of the SE-008 specs: the empty state, the New sprite and Sprite properties
// dialogs, and what they leave in the store.

export type Theme = "dark" | "light";
export const THEMES: readonly Theme[] = ["dark", "light"];
const THEME_KEY = "ngne-sprite-editor.theme";

/** Makes the app start in `theme`; call before the page is opened. */
export async function startInTheme(page: Page, theme: Theme): Promise<void> {
    await page.addInitScript(({ key, theme }) => window.localStorage.setItem(key, theme), {
        key: THEME_KEY,
        theme,
    });
}

export const emptyState = (page: Page) => region(page, "viewport").locator("[data-empty-state]");
export const newSpriteButton = (page: Page) =>
    region(page, "viewport").getByRole("button", { name: "New sprite", exact: true });
export const documentName = (page: Page) =>
    region(page, "menu-bar").locator("[data-document-name]");

export const newSpriteDialog = (page: Page) => page.getByRole("dialog", { name: "New sprite" });
export const discardDialog = (page: Page) =>
    page.getByRole("dialog", { name: "Discard unsaved changes?" });
export const propertiesDialog = (page: Page) =>
    page.getByRole("dialog", { name: "Sprite properties" });

export const field = (scope: Locator, name: string) =>
    scope.getByRole("spinbutton", { name, exact: true });
export const nameField = (dialog: Locator) => dialog.getByRole("textbox", { name: "Name" });
export const dialogButton = (dialog: Locator, name: string) =>
    dialog.getByRole("button", { name, exact: true });
export const group = (dialog: Locator, name: string) =>
    dialog.getByRole("group", { name, exact: true });
export const pivotPreset = (dialog: Locator, name: string) =>
    dialog
        .getByRole("radiogroup", { name: "Pivot presets" })
        .getByRole("radio", { name, exact: true });

/** Types a value into a number field and applies it by leaving the field. */
export async function setNumber(target: Locator, value: number | string): Promise<void> {
    await target.fill(String(value));
    await target.blur();
}

/** Opens the New sprite dialog from the File menu. */
export async function openNewSpriteFromMenu(page: Page): Promise<Locator> {
    await openMenu(page, "File");
    await menuItem(page, "file.new").click();
    await expect(newSpriteDialog(page)).toBeVisible();
    return newSpriteDialog(page);
}

/** Opens the Sprite properties dialog from the Sprite menu. */
export async function openProperties(page: Page): Promise<Locator> {
    await openMenu(page, "Sprite");
    await menuItem(page, "sprite.properties").click();
    await expect(propertiesDialog(page)).toBeVisible();
    return propertiesDialog(page);
}

/** What a spec reads of the open documents. */
export interface StoreSnapshot {
    /** Number of open documents. */
    count: number;
    /** The active document, or null when none is open. */
    active: {
        id: string;
        name: string;
        width: number;
        height: number;
        pivot: { x: number; y: number };
        grid: { width: number; height: number; offsetX: number; offsetY: number; visible: boolean };
        layers: number;
        frames: number;
        /** History entries that undo can reverse, and the label of the newest. */
        undoCount: number;
        undoLabel: string | null;
        redoCount: number;
        /** The dirty rule of SPEC §5.2, read from the store's record of the document. */
        dirty: boolean;
    } | null;
}

export function storeSnapshot(page: Page): Promise<StoreSnapshot> {
    return page.evaluate((): StoreSnapshot => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) return { count: state.documents.length, active: null };
        const { doc } = document.session;
        const { history } = document;
        return {
            count: state.documents.length,
            active: {
                id: document.id,
                name: doc.name,
                width: doc.width,
                height: doc.height,
                pivot: { ...doc.pivot },
                grid: { ...doc.settings.grid },
                layers: doc.layers.length,
                frames: doc.frames.length,
                undoCount: history.undoCount,
                undoLabel: history.undoLabel,
                redoCount: history.redoCount,
                dirty:
                    history.position !== document.savedPosition ||
                    JSON.stringify(doc.exportSettings) !== document.savedExportSettings,
            },
        };
    });
}

/** The active document of the store; fails when none is open. */
export async function activeDocument(page: Page): Promise<NonNullable<StoreSnapshot["active"]>> {
    const { active } = await storeSnapshot(page);
    if (!active) throw new Error("No document is open");
    return active;
}

// --- Accessibility ------------------------------------------------------------------------

const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Whether any part of the element lies inside the visible box of its scrolling ancestors. */
function isOnScreen(page: Page, selector: string): Promise<boolean> {
    return page.locator(selector).evaluate((element) => {
        let { left, top, right, bottom } = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.overflowX === "visible" && style.overflowY === "visible") continue;
            const clip = parent.getBoundingClientRect();
            left = Math.max(left, clip.left);
            top = Math.max(top, clip.top);
            right = Math.min(right, clip.right);
            bottom = Math.min(bottom, clip.bottom);
        }
        return right > left && bottom > top;
    });
}

/**
 * Runs axe (WCAG 2.1 A and AA) on the page, or on the subtree under `scope`: the bar SE-006
 * set for the gallery. Returns the violations and what the contrast rule covered: the nodes it
 * judged, and the nodes on screen it could not decide on (those would hide a failure).
 */
export async function audit(page: Page, scope?: string) {
    // Text made only of symbols ("←", the key of a shortcut) is judged as well: by default the
    // contrast rule leaves it undecided (`ignoreUnicode`), which would hide a failure (SE-022).
    const judgeSymbols = {
        checks: { "color-contrast": { options: { ignoreUnicode: false } } },
    } as Parameters<AxeBuilder["options"]>[0];
    const builder = new AxeBuilder({ page }).options(judgeSymbols).withTags(AA_TAGS);
    const results = await (scope ? builder.include(scope) : builder).analyze();
    const contrast = (list: typeof results.passes) =>
        list.filter((rule) => rule.id === "color-contrast").flatMap((rule) => rule.nodes);
    const contrastUndecided = [];
    for (const node of contrast(results.incomplete)) {
        const selector = node.target.join(" ");
        if (await isOnScreen(page, selector)) contrastUndecided.push(selector);
    }
    return {
        violations: results.violations.flatMap((rule) =>
            rule.nodes.map(
                (node) => `${rule.id}: ${node.target.join(" ")} — ${node.failureSummary}`,
            ),
        ),
        contrastChecked: contrast(results.passes).length,
        contrastUndecided,
    };
}
