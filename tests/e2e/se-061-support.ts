import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import {
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { propertiesPopover, runCommands } from "./se-022-support";

// Shared helpers of the SE-061 specs: the two popovers, the blend mode of a layer, and the
// images a blend of two opaque images must give, computed here from the published formulas
// (Aseprite's `blend_funcs.cpp`; SE-061), not by the editor.

export const VIEW = { scale: 8, originX: 64, originY: 40 };
export const WIDTH = 5;
export const HEIGHT = 3;

/**
 * A 5 × 3 document with two layers, each with an opaque pattern of its own at the first frame:
 * the viewport shows the upper one, "Layer 2", the active layer.
 */
export async function openTwoLayers(page: Page): Promise<{
    document: TestDocument;
    lower: number[];
    upper: number[];
}> {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const lower = pattern(WIDTH, HEIGHT, 1);
    const upper = pattern(WIDTH, HEIGHT, 7);
    await paint(page, document.id, lower);
    await runCommands(page, ["layer.new"]);
    await paint(page, document.id, upper);
    await settle(page);
    await expectImage(page, document, VIEW, upper);
    return { document, lower, upper };
}

/** The layer properties popover, which holds the blend mode (SE-061). */
export const blendPopover = propertiesPopover;
/** The cel properties popover (DESIGN §7). */
export const celPopover = (page: Page) => page.getByRole("dialog", { name: "Cel properties" });

/** Waits until the focus is inside a Radix surface that just opened. */
export async function focusInside(surface: Locator): Promise<void> {
    await expect
        .poll(() => surface.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
}

/** The blend mode of the active document's layer at `index` from the bottom. */
export function layerBlend(page: Page, index: number): Promise<string | null> {
    return page.evaluate((index) => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const layer = document.session.doc.layers[index];
        return layer?.kind === "pixel" ? layer.blend : null;
    }, index);
}

/** `a * b / 255` rounded, pixman's `MUL_UN8`. */
const mul = (a: number, b: number) => {
    const t = a * b + 128;
    return ((t >> 8) + t) >> 8;
};

/** Each colour channel of two opaque RGBA images mixed by `mix`; alpha stays 255. */
function mixed(
    lower: readonly number[],
    upper: readonly number[],
    mix: (b: number, s: number) => number,
): number[] {
    return lower.map((value, at) => (at % 4 === 3 ? 255 : mix(value, upper[at] ?? 0)));
}

/** Difference of an opaque image over an opaque one: |b - s|. */
export function differenceOf(lower: readonly number[], upper: readonly number[]): number[] {
    return mixed(lower, upper, (b, s) => Math.abs(b - s));
}

/** Multiply of an opaque image over an opaque one: mul(b, s). */
export function multiplyOf(lower: readonly number[], upper: readonly number[]): number[] {
    return mixed(lower, upper, mul);
}

/** Exclusion of an opaque image over an opaque one: b + s - 2 mul(b, s). */
export function exclusionOf(lower: readonly number[], upper: readonly number[]): number[] {
    return mixed(lower, upper, (b, s) => b + s - 2 * mul(b, s));
}

/**
 * The normal blend of an opaque image at opacity `alpha` over an opaque one: Ra = 255 and
 * Rc = Bc + trunc((Sc - Bc) * a / 255) (`rgba_blender_normal`).
 */
export function normalOver(
    lower: readonly number[],
    upper: readonly number[],
    alpha: number,
): number[] {
    return mixed(lower, upper, (b, s) => b + Math.trunc(((s - b) * alpha) / 255));
}
