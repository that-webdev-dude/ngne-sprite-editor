import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openViewportEditor, settle } from "./se-011-support";
import { activeView, fittedView, geometry, twoFrames } from "./se-012-support";

// gh-003: a document opened while the app starts is fitted to the viewport it is shown in.
//
// The tool rail decides between one and two columns from its height (DESIGN §5.1). It used to
// lay out in one column first and switch in a later task, after the viewport region had been
// measured with the narrower rail: a document opened in between was fitted to a viewport
// 28 CSS px wider than the one it is shown in, and a view once fitted is never fitted again
// (SPEC §6.4). The rail now runs the full height beside the timeline (the canon layout of
// @ngne/editor-ui) and has one column at 1280×720; the tests check the same single size.
//
// The page opens the document itself, at the two moments of that gap, from an init script: a
// test cannot get a call in between from outside, the gap is a frame or two long.

const WIDTH = 64;
const HEIGHT = 48;

type Moment = "shell" | "first-size";

declare global {
    interface Window {
        __startupFit?: {
            /** Every size the viewport region reported, in device pixels, with the rail's columns. */
            reports: { width: number; height: number; columns: string }[];
        };
    }
}

/**
 * Runs in the page before its scripts. Records every size of the viewport region from the
 * moment the shell is on the page, as the app measures it (the probe, SE-012), and opens a
 * document at `open`: as soon as the shell is in the document, or in the task of the region's
 * first size report.
 */
function watchStartup({
    open,
    width,
    height,
}: {
    open: Moment | null;
    width: number;
    height: number;
}) {
    const state: NonNullable<Window["__startupFit"]> = { reports: [] };
    window.__startupFit = state;
    const columns = () =>
        document.querySelector<HTMLElement>('[data-region="tool-rail"]')?.dataset.columns ?? "";
    const openDocument = () => window.__ngneTest!.openSession({ name: "startup", width, height });
    const shell = new MutationObserver(() => {
        const probe = document.querySelector(".viewport-probe");
        if (!probe) return;
        shell.disconnect();
        if (open === "shell") openDocument();
        const sizes = new ResizeObserver((entries) => {
            const box = entries.at(-1)?.devicePixelContentBoxSize[0];
            if (!box) return;
            state.reports.push({
                width: box.inlineSize,
                height: box.blockSize,
                columns: columns(),
            });
            if (open === "first-size" && state.reports.length === 1) openDocument();
        });
        sizes.observe(probe, { box: "device-pixel-content-box" });
    });
    shell.observe(document, { childList: true, subtree: true });
}

function reports(page: Page) {
    return page.evaluate(() => window.__startupFit!.reports);
}

/** One startup test: its title and its body, which takes Playwright's `page` fixture. */
export interface StartupFitCase {
    title: string;
    run: (fixtures: { page: Page }) => Promise<void>;
}

/** A document opened at `moment` starts fitted to the viewport it is shown in. */
function openedAt(moment: Moment): StartupFitCase {
    const when =
        moment === "shell"
            ? "as soon as the shell is on the page"
            : "in the task of the viewport's first size";
    return {
        title: `a document opened ${when} starts fitted and centred in the viewport it is shown in`,
        run: async ({ page }) => {
            const errors = collectErrors(page);
            await page.addInitScript(watchStartup, { open: moment, width: WIDTH, height: HEIGHT });
            await openViewportEditor(page);
            await page.waitForFunction(
                () => window.__ngneTest!.sessions.getState().documents.length === 1,
            );
            await settle(page);
            const layout = await geometry(page);
            expect(await activeView(page)).toEqual(
                fittedView({ width: WIDTH, height: HEIGHT }, layout.device),
            );
            // The size the document was fitted to is the one it is shown in.
            const seen = await reports(page);
            expect(seen.at(-1)).toEqual({ ...layout.device, columns: "1" });
            expect(errors).toEqual([]);
        },
    };
}

/**
 * The startup tests. The calling spec file has set Chrome up for its ratio and declares each
 * case with `test(title, run)`.
 */
export const STARTUP_FIT_CASES: readonly StartupFitCase[] = [
    {
        title: "the viewport region has one size from the shell's first layout on, with the rail's final columns",
        run: async ({ page }) => {
            const errors = collectErrors(page);
            await page.addInitScript(watchStartup, { open: null, width: WIDTH, height: HEIGHT });
            await openViewportEditor(page);
            await twoFrames(page);
            await twoFrames(page);
            const rail = page.locator('[data-region="tool-rail"]');
            const columns = await rail.getAttribute("data-columns");
            expect(columns).toBe("1");
            const seen = await reports(page);
            expect(seen).toHaveLength(1);
            expect(seen[0]!.columns).toBe(columns);
            expect(errors).toEqual([]);
        },
    },
    openedAt("shell"),
    openedAt("first-size"),
];
