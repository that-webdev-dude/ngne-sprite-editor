import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CompositeModule from "../../src/core/composite";
import { region } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { openDocument, settle } from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { geometry } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { texelClient } from "./se-014-support";
import { setColours } from "./se-015-support";

// Shared helpers of the SE-041 specs: File System Access replaced by pickers over files in
// the page's memory (Chrome shows its real pickers only for a real gesture, with real
// dialogs), or taken away; a document drawn with the pencil; what the page's documents hold.

/** The state of the in-memory File System Access stub, on `window.__se041Fs`. */
export interface FileSystemStub {
    /** Files by name, as arrays of bytes. */
    files: Record<string, number[]>;
    /** The names the next save pickers return, first to last; empty: the picker is cancelled. */
    nextSave: string[];
    /** The names the next open pickers return, first to last; empty: the picker is cancelled. */
    nextOpen: string[];
    /** The suggested name of every save picker shown. */
    saveSuggestions: string[];
    /** Number of open pickers shown. */
    openPickers: number;
    /** Every write, by file name, in order. */
    writes: string[];
}

declare global {
    interface Window {
        __se041Fs?: FileSystemStub;
    }
}

/**
 * Replaces `showOpenFilePicker` and `showSaveFilePicker` before the app loads: their handles
 * read and write `window.__se041Fs.files`, and grant every permission.
 */
export async function stubFileSystemAccess(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const stub: FileSystemStub = {
            files: {},
            nextSave: [],
            nextOpen: [],
            saveSuggestions: [],
            openPickers: 0,
            writes: [],
        };
        window.__se041Fs = stub;
        const handle = (name: string) => ({
            kind: "file",
            name,
            async getFile() {
                const bytes = stub.files[name];
                if (!bytes) throw new DOMException(`No file ${name}`, "NotFoundError");
                return new File([Uint8Array.from(bytes)], name);
            },
            async createWritable() {
                const chunks: number[] = [];
                return {
                    async write(data: Uint8Array) {
                        for (const byte of data) chunks.push(byte);
                    },
                    async close() {
                        stub.files[name] = chunks;
                        stub.writes.push(name);
                    },
                    async abort() {},
                };
            },
            queryPermission: async () => "granted",
            requestPermission: async () => "granted",
        });
        const cancelled = () => new DOMException("The user aborted a request.", "AbortError");
        Object.assign(window, {
            async showSaveFilePicker(options?: { suggestedName?: string }) {
                stub.saveSuggestions.push(options?.suggestedName ?? "");
                const name = stub.nextSave.shift();
                if (name === undefined) throw cancelled();
                return handle(name);
            },
            async showOpenFilePicker() {
                stub.openPickers++;
                const name = stub.nextOpen.shift();
                if (name === undefined) throw cancelled();
                return [handle(name)];
            },
        });
    });
}

/** Takes the File System Access pickers away before the app loads. */
export async function removeFileSystemAccess(page: Page): Promise<void> {
    await page.addInitScript(() => {
        for (const owner of [window, Window.prototype] as unknown as Record<string, unknown>[]) {
            delete owner.showOpenFilePicker;
            delete owner.showSaveFilePicker;
        }
    });
}

export function fileSystem(page: Page): Promise<FileSystemStub> {
    return page.evaluate(() => structuredClone(window.__se041Fs!));
}

/** Sets what the next pickers return, and files in the stub's memory. */
export function arrangeFiles(
    page: Page,
    arrangement: { nextSave?: string[]; nextOpen?: string[]; files?: Record<string, number[]> },
): Promise<void> {
    return page.evaluate((arrangement) => {
        const stub = window.__se041Fs!;
        stub.nextSave.push(...(arrangement.nextSave ?? []));
        stub.nextOpen.push(...(arrangement.nextOpen ?? []));
        Object.assign(stub.files, arrangement.files ?? {});
    }, arrangement);
}

export const VIEW: View = { scale: 8, originX: 40, originY: 32 };
export const WIDTH = 16;
export const HEIGHT = 12;
const BLACK = 0x000000ff;
const WHITE = 0xffffffff;

/** Opens the editor and a document "hero" of 16 × 12 at a known view, painting black. */
export async function openHero(page: Page): Promise<TestDocument> {
    await openEditor(page);
    const document = await openDocument(page, { name: "hero", width: WIDTH, height: HEIGHT }, VIEW);
    await setColours(page, BLACK, WHITE);
    await settle(page);
    return document;
}

/** Draws one pencil stroke with the real mouse through `texels`, then waits for its commit. */
export async function drawStroke(page: Page, texels: readonly Point[]): Promise<void> {
    const layout = await geometry(page);
    const [first, ...rest] = texels.map((texel) => texelClient(layout, VIEW, texel));
    if (!first) throw new Error("se-041: a stroke needs a texel");
    const undoBefore = await undoCount(page);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of rest) await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await expect.poll(() => undoCount(page)).toBe(undoBefore + 1);
}

/** Adds an empty frame after the active one with the Frame menu's command; it becomes active. */
export async function addEmptyFrame(page: Page): Promise<void> {
    const frames = await frameCount(page);
    await page.evaluate(() => window.__ngneTest!.commands.get("frame.newEmpty")!.run());
    await expect.poll(() => frameCount(page)).toBe(frames + 1);
    await settle(page);
}

function frameCount(page: Page): Promise<number> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        return document?.session.doc.frames.length ?? 0;
    });
}

function undoCount(page: Page): Promise<number> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        return document?.history.undoCount ?? -1;
    });
}

/** What a spec reads of the active document; null while none is open. */
export interface ActiveState {
    id: string;
    name: string;
    frames: number;
    undo: number;
    redo: number;
    dirty: boolean;
    revision: number;
}

export function activeState(page: Page): Promise<ActiveState | null> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) return null;
        const { doc } = document.session;
        const { history } = document;
        return {
            id: document.id,
            name: doc.name,
            frames: doc.frames.length,
            undo: history.undoCount,
            redo: history.redoCount,
            dirty:
                history.position !== document.savedPosition ||
                JSON.stringify(doc.exportSettings) !== document.savedExportSettings,
            revision: document.revision,
        };
    });
}

/** The composite of every frame of the active document, in frame order (`compositeFrame`). */
export function frameComposites(page: Page): Promise<number[][]> {
    return page.evaluate(async () => {
        const path = "/src/core/composite/index.ts";
        const { compositeFrame } = (await import(
            /* @vite-ignore */ path
        )) as typeof CompositeModule;
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("se-041: no active document");
        const { doc } = document.session;
        return doc.frames.map((frame) => Array.from(compositeFrame(doc, frame.id).data));
    });
}

export const documentName = (page: Page): Locator =>
    region(page, "menu-bar").locator("[data-document-name]");
export const unsavedMarker = (page: Page): Locator =>
    region(page, "menu-bar").locator("[data-unsaved-marker]");
export const emptyState = (page: Page): Locator =>
    region(page, "viewport").locator("[data-empty-state]");
export const discardDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Discard unsaved changes?" });
export const infoToast = (page: Page, text: string): Locator =>
    page.locator(".ui-toast:not(.ui-toast--error)", { hasText: text });
export const errorToast = (page: Page): Locator => page.locator(".ui-toast--error");
