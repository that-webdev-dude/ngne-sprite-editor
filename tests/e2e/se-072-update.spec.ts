import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compositeFrame } from "../../src/core/composite";
import { deserialize } from "../../src/core/project";
import { collectErrors, region } from "./se-006-support";
import { dialogButton, nameField, newSpriteButton, newSpriteDialog } from "./se-008-support";
import {
    arrangeFiles,
    documentName,
    fileSystem,
    infoToast,
    stubFileSystemAccess,
    unsavedMarker,
} from "./se-041-support";
import {
    acceptUnload,
    recoveryDialog,
    recoveryEntry,
    recoveryOffered,
    waitForSnapshot,
} from "./se-042-support";
import {
    buildApp,
    deploymentCodeOf,
    deploymentOf,
    filesOf,
    serve,
    waitForWorkerControl,
} from "./se-072-support";

// SE-072: a new deployment. Two production builds that differ as two deployments do (their
// `index.html` and their entry chunk, with its hashed name, carry a marker, se-072-support) are
// served one after the other on the same port. The page of the first has a document with unsaved changes, kept by autosave (SPEC §10,
// SE-042). When the second is there, the app's own check finds it (it asks when the page is
// shown again: the spec sends that `visibilitychange`), the new worker waits, and the update
// toast offers Reload; the page runs the old deployment until then. Reload lets the new worker
// take over and reloads the page from the new deployment's cache; the browser's question
// before unsaved changes are left is answered Leave. The new page offers the snapshot, and
// Recover gives the document back as it was. A second test keeps a second window on the old
// deployment while the first applies the update: it still finds its files.

const UPDATE_TOAST = ".ui-toast:has-text('A new version of the editor is ready.')";

/** The app's caches and whether a worker waits, as the page sees them. */
function workerState(page: Page) {
    return page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return {
            controlled: navigator.serviceWorker.controller !== null,
            waiting: registration?.waiting ?? null,
            caches: (await caches.keys()).length,
        };
    });
}

