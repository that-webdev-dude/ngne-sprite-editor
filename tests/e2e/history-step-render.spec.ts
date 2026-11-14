import { expect, test } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openDocument, openViewportEditor, paint, pattern, settle } from "./se-011-support";

// A history step that changes nothing the shell shows outside the viewport renders no React
// component before the viewport starts its upload: the panels that follow the open documents
// and the commands (status bar, palette header, command palette trigger) render only when what
// they show changes. React renders a store change in a microtask queued ahead of the upload's,
// so every component that renders there delays the edit on screen.

interface Recorded {
    /** Times of the React commits after the step, in ms from its start. */
    commits: number[];
    /** Time of the first `createImageBitmap` call after the step (the upload's start). */
    upload: number | null;
}

declare global {
    interface Window {
        __renderProbe?: { armed: boolean; start: number; recorded: Recorded };
    }
}

/** Records React commits (through the developer tools hook) and bitmap uploads once armed. */
function installRecorder() {
    const probe = { armed: false, start: 0, recorded: { commits: [], upload: null } as Recorded };
    window.__renderProbe = probe;
    const createBitmap = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
        if (probe.armed && probe.recorded.upload === null) {
            probe.recorded.upload = performance.now() - probe.start;
        }
        return createBitmap(...args);
    }) as typeof createImageBitmap;
    (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers: new Map(),
        inject: () => 1,
        onScheduleFiberRoot() {},
        onCommitFiberRoot() {
            if (probe.armed) probe.recorded.commits.push(performance.now() - probe.start);
        },
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
    };
}

test("an undo that changes nothing outside the viewport renders no component before the viewport's upload starts", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.addInitScript(installRecorder);
    await openViewportEditor(page);
    const document = await openDocument(
        page,
        { width: 5, height: 3 },
        {
            scale: 8,
            originX: 64,
            originY: 40,
        },
    );
    // Two steps, so the undo leaves the document as dirty as it was.
    await paint(page, document.id, pattern(5, 3, 1));
    await paint(page, document.id, pattern(5, 3, 2));
    await settle(page);

    const recorded = await page.evaluate(
        () =>
            new Promise<Recorded>((resolve, reject) => {
                const probe = window.__renderProbe!;
                const undo = window.__ngneTest!.commands.get("edit.undo");
                if (!undo?.enabled()) {
                    reject(new Error("edit.undo is not enabled"));
                    return;
                }
                // At the start of an animation frame, as an input event comes, after the
                // frames of the setup.
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        probe.start = performance.now();
                        probe.armed = true;
                        void undo.run();
                        setTimeout(() => {
                            probe.armed = false;
                            resolve(probe.recorded);
                        }, 100);
                    }),
                );
            }),
    );

    expect(recorded.upload, "the viewport uploads the undone frame").not.toBeNull();
    const before = recorded.commits.filter((at) => at <= recorded.upload!);
    expect(before, "React commits before the upload starts").toEqual([]);
    await settle(page);
    expect(errors).toEqual([]);
});
