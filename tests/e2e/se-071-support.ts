import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type * as DialogRequestsModule from "../../src/app/dialogs/dialogRequests";
import type * as SurfacesModule from "../../src/app/surfaces/surfaces";
import type * as CoreModel from "../../src/core/model";
import type * as DialogRegistryModule from "../../src/ui/dialogs/registry";
import { settleTimers } from "./se-006-support";
import { openEditor, rename } from "./se-007-support";
import { audit, startInTheme } from "./se-008-support";
import type { Theme } from "./se-008-support";
import { stubFileSystemAccess } from "./se-041-support";
import { acceptUnload, autosaveContents, reloadEditor } from "./se-042-support";
import { dropFiles, gradient, pngFile } from "./se-044-support";
import { stubProjectFiles } from "./se-047-support";
import { arrangeFolders, putFiles, stubExportFolders } from "./se-052-support";

// Shared helpers of the SE-071 audit. Every surface the app can show is reached from its
// registries at run time, not from a list written here:
//
// - the dialogs a command asks for (`ui/dialogs/registry.ts`, `*.dialog.tsx`) and the app's
//   own surfaces (`app/surfaces/surfaces.ts`): every enabled command of the registry whose
//   title ends in "…" (the menu convention for a command that asks for more) is run, and
//   whatever surface it opens is visited — dialogs, popovers, the command palette. Four
//   dialogs answer a situation, not such a command (a dirty document closed, files already in
//   the export folder, a file dropped, a snapshot at launch); `visitAllSurfaces` brings each
//   about, and then checks that every registered dialog kind and every app surface was
//   visited, so a dialog added later that no path reaches fails the run.
// - menus from `MENU_BAR` and the menu paths of the registry, context menus from the names
//   commands list in `contextMenus`, dock panels from the dock registry, the context bar of
//   every tool of the tool registry.

/** The window sizes of DESIGN §8: the minimum window, and 1920 × 1080 at 125% browser zoom. */
export const WINDOWS = [
    { name: "1280×720", width: 1280, height: 720 },
    // 125% zoom of a 1920 × 1080 window lays the page out in 1536 × 864 CSS pixels, at a
    // device pixel ratio of 1.25; the test lays it out at DPR 1 (the boxes are CSS pixels).
    { name: "1536×864 (125% of 1920×1080)", width: 1536, height: 864 },
] as const;

/** Top-level surfaces: dialogs, popovers (Radix gives them `dialog`), menus, select lists. */
export const SURFACE_SELECTOR =
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** What a surface's visit gets. */
export interface SurfaceVisit {
    /** What opened it: a command id, or the situation of a dialog no command asks for. */
    source: string;
    /** The dialog request kind or app surface id behind it; null for another surface. */
    kind: string | null;
    /** Its accessible name. */
    name: string;
    /** A CSS selector of the surface element (a data attribute put on it). */
    selector: string;
    surface: Locator;
}

declare global {
    interface Window {
        __se071?: { settled: boolean; failures: string[] };
    }
}

/** The image every file chooser for PNG files gets: an import source, a reference. */
export const SOURCE_PNG = pngFile("walk.png", gradient(64, 16));

/**
 * Opens the editor in `theme` at `size`, with transitions off (colours final when read), the
 * File System Access pickers of SE-041 and SE-052 (which cancel unless told otherwise), and
 * every file chooser answered: a PNG where it asks for images, cancelled otherwise.
 */
