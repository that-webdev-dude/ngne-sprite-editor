import type { Page } from "@playwright/test";
// Declares the ants' probe on `window.__ngneTest`; the page imports the selection module from
// the dev server, and here it is needed for its types.
import type {} from "../../src/app/selection/selectionAnts.overlay";
import type * as CoreSelection from "../../src/core/selection";
import type { Rect } from "./se-011-support";

// Shared helpers of the SE-030 specs: a selection set through the document's history, the
// selection as the session holds it, and the masks drawn as text ("#" selected, "." not).

/** A selection as the page holds it: the mask's bytes and the bounds; null for none. */
export interface SelectionState {
    width: number;
    height: number;
    bytes: number[];
    bounds: Rect;
}

/** The selection of a document now. */
export function selectionState(page: Page, id: string): Promise<SelectionState | null> {
    return page.evaluate((id) => {
        const document = window
            .__ngneTest!.sessions.getState()
            .documents.find((entry) => entry.id === id);
        if (!document) throw new Error(`se-030: no document ${id}`);
        const { selection } = document.session;
        if (!selection) return null;
        return {
            width: selection.mask.width,
            height: selection.mask.height,
            bytes: Array.from(selection.mask.data),
            bounds: { ...selection.bounds },
        };
    }, id);
}

/** The bytes of the mask `rows` draws, in the layout of `BitMask`. */
export function maskBytes(rows: readonly string[]): number[] {
    const width = rows[0]?.length ?? 0;
    const bytes = new Array<number>(Math.ceil((width * rows.length) / 8)).fill(0);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) {
            if (row[x] === "#") bytes[(y * width + x) >> 3]! |= 1 << ((y * width + x) & 7);
        }
    });
    return bytes;
}

/**
 * Makes the mask `rows` draws the selection of a document, as a selection tool will: one
 * command of its history (replace).
 */
export function setSelection(page: Page, id: string, rows: readonly string[]): Promise<void> {
    return page.evaluate(
        async ({ id, rows }) => {
            const path = "/src/core/selection/index.ts";
            const selection = (await import(/* @vite-ignore */ path)) as typeof CoreSelection;
            const document = window
                .__ngneTest!.sessions.getState()
                .documents.find((entry) => entry.id === id);
            if (!document) throw new Error(`se-030: no document ${id}`);
            const { session, history } = document;
            const mask = selection.createMask(session.doc.width, session.doc.height);
            rows.forEach((row, y) => {
                for (let x = 0; x < row.length; x++) {
                    if (row[x] === "#") selection.setMaskPixel(mask, x, y);
                }
            });
            const command = selection.selectCommand(session, mask, "replace", "Select");
            if (command) history.execute(command);
        },
        { id, rows: [...rows] },
    );
}

/** The ants' probe now. */
export function antsState(
    page: Page,
): Promise<{ phase: number; steps: number; animating: boolean }> {
    return page.evaluate(() => {
        const probe = window.__ngneTest?.selectionAnts;
        if (!probe) throw new Error("se-030: no ants on the page");
        return { phase: probe.phase, steps: probe.steps, animating: probe.animating };
    });
}

/**
 * Whether canvas pixel `x, y` is a black dash at `phase` (DESIGN §6: 2 px black, 2 px white
 * by the sum of the coordinates), worked out here and not by the module under test.
 */
export function darkAt(x: number, y: number, phase: number): boolean {
    return (((x + y - phase) % 4) + 4) % 4 < 2;
}
