import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type * as CompositesModule from "../../src/app/state/composites";
import type * as CompositeModule from "../../src/core/composite";
import { region } from "./se-006-support";
import { openSession } from "./se-007-support";
import { setView, settle } from "./se-011-support";
import { VIEW } from "./se-041-support";

// Shared helpers of the SE-047 specs: the tab strip, what each open document holds, and a
// File System Access stub whose files are real handles of the origin private file system
// (OPFS), so IndexedDB keeps them across a reload as it keeps a file of the disk. The read
// and write permission of those files is the test's to grant or refuse.

/** The state of the file stub, on `window.__se047Fs`. */
export interface FileStub {
    /** The names the next save pickers return, first to last; empty: the picker is cancelled. */
    nextSave: string[];
    /** The names the next open pickers return, first to last; empty: the picker is cancelled. */
    nextOpen: string[];
    /**
     * Permission of the files, as Chrome has it after a reload: "granted"; "prompt", which the
     * user grants when asked; "revoked", which the user refuses when asked. The last two query
     * as "prompt". As in Chrome, a request without the user's gesture throws a SecurityError.
     */
    permission: "granted" | "prompt" | "revoked";
    /** Number of permission prompts shown for a file. */
    permissionRequests: number;
}

/** Where a test leaves the permission the stub starts with after a reload (sessionStorage). */
const PERMISSION_KEY = "se047-permission";

declare global {
    interface Window {
        __se047Fs?: FileStub;
    }
}

/**
 * Replaces `showSaveFilePicker` and `showOpenFilePicker` before the app loads with pickers
 * over OPFS files, and the permission methods of file handles with ones the test controls.
 */
export async function stubProjectFiles(page: Page): Promise<void> {
    await page.addInitScript((key) => {
        const kept = sessionStorage.getItem(key);
        const stub: FileStub = {
            nextSave: [],
            nextOpen: [],
            permission: kept === "prompt" || kept === "revoked" ? kept : "granted",
            permissionRequests: 0,
        };
        window.__se047Fs = stub;
        const cancelled = () => new DOMException("The user aborted a request.", "AbortError");
        Object.assign(window, {
            async showSaveFilePicker() {
                const name = stub.nextSave.shift();
                if (name === undefined) throw cancelled();
                const root = await navigator.storage.getDirectory();
                return root.getFileHandle(name, { create: true });
            },
            async showOpenFilePicker() {
                const name = stub.nextOpen.shift();
                if (name === undefined) throw cancelled();
                const root = await navigator.storage.getDirectory();
                return [await root.getFileHandle(name)];
            },
        });
        type Permissions = {
            kind: string;
            queryPermission?(descriptor: unknown): Promise<PermissionState>;
            requestPermission?(descriptor: unknown): Promise<PermissionState>;
        };
        const prototype = FileSystemHandle.prototype as unknown as Permissions;
        const query = prototype.queryPermission;
        const request = prototype.requestPermission;
        prototype.queryPermission = async function (this: Permissions, descriptor: unknown) {
            if (this.kind === "file") return stub.permission === "granted" ? "granted" : "prompt";
            return query ? query.call(this, descriptor) : "granted";
        };
        prototype.requestPermission = async function (this: Permissions, descriptor: unknown) {
            if (this.kind !== "file") return request ? request.call(this, descriptor) : "granted";
            if (stub.permission === "granted") return "granted";
            if (!navigator.userActivation.isActive) {
                throw new DOMException("User activation is required.", "SecurityError");
            }
            stub.permissionRequests++;
            if (stub.permission === "prompt") stub.permission = "granted";
            return stub.permission === "granted" ? "granted" : "denied";
        };
    }, PERMISSION_KEY);
}

/** Makes the file stub start with `permission` after the next reload of the page. */
export function permissionAfterReload(page: Page, permission: FileStub["permission"]) {
    return page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [
        PERMISSION_KEY,
        permission,
    ] as const);
}

export function fileStub(page: Page): Promise<FileStub> {
    return page.evaluate(() => structuredClone(window.__se047Fs!));
}

/** Sets what the next pickers return. */
export function arrangePickers(
    page: Page,
    arrangement: { nextSave?: string[]; nextOpen?: string[] },
): Promise<void> {
    return page.evaluate((arrangement) => {
        const stub = window.__se047Fs!;
        stub.nextSave.push(...(arrangement.nextSave ?? []));
        stub.nextOpen.push(...(arrangement.nextOpen ?? []));
    }, arrangement);
}

// --- The tab strip --------------------------------------------------------------------------

export const tabList = (page: Page): Locator =>
    region(page, "menu-bar").getByRole("tablist", { name: "Documents" });

export const tabs = (page: Page): Locator => tabList(page).getByRole("tab");

/** The tab of the open document `id`. */
export const tabOf = (page: Page, id: string): Locator =>
    tabList(page).locator(`[data-document-tab="${id}"]`);

export const overflowButton = (page: Page): Locator =>
    region(page, "menu-bar").getByRole("button", { name: "All documents" });

/** The ids of the open documents, in the order of the session store. */
export function documentIds(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        window.__ngneTest!.sessions.getState().documents.map((entry) => entry.id),
    );
}

export function activeId(page: Page): Promise<string | null> {
    return page.evaluate(() => window.__ngneTest!.sessions.getState().activeId);
}

/** Opens a document "name" of 16 × 12 at the view of the SE-041 strokes; returns its id. */
export async function openTab(page: Page, name: string): Promise<string> {
    const id = await openSession(page, { name, width: 16, height: 12 });
    await setView(page, id, VIEW);
    await settle(page);
    return id;
}

/** The composite of every frame of the open document `id` (`compositeFrame`). */
export function compositesOf(page: Page, id: string): Promise<number[][]> {
    return page.evaluate(async (id) => {
        const path = "/src/core/composite/index.ts";
        const { compositeFrame } = (await import(
            /* @vite-ignore */ path
        )) as typeof CompositeModule;
        const document = window
            .__ngneTest!.sessions.getState()
            .documents.find((entry) => entry.id === id);
        if (!document) throw new Error(`se-047: no open document ${id}`);
        const { doc } = document.session;
        return doc.frames.map((frame) => Array.from(compositeFrame(doc, frame.id).data));
    }, id);
}

/** The bytes each open document's composite cache holds, by document id (SPEC §5.3). */
export function cacheBytes(page: Page): Promise<Record<string, number>> {
    return page.evaluate(async () => {
        const path = "/src/app/state/composites.ts";
        const { activeComposites } = (await import(
            /* @vite-ignore */ path
        )) as typeof CompositesModule;
        const entries = window
            .__ngneTest!.sessions.getState()
            .documents.map((entry) => [entry.id, activeComposites.bytesOf(entry.session)]);
        return Object.fromEntries(entries) as Record<string, number>;
    });
}

/** Whether `inner` lies wholly inside `outer`, to the pixel. */
export async function liesWithin(inner: Locator, outer: Locator): Promise<boolean> {
    const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
    if (!a || !b) return false;
    return (
        a.x >= b.x - 0.5 &&
        a.y >= b.y - 0.5 &&
        a.x + a.width <= b.x + b.width + 0.5 &&
        a.y + a.height <= b.y + b.height + 0.5
    );
}

/** Waits until the window's size has been read twice the same, after a resize. */
export async function settleSize(page: Page): Promise<void> {
    let previous = "";
    await expect
        .poll(async () => {
            const size = await page.evaluate(() =>
                JSON.stringify([window.innerWidth, window.innerHeight]),
            );
            const same = size === previous;
            previous = size;
            return same;
        })
        .toBe(true);
}