export async function startEditor(
    page: Page,
    {
        theme = "dark",
        size = WINDOWS[0],
        projectFiles = false,
    }: {
        theme?: Theme;
        size?: { width: number; height: number };
        /** Project files on OPFS (SE-047's stub), so that a save lists a recent file. */
        projectFiles?: boolean;
    } = {},
): Promise<void> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: size.width, height: size.height });
    await startInTheme(page, theme);
    await (projectFiles ? stubProjectFiles(page) : stubFileSystemAccess(page));
    await stubExportFolders(page);
    page.on("filechooser", (chooser) => {
        void (async () => {
            const accept = (await chooser.element().getAttribute("accept")) ?? "";
            if (/png|image/.test(accept)) {
                const { name, mimeType, buffer } = SOURCE_PNG;
                await chooser.setFiles([{ name, mimeType, buffer }]);
            } else {
                await chooser
                    .element()
                    .evaluate((input) =>
                        input.dispatchEvent(new Event("cancel", { bubbles: true })),
                    );
            }
        })().catch(() => undefined);
    });
    acceptUnload(page);
    await openEditor(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/**
 * Opens "hero", 32 × 32: two layers, four frames with pixels in every cel, a tag over frames
 * 1–3, the upper layer active; then makes it dirty with one history step. Returns its id.
 */
export async function openRichDocument(page: Page, name = "hero"): Promise<string> {
    const id = await page.evaluate(async (name) => {
        const path = "/src/core/model/index.ts";
        const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
        const session = core.createDocument({ name, width: 32, height: 32 });
        const { doc } = session;
        const base = doc.layers[0]!;
        doc.layers = [
            { ...base, id: "se071-layer-1", name: "Body" },
            { ...base, id: "se071-layer-2", name: "Outline" },
        ];
        doc.frames = Array.from({ length: 4 }, (_, index) => ({
            id: `se071-frame-${index + 1}`,
            durationMs: 100,
        }));
        doc.layers.forEach((layer, l) => {
            doc.frames.forEach((frame, f) => {
                const data = new Uint8ClampedArray(32 * 32 * 4);
                for (let y = 4 + l * 4; y < 20 + l * 4; y++) {
                    for (let x = 6 + f * 2; x < 22 + f * 2; x++) {
                        data.set([40 + l * 120, 80 + f * 40, 160, 255], (y * 32 + x) * 4);
                    }
                }
                const imageId = `se071-image-${l}-${f}`;
                doc.images.set(imageId, { width: 32, height: 32, data });
                doc.cels.set(core.celKey(layer.id, frame.id), { imageId, opacity: 255 });
            });
        });
        doc.tags = [
            {
                id: "se071-tag",
                name: "walk",
                color: 0x73bed3ff,
                fromFrameId: doc.frames[0]!.id,
                toFrameId: doc.frames[2]!.id,
                direction: "forward",
                repeat: 0,
            },
        ];
        session.activeLayerId = doc.layers[1]!.id;
        session.activeFrameId = doc.frames[1]!.id;
        const opened = window.__ngneTest!.sessions.getState().open(session);
        window.__ngneTest!.assertInvariants();
        return opened.id;
    }, name);
    await rename(page, id, name, "Pencil");
    return id;
}

/** Runs a command as a menu does, without waiting for it; its failures are recorded. */
export async function runCommand(page: Page, id: string): Promise<void> {
    await page.evaluate((id) => {
        const record = (window.__se071 ??= { settled: true, failures: [] });
        const command = window.__ngneTest!.commands.get(id);
        if (!command) throw new Error(`No command ${id}`);
        record.settled = false;
        const fail = (error: unknown) => {
            record.failures.push(
                `${id}: ${error instanceof Error ? error.message : String(error)}`,
            );
            record.settled = true;
        };
        try {
            const result = command.run();
            if (result instanceof Promise) {
                result.then(() => (record.settled = true), fail);
            } else {
                record.settled = true;
            }
        } catch (error) {
            fail(error);
        }
    }, id);
}

/**
 * Makes the next run of a command, however it is started (a key, a menu, the palette),
 * report when its promise settles, as `runCommand` does, so that `surfaceOpened` waits for it.
 */
export async function armCommand(page: Page, id: string): Promise<void> {
    await page.evaluate((id) => {
        const record = (window.__se071 ??= { settled: true, failures: [] });
        const command = window.__ngneTest!.commands.get(id);
        if (!command) throw new Error(`No command ${id}`);
        const run = command.run;
        record.settled = false;
        const armed = command as { run: () => void | Promise<void> };
        armed.run = () => {
            armed.run = run;
            const finish = () => (record.settled = true);
            try {
                const result = run();
                if (result instanceof Promise) {
                    result.then(finish, (error: unknown) => {
                        record.failures.push(`${id}: ${String(error)}`);
                        finish();
                    });
                } else {
                    finish();
                }
                return result;
            } catch (error) {
                record.failures.push(`${id}: ${String(error)}`);
                finish();
                throw error;
            }
        };
    }, id);
}

/** Commands that failed when `runCommand` ran them. */
export function commandFailures(page: Page): Promise<string[]> {
    return page.evaluate(() => [...(window.__se071?.failures ?? [])]);
}

/**
 * The enabled commands of the registry that ask for more (a title ending in "…"), by id;
 * planned commands are left out.
 */
export function askingCommands(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        window
            .__ngneTest!.commands.list()
            .filter((command) => !command.planned && command.enabled())
            .filter((command) => command.title().endsWith("…"))
            .map((command) => command.id),
    );
}

