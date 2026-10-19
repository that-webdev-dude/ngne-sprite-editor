import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type * as ExportModule from "../../src/core/export";
import type * as DocumentsModule from "./se-053-documents";
import type { FileBytes, FixtureId } from "./se-053-documents";
import { fromBase64 } from "./se-053-documents";

// Shared helpers of the SE-052 specs. File System Access for folders is a directory picker
// over the origin private file system (OPFS): real directory handles in the browser's own
// storage, which IndexedDB can keep, as it keeps a folder of the disk. The write permission
// of those folders is the test's to grant or revoke. Bytes expected of an export come from
// the page (`bundle()` run there, SE-053 review: Playwright cannot import `core/export`).

/** The state of the folder stub, on `window.__se052Fs`. */
export interface FolderStub {
    /** The folders the next directory pickers return, first to last; empty: cancelled. */
    nextFolder: string[];
    /** Number of directory pickers shown. */
    folderPickers: number;
    /** "granted": folders may be written; "revoked": queried "prompt", requests refused. */
    permission: "granted" | "revoked";
    /** Number of permission requests (prompts) for a folder. */
    permissionRequests: number;
}

declare global {
    interface Window {
        __se052Fs?: FolderStub;
    }
}

/**
 * Replaces `showDirectoryPicker` before the app loads with a picker over OPFS folders, and the
 * permission methods of directory handles with ones the test controls.
 */
export async function stubExportFolders(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const stub: FolderStub = {
            nextFolder: [],
            folderPickers: 0,
            permission: "granted",
            permissionRequests: 0,
        };
        window.__se052Fs = stub;
        Object.assign(window, {
            async showDirectoryPicker() {
                stub.folderPickers++;
                const name = stub.nextFolder.shift();
                if (name === undefined) {
                    throw new DOMException("The user aborted a request.", "AbortError");
                }
                const root = await navigator.storage.getDirectory();
                return root.getDirectoryHandle(name, { create: true });
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
            if (this.kind === "directory") {
                return stub.permission === "granted" ? "granted" : "prompt";
            }
            return query ? query.call(this, descriptor) : "granted";
        };
        prototype.requestPermission = async function (this: Permissions, descriptor: unknown) {
            if (this.kind === "directory") {
                stub.permissionRequests++;
                return stub.permission === "granted" ? "granted" : "denied";
            }
            return request ? request.call(this, descriptor) : "granted";
        };
    });
}

/** Takes the directory and save pickers away before the app loads: exports download. */
export async function removeExportPickers(page: Page): Promise<void> {
    await page.addInitScript(() => {
        for (const owner of [window, Window.prototype] as unknown as Record<string, unknown>[]) {
            delete owner.showDirectoryPicker;
            delete owner.showSaveFilePicker;
            delete owner.showOpenFilePicker;
        }
    });
}

export function folderStub(page: Page): Promise<FolderStub> {
    return page.evaluate(() => structuredClone(window.__se052Fs!));
}

/** Sets what the next directory pickers return and whether folders may be written. */
export function arrangeFolders(
    page: Page,
    arrangement: { nextFolder?: string[]; permission?: FolderStub["permission"] },
): Promise<void> {
    return page.evaluate((arrangement) => {
        const stub = window.__se052Fs!;
        stub.nextFolder.push(...(arrangement.nextFolder ?? []));
        if (arrangement.permission) stub.permission = arrangement.permission;
    }, arrangement);
}

/**
 * The files of an OPFS folder, by name; empty when there is no such folder. A file replaced
 * while it is read cannot be read (Chrome: `NotReadableError`, or `NotFoundError` for the swap
 * file of a write under way); the folder is then read again, until one reading sees no write.
 */
export async function folderFiles(page: Page, folder: string): Promise<Map<string, Uint8Array>> {
    const files = await page.evaluate(async (name) => {
        type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };
        const root = await navigator.storage.getDirectory();
        let directory: FileSystemDirectoryHandle;
        try {
            directory = await root.getDirectoryHandle(name);
        } catch {
            return [];
        }
        const read = async () => {
            const found: { name: string; data: string }[] = [];
            for await (const [entry, handle] of (directory as unknown as Entries).entries()) {
                if (handle.kind !== "file") continue;
                // Chrome writes through a swap file beside the file, there during a write.
                if (entry.endsWith(".crswap")) return null;
                let bytes: Uint8Array;
                try {
                    const file = await (handle as FileSystemFileHandle).getFile();
                    bytes = new Uint8Array(await file.arrayBuffer());
                } catch {
                    return null;
                }
                let binary = "";
                for (let index = 0; index < bytes.length; index++) {
                    binary += String.fromCharCode(bytes[index]!);
                }
                found.push({ name: entry, data: btoa(binary) });
            }
            return found;
        };
        for (let attempt = 0; attempt < 100; attempt++) {
            const found = await read();
            if (found) return found;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`se-052: the folder "${name}" was being written for 2 s`);
    }, folder);
    return new Map(files.map(({ name, data }) => [name, fromBase64(data)]));
}

