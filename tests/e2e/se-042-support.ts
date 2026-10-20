import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CoreModel from "../../src/core/model";
import { region } from "./se-006-support";
import { settle } from "./se-011-support";
import { VIEW } from "./se-041-support";

// Shared helpers of the SE-042 specs: what the autosave database of the page holds (read with
// IndexedDB from the page), a spy on the image records it writes, the recovery dialog, and a
// reload that leaves the page whatever the unload guard asks.

const DATABASE = "ngne-sprite-editor-autosave";

/** What a spec reads of one snapshot record. */
export interface SnapshotSummary {
    key: string;
    name: string;
    savedAt: number;
    owner: string;
    imageIds: string[];
    sourceIds: string[];
}

/** The autosave database's contents: its snapshot records and its record counts. */
export interface AutosaveContents {
    snapshots: SnapshotSummary[];
    images: number;
    sources: number;
}

declare global {
    interface Window {
        /** The image ids put into the autosave database, in order (`spyOnImageWrites`). */
        __se042ImagePuts?: string[];
    }
}

/** Reads the autosave database without creating it. */
export function autosaveContents(page: Page): Promise<AutosaveContents> {
    return page.evaluate(async (name) => {
        const empty = { snapshots: [], images: 0, sources: 0 };
        const known = await indexedDB.databases();
        if (!known.some((database) => database.name === name)) return empty;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const opening = indexedDB.open(name);
            opening.onsuccess = () => resolve(opening.result);
            opening.onerror = () => reject(opening.error);
        });
        try {
            if (!db.objectStoreNames.contains("snapshots")) return empty;
            const transaction = db.transaction(["snapshots", "images", "sources"], "readonly");
            const ask = <T>(request: IDBRequest<T>) =>
                new Promise<T>((resolve, reject) => {
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            const [records, images, sources] = await Promise.all([
                ask(transaction.objectStore("snapshots").getAll()),
                ask(transaction.objectStore("images").count()),
                ask(transaction.objectStore("sources").count()),
            ]);
            const snapshots = (records as SnapshotSummary[]).map(
                ({ key, name, savedAt, owner, imageIds, sourceIds }) => ({
                    key,
                    name,
                    savedAt,
                    owner,
                    imageIds: [...imageIds],
                    sourceIds: [...sourceIds],
                }),
            );
            return { snapshots, images, sources };
        } finally {
            db.close();
        }
    }, DATABASE);
}

/** Waits until the database holds one snapshot that `accept` accepts; returns it. */
export async function waitForSnapshot(
    page: Page,
    accept: (snapshot: SnapshotSummary) => boolean = () => true,
): Promise<SnapshotSummary> {
    let found: SnapshotSummary | undefined;
    await expect
        .poll(async () => {
            const { snapshots } = await autosaveContents(page);
            found = snapshots.length === 1 && accept(snapshots[0]!) ? snapshots[0] : undefined;
            return found !== undefined;
        })
        .toBe(true);
    return found!;
}

/** Waits until the database holds no record at all. */
export async function expectNoSnapshot(page: Page): Promise<void> {
    await expect
        .poll(() => autosaveContents(page))
        .toEqual({ snapshots: [], images: 0, sources: 0 });
}

/** Records, before the app loads, the id of every image record put into the autosave database. */
export async function spyOnImageWrites(page: Page): Promise<void> {
    await page.addInitScript((name) => {
        window.__se042ImagePuts = [];
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (this: IDBObjectStore, value, key) {
            if (this.name === "images" && this.transaction.db.name === name) {
                window.__se042ImagePuts!.push(String((key as unknown[])[1]));
            }
            return put.call(this, value, key);
        };
    }, DATABASE);
}

export function imagePuts(page: Page): Promise<string[]> {
    return page.evaluate(() => [...window.__se042ImagePuts!]);
}

export function clearImagePuts(page: Page): Promise<void> {
    return page.evaluate(() => {
        window.__se042ImagePuts!.length = 0;
    });
}

/**
 * Waits until the launch check of the page is done; returns how many snapshots it offered
 * (the detail of its User Timing mark).
 */
export async function recoveryOffered(page: Page): Promise<number> {
    await page.waitForFunction(
        () => performance.getEntriesByName("ngne-autosave:recovery-checked").length > 0,
    );
    return page.evaluate(() => {
        const [mark] = performance.getEntriesByName(
            "ngne-autosave:recovery-checked",
        ) as PerformanceMark[];
        return (mark!.detail as { offered: number }).offered;
    });
}

/** Leaves the page whatever the unload guard asks (`beforeunload`), from now on. */
export function acceptUnload(page: Page): void {
    page.on("dialog", (dialog) => {
        if (dialog.type() === "beforeunload") void dialog.accept();
    });
}

/** Reloads the editor and waits for its launch check; returns how many snapshots it offered. */
export async function reloadEditor(page: Page): Promise<number> {
    await page.reload();
    await expect(region(page, "viewport")).toBeVisible();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    return recoveryOffered(page);
}

export const recoveryDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Recover unsaved work?" });

export const recoveryEntry = (page: Page, name: string): Locator =>
    recoveryDialog(page).locator(`[data-recovery-entry="${name}"]`);

/** Waits until the dialog has taken the focus (Radix moves it in after it opens). */
export async function dialogFocused(dialog: Locator): Promise<void> {
    await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
}

/**
 * Opens a `side` × `side` document "big" of `frames` frames at the specs' view, each frame with
 * a cel of noise on its one layer; returns its id and the image id of each frame's cel.
 */
export async function openFramesDocument(
    page: Page,
    side: number,
    frames: number,
): Promise<{ id: string; imageIds: string[] }> {
    const opened = await page.evaluate(
        async ({ side, frames, view }) => {
            const path = "/src/core/model/index.ts";
            const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
            const session = core.createDocument({ name: "big", width: side, height: side });
            const { doc } = session;
            const layerId = doc.layers[0]!.id;
            doc.frames = Array.from({ length: frames }, (_, index) => ({
                id: `big-frame-${index}`,
                durationMs: 100,
            }));
            doc.cels.clear();
            doc.images.clear();
            let seed = 42;
            const imageIds: string[] = [];
            for (const frame of doc.frames) {
                const data = new Uint8ClampedArray(side * side * 4);
                for (let at = 0; at < data.length; at += 4) {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    data[at] = seed >>> 24;
                    data[at + 1] = (seed >>> 16) & 255;
                    data[at + 2] = (seed >>> 8) & 255;
                    data[at + 3] = 255;
                }
                const imageId = `big-image-${frame.id}`;
                imageIds.push(imageId);
                doc.images.set(imageId, { width: side, height: side, data });
                doc.cels.set(core.celKey(layerId, frame.id), { imageId, opacity: 255 });
            }
            session.activeLayerId = layerId;
            session.activeFrameId = doc.frames[0]!.id;
            const document = window.__ngneTest!.sessions.getState().open(session, { view });
            window.__ngneTest!.assertInvariants();
            return { id: document.id, imageIds };
        },
        { side, frames, view: VIEW },
    );
    await settle(page);
    return opened;
}