/**
 * Marks the open top-level surfaces (`data-se071-surface`, in document order: the last is on
 * top) and returns how many there are. A surface inside another (the palette's list) is part
 * of it.
 */
export function markSurfaces(page: Page): Promise<number> {
    return page.evaluate((selector) => {
        for (const element of document.querySelectorAll("[data-se071-surface]")) {
            element.removeAttribute("data-se071-surface");
        }
        const open = [...document.querySelectorAll<HTMLElement>(selector)].filter(
            (element) => element.checkVisibility() && !element.parentElement?.closest(selector),
        );
        open.forEach((element, index) => element.setAttribute("data-se071-surface", `${index}`));
        return open.length;
    }, SURFACE_SELECTOR);
}

/** The surface on top, marked by `markSurfaces`; null while none is open. */
export async function topSurface(page: Page): Promise<{ selector: string; name: string } | null> {
    const count = await markSurfaces(page);
    if (count === 0) return null;
    const selector = `[data-se071-surface="${count - 1}"]`;
    const name = await page.locator(selector).evaluate((element) => {
        const label = element.getAttribute("aria-label");
        if (label) return label;
        const ids = element.getAttribute("aria-labelledby") ?? "";
        const named = ids
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
        return named || element.getAttribute("role") || "";
    });
    return { selector, name };
}

/** Waits until a surface is open, or the command run last has settled and none opened. */
export async function surfaceOpened(page: Page, ms = 10_000): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
        if ((await markSurfaces(page)) > 0) {
            // Radix moves the focus into a surface one timer after it opens.
            await settleTimers(page);
            return true;
        }
        const settled = await page.evaluate(() => window.__se071?.settled ?? true);
        if (settled) {
            // A surface opened by a settled command is on the page after the next frame.
            await page.evaluate(
                () =>
                    new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
            );
            if ((await markSurfaces(page)) > 0) {
                await settleTimers(page);
                return true;
            }
            return false;
        }
        if (Date.now() > deadline) return false;
        await page.waitForTimeout(50);
    }
}

/** The dialog request kind or app surface open now, or null. */
export function openKind(page: Page): Promise<string | null> {
    return page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { commandDialogs } = (await load(
            "/src/app/dialogs/dialogRequests.ts",
        )) as typeof DialogRequestsModule;
        const { surfaces } = (await load("/src/app/surfaces/surfaces.ts")) as typeof SurfacesModule;
        return commandDialogs.store.getState().request?.kind ?? surfaces.store.getState().open;
    });
}

/** Every dialog kind of the dialog registry and every surface id of the app. */
export function registeredSurfaceKinds(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { registeredDialogs } = (await load(
            "/src/ui/dialogs/registry.ts",
        )) as typeof DialogRegistryModule;
        const { SURFACE_IDS } = (await load(
            "/src/app/surfaces/surfaces.ts",
        )) as typeof SurfacesModule;
        return [...registeredDialogs.keys(), ...SURFACE_IDS].sort();
    });
}