/** Writes files into an OPFS folder, as another program (or another document) did. */
export function putFiles(page: Page, folder: string, files: Record<string, number[]>) {
    return page.evaluate(
        async ({ folder, files }) => {
            const root = await navigator.storage.getDirectory();
            const directory = await root.getDirectoryHandle(folder, { create: true });
            for (const [name, bytes] of Object.entries(files)) {
                const handle = await directory.getFileHandle(name, { create: true });
                const writable = await handle.createWritable();
                await writable.write(Uint8Array.from(bytes));
                await writable.close();
            }
        },
        { folder, files },
    );
}

/** Removes a file from an OPFS folder. */
export function removeFile(page: Page, folder: string, name: string): Promise<void> {
    return page.evaluate(
        async ({ folder, name }) => {
            const root = await navigator.storage.getDirectory();
            await (await root.getDirectoryHandle(folder)).removeEntry(name);
        },
        { folder, name },
    );
}

/** The bundle `bundle()` makes in the page of the active document now, in file order. */
export async function expectedBundle(page: Page): Promise<FileBytes[]> {
    const files = await page.evaluate(async () => {
        const path = "/src/core/export/index.ts";
        const { bundle } = (await import(/* @vite-ignore */ path)) as typeof ExportModule;
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("se-052: no active document");
        return bundle(document.session.doc).files.map((file) => {
            let binary = "";
            for (let index = 0; index < file.bytes.length; index++) {
                binary += String.fromCharCode(file.bytes[index]!);
            }
            return { name: file.name, data: btoa(binary) };
        });
    });
    return files.map(({ name, data }) => ({ name, bytes: fromBase64(data) }));
}

/** The files as a map by name. */
export function byName(files: readonly FileBytes[]): Map<string, Uint8Array> {
    return new Map(files.map((file) => [file.name, file.bytes]));
}

/** `actual` holds exactly the files of `expected`, byte for byte. */
export function expectSameFiles(
    actual: ReadonlyMap<string, Uint8Array>,
    expected: ReadonlyMap<string, Uint8Array>,
): void {
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [name, bytes] of expected) {
        expect(Buffer.from(actual.get(name) ?? []).equals(Buffer.from(bytes)), name).toBe(true);
    }
}

/** Whether two sets of files are equal: the same names, each with the same bytes. */
function sameFiles(
    actual: ReadonlyMap<string, Uint8Array>,
    expected: ReadonlyMap<string, Uint8Array>,
): boolean {
    if (actual.size !== expected.size) return false;
    for (const [name, bytes] of expected) {
        const found = actual.get(name);
        if (!found || !Buffer.from(found).equals(Buffer.from(bytes))) return false;
    }
    return true;
}

/**
 * Waits until an OPFS folder holds exactly `expected`: an export writes its files one after
 * the other, after the command that started it has returned.
 */
export async function expectFolderToHold(
    page: Page,
    folder: string,
    expected: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
    await expect.poll(async () => sameFiles(await folderFiles(page, folder), expected)).toBe(true);
    expectSameFiles(await folderFiles(page, folder), expected);
}

/** Opens a fixture document of SE-053 in the editor as the active session; returns its id. */
export function openFixture(page: Page, fixture: FixtureId): Promise<string> {
    return page.evaluate(async (id) => {
        const path = "/tests/e2e/se-053-documents.ts";
        const { FIXTURES } = (await import(/* @vite-ignore */ path)) as typeof DocumentsModule;
        const doc = FIXTURES[id].build();
        const layer = [...doc.layers].reverse().find((entry) => entry.kind === "pixel");
        if (!layer) throw new Error("se-052: the fixture has no pixel layer");
        const session = {
            doc,
            selection: null,
            activeLayerId: layer.id,
            activeFrameId: doc.frames[0]!.id,
        };
        return window.__ngneTest!.sessions.getState().open(session).id;
    }, fixture);
}

export const exportDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Export" });
export const overwriteDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Replace files?" });
export const framePngDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Export frame PNG" });

/** Opens the Export dialog with Ctrl+E and waits until it holds the focus. */
export async function openExportDialog(page: Page): Promise<Locator> {
    await page.keyboard.press("Control+KeyE");
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    return dialog;
}

/** The listed files of the Export dialog: "name size" per line. */
export function listedFiles(dialog: Locator): Promise<string[]> {
    return dialog
        .locator("[data-export-files] li")
        .evaluateAll((items) =>
            items.map((item) =>
                Array.from(item.children, (child) => child.textContent ?? "").join(" "),
            ),
        );
}

/** Chooses an option of a select of the dialog: opens the list, waits for it, clicks. */
export async function choose(page: Page, scope: Locator, name: string, option: string) {
    await scope.getByRole("combobox", { name, exact: true }).click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await list.getByRole("option", { name: option, exact: true }).click();
    await expect(list).toBeHidden();
}

/** The active document's export settings as the page holds them. */
export function exportSettings(page: Page) {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        return structuredClone(document?.session.doc.exportSettings ?? null);
    });
}

/** Changes the active document's export settings through the store's setter. */
export function setExportSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
    return page.evaluate((patch) => {
        const state = window.__ngneTest!.sessions.getState();
        if (!state.activeId) throw new Error("se-052: no active document");
        state.updateExportSettings(state.activeId, (settings) => Object.assign(settings, patch));
    }, patch);
}
