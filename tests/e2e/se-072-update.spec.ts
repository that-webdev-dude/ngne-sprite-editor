import { expect, test } from "@playwright/test";
import { collectErrors, region } from "./se-006-support";
import { dialogButton, nameField, newSpriteButton, newSpriteDialog } from "./se-008-support";
import { documentName, unsavedMarker } from "./se-041-support";
import {
    acceptUnload,
    recoveryDialog,
    recoveryEntry,
    recoveryOffered,
    waitForSnapshot,
} from "./se-042-support";
import { buildApp, deploymentOf, serve, waitForWorkerControl } from "./se-072-support";

// SE-072: a new deployment. Two production builds that differ as two deployments do (their
// `index.html` carries a marker, se-072-support) are served one after the other on the same
// port. The page of the first has a document with unsaved changes, kept by autosave (SPEC §10,
// SE-042). When the second is there, the app's own check finds it (it asks when the page is
// shown again: the spec sends that `visibilitychange`), the new worker waits, and the update
// toast offers Reload; the page runs the old deployment until then. Reload lets the new worker
// take over and reloads the page from the new deployment's cache; the browser's question
// before unsaved changes are left is answered Leave. The new page offers the snapshot.

const UPDATE_TOAST = ".ui-toast:has-text('A new version of the editor is ready.')";

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
        await page.goto(served.url);
        await expect(region(page, "viewport")).toBeVisible();
        await waitForWorkerControl(page);
        expect(await deploymentOf(page)).toBe("first");
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
        expect(
            await page.evaluate(async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                return registration?.waiting?.state ?? null;
            }),
        ).toBe("installed");

        await toast.getByRole("button", { name: "Reload", exact: true }).click();
        await expect.poll(() => deploymentOf(page).catch(() => null)).toBe("second");
        await expect(region(page, "viewport")).toBeVisible();
        expect(await recoveryOffered(page)).toBe(1);
        await expect(recoveryDialog(page)).toBeVisible();
        await expect(recoveryEntry(page, "before-update")).toBeVisible();
        // The new worker controls the page, nothing waits, and only its cache is left.
        expect(
            await page.evaluate(async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                return {
                    controlled: navigator.serviceWorker.controller !== null,
                    waiting: registration?.waiting ?? null,
                    caches: (await caches.keys()).length,
                };
            }),
        ).toEqual({ controlled: true, waiting: null, caches: 1 });
        await expect(page.locator(UPDATE_TOAST)).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally {
        await served.close();
    }
});