/** Whether the focus is inside `selector`. */
export function focusInside(page: Page, selector: string): Promise<boolean> {
    return page
        .locator(selector)
        .evaluate((element) => element.contains(document.activeElement))
        .catch(() => false);
}

/** Closes the surface on top with Escape, once it holds the focus, and waits until it is gone. */
export async function escapeTop(page: Page): Promise<void> {
    const top = await topSurface(page);
    if (!top) return;
    const surface = page.locator(top.selector);
    await expect
        .poll(() => focusInside(page, top.selector), `${top.name} has the focus`)
        .toBe(true);
    await page.keyboard.press("Escape");
    await expect(surface, `${top.name} closes on Escape`).toBeHidden();
    await settleTimers(page);
}

/** Closes every open surface with Escape. */
export async function closeAll(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 6 && (await markSurfaces(page)) > 0; attempt++) {
        await escapeTop(page);
    }
    expect(await markSurfaces(page), "every surface closed").toBe(0);
}

export type Visit = (visit: SurfaceVisit) => Promise<void>;

async function visitTop(page: Page, source: string, visit: Visit, kinds: Set<string>) {
    const top = await topSurface(page);
    if (!top) throw new Error(`${source}: no surface is open`);
    const kind = await openKind(page);
    if (kind) kinds.add(kind);
    await visit({
        source,
        kind,
        name: top.name,
        selector: top.selector,
        surface: page.locator(top.selector),
    });
}

/**
 * Visits every surface a command or a situation opens, then closes it with Escape (which
 * changes nothing: no field was edited). Starts and ends with `openRichDocument`'s document
 * active; reloads the page at the end for the recovery dialog. Fails when a registered dialog
 * kind or app surface was not visited.
 */
export async function visitAllSurfaces(page: Page, visit: Visit): Promise<string[]> {
    const kinds = new Set<string>();
    const visited: string[] = [];
    const documentId = await openRichDocument(page);
    for (const id of await askingCommands(page)) {
        await runCommand(page, id);
        if (await surfaceOpened(page)) {
            await visitTop(page, id, visit, kinds);
            visited.push(id);
            await closeAll(page);
        }
        expect(await commandFailures(page), id).toEqual([]);
        const active = await page.evaluate(() => window.__ngneTest!.sessions.getState().activeId);
        expect(active, `${id} leaves the document active`).toBe(documentId);
    }

    // The discard question: the dirty document closed.
    await runCommand(page, "file.close");
    expect(await surfaceOpened(page), "discard question").toBe(true);
    await visitTop(page, "file.close (dirty document)", visit, kinds);
    await closeAll(page);

    // The overwrite question: Export into a folder that holds a file of the bundle.
    await putFiles(page, "se071", { "hero.png": [1] });
    await arrangeFolders(page, { nextFolder: ["se071"] });
    await runCommand(page, "file.export");
    expect(await surfaceOpened(page), "Export").toBe(true);
    const exportTop = (await topSurface(page))!;
    await page
        .locator(exportTop.selector)
        .getByRole("button", { name: "Export", exact: true })
        .click();
    await expect.poll(() => openKind(page), "overwrite question").toBe("export-overwrite");
    await settleTimers(page);
    await visitTop(page, "file.export (files in the folder)", visit, kinds);
    await closeAll(page);

    // The drop chooser: an image dropped on the viewport.
    expect(await dropFiles(page, [SOURCE_PNG], { x: 400, y: 300 })).toBe(true);
    expect(await surfaceOpened(page), "drop chooser").toBe(true);
    await visitTop(page, "drop", visit, kinds);
    await closeAll(page);

    // Recovery: a snapshot of a dirty document, offered at the next launch.
    await expect
        .poll(async () => (await autosaveContents(page)).snapshots.length, "a snapshot")
        .toBeGreaterThan(0);
    expect(await reloadEditor(page), "snapshots offered").toBeGreaterThan(0);
    expect(await surfaceOpened(page), "recovery").toBe(true);
    await visitTop(page, "launch with a snapshot", visit, kinds);
    await closeAll(page);

    expect([...kinds].sort(), "every registered dialog and app surface was visited").toEqual(
        await registeredSurfaceKinds(page),
    );
    return visited;
}