test("update: a new deployment shows the update toast, activates after Reload, and the autosave snapshot from before is offered for recovery", async ({
    page,
}) => {
    test.setTimeout(240_000);
    // One after the other: a build sets NODE_ENV for its run.
    const first = await buildApp({ deployment: "first" });
    const second = await buildApp({ deployment: "second" });
    let served = await serve(first);
    try {
        const errors = collectErrors(page);
        acceptUnload(page);
        await stubFileSystemAccess(page);
        await page.goto(served.url);
        await expect(region(page, "viewport")).toBeVisible();
        await waitForWorkerControl(page);
        expect(await deploymentOf(page)).toBe("first");
        expect(await deploymentCodeOf(page)).toBe("first");
        expect(await recoveryOffered(page)).toBe(0);

        // A new sprite with one pencil dot: unsaved, so autosave keeps a snapshot of it.
        await newSpriteButton(page).click();
        const dialog = newSpriteDialog(page);
        await expect(nameField(dialog)).toBeFocused();
        await nameField(dialog).fill("before-update");
        await dialogButton(dialog, "Create").click();
        await expect(dialog).toHaveCount(0);
        await expect(documentName(page)).toHaveText("before-update");
        const viewport = page.locator("[data-viewport]");
        await viewport.focus();
        await page.keyboard.press("KeyB");
        await expect(
            region(page, "tool-rail").getByRole("button", { name: "Pencil", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        const box = (await page.locator("[data-viewport-canvas]").boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(unsavedMarker(page)).toBeVisible();
        await waitForSnapshot(page, (snapshot) => snapshot.name === "before-update");

        // The second deployment replaces the first on the server.
        await served.close();
        served = await serve(second, "/", served.port);
        await expect(page.locator(UPDATE_TOAST)).toHaveCount(0);
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        const toast = page.locator(UPDATE_TOAST);
        await expect(toast).toBeVisible();
        // Nothing changes before the user chooses: the old files still run the page, and the
        // new worker waits.
        expect(await deploymentOf(page)).toBe("first");
        expect(await deploymentCodeOf(page)).toBe("first");
        expect(
            await page.evaluate(async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                return registration?.waiting?.state ?? null;
            }),
        ).toBe("installed");

        await toast.getByRole("button", { name: "Reload", exact: true }).click();
        await expect.poll(() => deploymentOf(page).catch(() => null)).toBe("second");
        await expect(region(page, "viewport")).toBeVisible();
        // The new deployment's code runs the page, not only its shell.
        expect(await deploymentCodeOf(page)).toBe("second");
        expect(await recoveryOffered(page)).toBe(1);
        await expect(recoveryDialog(page)).toBeVisible();
        const entry = recoveryEntry(page, "before-update");
        await expect(entry).toBeVisible();
        // The new worker controls the page, nothing waits, and only its cache is left once the
        // single window runs the new deployment.
        await expect
            .poll(() => workerState(page))
            .toEqual({
                controlled: true,
                waiting: null,
                caches: 1,
            });
        await expect(page.locator(UPDATE_TOAST)).toHaveCount(0);

        // The snapshot, read by the new code: the sprite with its one dot.
        const thumbnail = entry.locator("[data-recovery-thumbnail]");
        const snapshot = await thumbnail.evaluate((canvas: HTMLCanvasElement) => ({
            width: canvas.width,
            height: canvas.height,
            data: Array.from(
                canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data,
            ),
        }));
        const opaque = (data: readonly number[]) =>
            data.filter((_, index) => index % 4 === 3 && data[index] !== 0).length;
        expect(opaque(snapshot.data)).toBe(1);

        // Recover: the document comes back under its name, with its dot, unsaved.
        await entry.getByRole("button", { name: "Recover" }).click();
        await expect(recoveryDialog(page)).toBeHidden();
        await expect(documentName(page)).toHaveText("before-update");
        await expect(infoToast(page, "Recovered before-update")).toBeVisible();
        await expect(unsavedMarker(page)).toBeVisible();
        // What it holds, as Save writes it: the name and the dot of the snapshot.
        await page.locator("[data-viewport]").focus();
        await arrangeFiles(page, { nextSave: ["recovered.ngsprite"] });
        await page.keyboard.press("Control+KeyS");
        await expect(infoToast(page, "Saved recovered.ngsprite")).toBeVisible();
        const saved = (await fileSystem(page)).files["recovered.ngsprite"]!;
        const { doc } = await deserialize(Uint8Array.from(saved));
        expect(doc.name).toBe("before-update");
        expect([doc.width, doc.height]).toEqual([snapshot.width, snapshot.height]);
        const composite = Array.from(compositeFrame(doc, doc.frames[0]!.id).data);
        expect(opaque(composite)).toBe(1);
        expect(composite).toEqual(snapshot.data);
        expect(errors).toEqual([]);
    } finally {
        await served.close();
    }
});

test("update: a window still running the old deployment finds its files after another window applied the update", async ({
    context,
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const first = await buildApp({ deployment: "first" });
    const second = await buildApp({ deployment: "second" });
    let served = await serve(first);
    try {
        const errors = collectErrors(page);
        await page.goto(served.url);
        await expect(region(page, "viewport")).toBeVisible();
        await waitForWorkerControl(page);
        // A second window of the app, on the same deployment.
        const other = await context.newPage();
        const otherErrors = collectErrors(other);
        await other.goto(served.url);
        await expect(region(other, "viewport")).toBeVisible();
        await waitForWorkerControl(other);
        expect(await deploymentCodeOf(other)).toBe("first");
        // The old deployment's scripts that the new one does not have (its entry chunk, with
        // the deployment's own content and hash): the window may still ask for them.
        const kept = new Set(filesOf(second));
        const oldFiles = filesOf(first)
            .filter((file) => file.endsWith(".js") && file !== "sw.js" && !kept.has(file))
            .map((file) => ({
                url: new URL(file, served.url).href,
                text: readFileSync(join(first, file), "utf8"),
            }));
        expect(oldFiles.length).toBeGreaterThan(0);

        await served.close();
        served = await serve(second, "/", served.port);
        // The server of the new deployment has none of them (`vite preview` answers its shell).
        for (const { url, text } of oldFiles) {
            const answer = await request.get(url);
            expect(answer.headers()["content-type"], url).not.toContain("javascript");
            expect(await answer.text(), url).not.toBe(text);
        }

        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        const toast = page.locator(UPDATE_TOAST);
        await expect(toast).toBeVisible();
        await toast.getByRole("button", { name: "Reload", exact: true }).click();
        await expect.poll(() => deploymentOf(page).catch(() => null)).toBe("second");
        await expect(region(page, "viewport")).toBeVisible();
        expect(await deploymentCodeOf(page)).toBe("second");

        // The other window still runs the old deployment under the new worker: it is offered
        // Reload, and its files come from the old deployment's cache, which stays meanwhile.
        expect(await deploymentCodeOf(other)).toBe("first");
        await expect(other.locator(UPDATE_TOAST)).toBeVisible();
        for (const { url, text } of oldFiles) {
            const answer = await other.evaluate(async (url) => {
                const response = await fetch(url);
                return {
                    status: response.status,
                    type: response.headers.get("content-type"),
                    text: await response.text(),
                };
            }, url);
            expect(answer.status, url).toBe(200);
            expect(answer.type, url).toContain("javascript");
            // The old deployment's own file, not what the server answers now.
            expect(answer.text === text, url).toBe(true);
        }
        expect(await workerState(other)).toEqual({ controlled: true, waiting: null, caches: 2 });

        // Once no window runs the old deployment, its cache goes (at the next start of a page).
        await other.close();
        await page.reload();
        await expect(region(page, "viewport")).toBeVisible();
        await expect
            .poll(() => workerState(page))
            .toEqual({
                controlled: true,
                waiting: null,
                caches: 1,
            });
        expect(errors).toEqual([]);
        expect(otherErrors).toEqual([]);
    } finally {
        await served.close();
    }
});