/**
 * axe's verdict on the surface under `selector` and on the whole page: no A/AA violation, and
 * every text of the surface judged by the contrast rule. A node the rule could not decide on
 * because a scrolling list cuts it at its visible edge is scrolled into view and judged on its
 * own (as SE-064 did for the command palette); any other undecided node fails.
 */
export async function expectAccessible(page: Page, name: string, selector: string): Promise<void> {
    await expect(page.locator(selector).first(), name).toBeVisible();
    const whole = await audit(page);
    expect(whole.violations, `${name}: whole page`).toEqual([]);
    const own = await audit(page, selector);
    expect(own.violations, name).toEqual([]);
    // Every text was judged; a surface of icons only (visually hidden text aside) has none.
    const hasText = await page
        .locator(selector)
        .first()
        .evaluate((root) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const parent = node.parentElement;
                if (!parent || (node.textContent ?? "").trim() === "") continue;
                const box = parent.getBoundingClientRect();
                if (parent.checkVisibility() && box.width > 1 && box.height > 1) return true;
            }
            return false;
        });
    if (hasText) expect(own.contrastChecked, `${name}: texts judged`).toBeGreaterThan(0);
    for (const undecided of own.contrastUndecided) {
        const cut = await page.locator(undecided).evaluate((element) => {
            const row = element.getBoundingClientRect();
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                const scrolls =
                    (/auto|scroll/.test(style.overflowY) &&
                        parent.scrollHeight > parent.clientHeight) ||
                    (/auto|scroll/.test(style.overflowX) &&
                        parent.scrollWidth > parent.clientWidth);
                if (!scrolls) continue;
                const view = parent.getBoundingClientRect();
                return (
                    row.top < view.top ||
                    row.bottom > view.bottom ||
                    row.left < view.left ||
                    row.right > view.right
                );
            }
            return false;
        });
        expect(cut, `${name}: ${undecided} undecided though not cut by a scrolling list`).toBe(
            true,
        );
        await page
            .locator(undecided)
            .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        const alone = await audit(page, undecided);
        expect(alone.violations, `${name}: ${undecided}`).toEqual([]);
        expect(alone.contrastUndecided, `${name}: ${undecided} in view`).toEqual([]);
    }
}

/**
 * Interactive elements: native controls, ARIA widget roles and anything in the tab order.
 * An element is left out when the pointer cannot reach it and it is not seen: Radix's hidden
 * form inputs (`pointer-events: none`, opacity 0) and visually hidden text (1 px).
 */
const INTERACTIVE = [
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "a[href]",
    '[tabindex]:not([tabindex="-1"])',
    ...[
        "button",
        "checkbox",
        "radio",
        "switch",
        "tab",
        "slider",
        "spinbutton",
        "combobox",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "gridcell",
        "separator",
    ].map((role) => `[role="${role}"]`),
].join(", ");

/**
 * The layout problems of the interactive elements inside `selector` (the whole page by
 * default), as text:
 *
 * - overlap: two visible interactive elements, neither inside the other, whose border boxes
 *   intersect in more than a 1 px hairline — the intersection is more than 1 CSS px wide and
 *   more than 1 CSS px high (neighbours may share a 1 px border). A splitter's 8 px hit area
 *   around its 1 px line (DESIGN §4) may meet another control where one of the two takes
 *   every press in the shared area (hit-tested at its corners and centre): over the viewport
 *   the splitter does, over a button the button does;
 * - clipped: an interactive element that reaches outside the visible box of an ancestor that
 *   clips it (`overflow` other than `visible`) along an axis where that ancestor cannot be
 *   scrolled to show it, or outside the window (0.5 px tolerance for subpixel layout).
 */
export function layoutProblems(page: Page, selector = "body"): Promise<string[]> {
    return page.locator(selector).evaluate((scope, interactive) => {
        const describe = (element: Element) => {
            const name =
                element.getAttribute("aria-label") ??
                element.getAttribute("data-command") ??
                (element.textContent ?? "").trim().slice(0, 30);
            const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
            return `${role} "${name}"`;
        };
        const elements = [...scope.querySelectorAll(interactive)].filter((element) => {
            if (!(element instanceof HTMLElement)) return false;
            if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
                return false;
            }
            const style = getComputedStyle(element);
            if (style.pointerEvents === "none") return false;
            const box = element.getBoundingClientRect();
            return box.width > 1 && box.height > 1;
        });
        const problems: string[] = [];
        const boxes = elements.map((element) => element.getBoundingClientRect());
        for (let i = 0; i < elements.length; i++) {
            for (let j = i + 1; j < elements.length; j++) {
                const a = elements[i]!;
                const b = elements[j]!;
                if (a.contains(b) || b.contains(a)) continue;
                const p = boxes[i]!;
                const q = boxes[j]!;
                const width = Math.min(p.right, q.right) - Math.max(p.left, q.left);
                const height = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
                if (width > 1 && height > 1) {
                    // A splitter's 8 px hit area around its 1 px line (DESIGN §4) may meet a
                    // neighbour when one of the two takes every press in the shared area.
                    if (
                        a.getAttribute("role") === "separator" ||
                        b.getAttribute("role") === "separator"
                    ) {
                        const left = Math.max(p.left, q.left);
                        const top = Math.max(p.top, q.top);
                        const points = [
                            [left + 0.5, top + 0.5],
                            [left + width - 0.5, top + 0.5],
                            [left + 0.5, top + height - 0.5],
                            [left + width - 0.5, top + height - 0.5],
                            [left + width / 2, top + height / 2],
                        ];
                        const owners = new Set(
                            points.map(([x, y]) => {
                                const hit = document.elementFromPoint(x!, y!);
                                return hit && a.contains(hit)
                                    ? "a"
                                    : hit && b.contains(hit)
                                      ? "b"
                                      : "other";
                            }),
                        );
                        if (owners.size === 1 && !owners.has("other")) continue;
                    }
                    problems.push(
                        `overlap: ${describe(a)} and ${describe(b)} share ${width.toFixed(1)} × ${height.toFixed(1)} px`,
                    );
                }
            }
        }
        const slack = 0.5;
        elements.forEach((element, index) => {
            const box = boxes[index]!;
            // Out of a scrolling ancestor's view: scrolling shows it, the window need not.
            let scrolledAway = false;
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                if (style.overflowX === "visible" && style.overflowY === "visible") continue;
                const outer = parent.getBoundingClientRect();
                const left = outer.left + parent.clientLeft;
                const top = outer.top + parent.clientTop;
                const right = left + parent.clientWidth;
                const bottom = top + parent.clientHeight;
                const outX = box.left < left - slack || box.right > right + slack;
                const outY = box.top < top - slack || box.bottom > bottom + slack;
                const scrollsX =
                    /auto|scroll/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth;
                const scrollsY =
                    /auto|scroll/.test(style.overflowY) &&
                    parent.scrollHeight > parent.clientHeight;
                if (
                    (outX && style.overflowX !== "visible" && !scrollsX) ||
                    (outY && style.overflowY !== "visible" && !scrollsY)
                ) {
                    const where =
                        parent.getAttribute("data-region") ??
                        (parent.className || parent.tagName.toLowerCase());
                    problems.push(`clipped: ${describe(element)} by ${where}`);
                    return;
                }
                // The scroller shows it; what clips the scroller is not the element's doing.
                if ((outX && scrollsX) || (outY && scrollsY)) {
                    scrolledAway = true;
                    break;
                }
            }
            if (
                !scrolledAway &&
                (box.left < -slack ||
                    box.top < -slack ||
                    box.right > window.innerWidth + slack ||
                    box.bottom > window.innerHeight + slack)
            ) {
                problems.push(`clipped by the window: ${describe(element)}`);
            }
        });
        return problems;
    }, INTERACTIVE);
}
