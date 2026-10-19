import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import type { MenuNode } from "../../src/app/commands/menuModel";
import { OPEN_RECENT_PATH, openRecentId } from "../../src/app/file/recent.commands";
import { createRecentFiles, RECENT_FILES_LIMIT, recentFiles } from "../../src/app/file/recentFiles";
import type { RecentFiles, RecentFileStorage } from "../../src/app/file/recentFiles";
import { createFileWorkflows } from "../../src/app/file/workflows";
import type { ProjectFileHandle } from "../../src/app/platform/projectFiles";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import { createDocument } from "../../src/core/model";
import { serialize } from "../../src/core/project";
import { composites, harness, MemoryDisk, openNew, paint } from "./se-041-support";
import type { FakeHandle, Harness } from "./se-041-support";

// SE-047: the recent files. File System Access handles kept in storage (IndexedDB in the
// page; a storage in memory here, whose stored values outlive the list as IndexedDB's outlive
// a reload); a file opened or saved goes first; Open Recent asks for read permission once and
// takes an entry off the list when it is refused or the file is gone; the commands of
// File → Open Recent.

/** A storage in memory: what was saved last, as IndexedDB would give it after a reload. */
function memoryStorage(): RecentFileStorage & { saved: unknown[] | null; saves: number } {
    const storage = {
        saved: null as unknown[] | null,
        saves: 0,
        load: async () => storage.saved,
        async save(stored: readonly unknown[]) {
            storage.saves++;
            storage.saved = [...stored];
        },
    };
    return storage;
}

/** What `stored` holds of a test handle: its file's name, which identifies it on the disk. */
interface StoredFile {
    readonly file: string;
}

/** Gives `handle` a stored value and the same-file test of a File System Access handle. */
function keepable<Handle extends ProjectFileHandle>(handle: Handle): Handle {
    Object.assign(handle, {
        stored: { file: handle.name } satisfies StoredFile,
        isSame: async (other: ProjectFileHandle) =>
            (other.stored as StoredFile | undefined)?.file === handle.name,
    });
    return handle;
}

/** A handle of `disk` that can be kept, as the page's handles can. */
function diskHandle(disk: MemoryDisk, name: string): FakeHandle {
    return keepable(disk.handle(name));
}

/** The recent files over `storage`, taking stored values back as handles of `disk`. */
function recentOver(storage: RecentFileStorage, disk: MemoryDisk): RecentFiles {
    return createRecentFiles({
        storage,
        handleFrom: (stored) => {
            const file = (stored as StoredFile | null)?.file;
            return typeof file === "string" ? diskHandle(disk, file) : null;
        },
    });
}

const names = (recent: RecentFiles) => recent.store.getState().entries.map((entry) => entry.name);

/** File workflows of a fresh harness with recent files of their own. */
function withRecent(): {
    test: Harness;
    recent: RecentFiles;
    storage: ReturnType<typeof memoryStorage>;
} {
    const storage = memoryStorage();
    const base = harness();
    const recent = recentOver(storage, base.disk);
    base.workflows = createFileWorkflows({
        sessions: base.sessions,
        platform: base.platform,
        dialogs: base.dialogs,
        notices: {
            info: (message) => void base.notices.push({ kind: "info", message }),
            error: (message) => void base.notices.push({ kind: "error", message }),
        },
        applyFloating: () => {},
        isFloating: () => false,
        recent,
    });
    return { test: base, recent, storage };
}

/** Lets the recent files' queued changes run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
    await recentFiles.clear();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
});

describe("the list", () => {
    it("puts the last file first, moves a listed file up, keeps at most the limit, and outlives a reload", async () => {
        const disk = new MemoryDisk();
        const storage = memoryStorage();
        const recent = recentOver(storage, disk);
        await recent.load();
        expect(names(recent)).toEqual([]);

        await recent.add(diskHandle(disk, "a.ngsprite"));
        await recent.add(diskHandle(disk, "b.ngsprite"));
        expect(names(recent)).toEqual(["b.ngsprite", "a.ngsprite"]);
        // The same file again (another handle to it): moved up, not listed twice.
        await recent.add(diskHandle(disk, "a.ngsprite"));
        expect(names(recent)).toEqual(["a.ngsprite", "b.ngsprite"]);
        expect(storage.saved).toEqual([{ file: "a.ngsprite" }, { file: "b.ngsprite" }]);

        for (let index = 0; index < RECENT_FILES_LIMIT + 2; index++) {
            await recent.add(diskHandle(disk, `f${index}.ngsprite`));
        }
        expect(names(recent)).toHaveLength(RECENT_FILES_LIMIT);
        expect(names(recent)[0]).toBe(`f${RECENT_FILES_LIMIT + 1}.ngsprite`);

        // A new list over the same storage: the page after a reload.
        const reloaded = recentOver(storage, disk);
        await reloaded.load();
        expect(names(reloaded)).toEqual(names(recent));
        // Keys name the entries of one list.
        const keys = reloaded.store.getState().entries.map((entry) => entry.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("lists only handles that can be kept; removes an entry and empties the list", async () => {
        const disk = new MemoryDisk();
        const storage = memoryStorage();
        const recent = recentOver(storage, disk);
        // A handle without a stored value (no File System Access behind it) is not listed.
        await recent.add(disk.handle("plain.ngsprite"));
        expect(names(recent)).toEqual([]);

        await recent.add(diskHandle(disk, "a.ngsprite"));
        await recent.add(diskHandle(disk, "b.ngsprite"));
        const [first] = recent.store.getState().entries;
        await recent.remove(first!.key);
        expect(names(recent)).toEqual(["a.ngsprite"]);
        expect(storage.saved).toEqual([{ file: "a.ngsprite" }]);
        await recent.clear();
        expect(names(recent)).toEqual([]);
        expect(storage.saved).toEqual([]);
    });

    it("waits for the kept list before a change, so an early add does not lose it", async () => {
        const disk = new MemoryDisk();
        const storage = memoryStorage();
        storage.saved = [{ file: "old.ngsprite" }];
        const recent = recentOver(storage, disk);
        await recent.add(diskHandle(disk, "new.ngsprite"));
        expect(names(recent)).toEqual(["new.ngsprite", "old.ngsprite"]);
    });
});

describe("the file workflows and the list", () => {
    it("a file saved or opened with File System Access goes first; a download is not listed", async () => {
        const { test, recent } = withRecent();
        const document = openNew(test, "hero");
        paint(document, 1);
        test.platform.toSave.push(diskHandle(test.disk, "hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        await settle();
        expect(names(recent)).toEqual(["hero.ngsprite"]);

        test.disk.files.set(
            "other.ngsprite",
            serialize(createDocument({ name: "other", width: 2, height: 2 }).doc, new Map()),
        );
        const other = diskHandle(test.disk, "other.ngsprite");
        test.platform.toOpen.push({
            name: other.name,
            size: test.disk.files.get("other.ngsprite")!.length,
            read: () => other.read(),
            handle: async () => other,
        });
        expect(await test.workflows.open()).toBe(true);
        await settle();
        expect(names(recent)).toEqual(["other.ngsprite", "hero.ngsprite"]);

        // Without File System Access: a download, nothing to open again.
        test.platform.access = false;
        openNew(test, "loose");
        expect(await test.workflows.save()).toBe(true);
        await settle();
        expect(names(recent)).toEqual(["other.ngsprite", "hero.ngsprite"]);
    });

    it("Open Recent opens the file in a tab of its own, after one permission prompt when it is needed", async () => {
        const { test, recent } = withRecent();
        const document = openNew(test, "hero");
        paint(document, 4);
        const saved = composites(test);
        test.platform.toSave.push(diskHandle(test.disk, "hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        test.sessions.getState().close(document.id);

        // After a reload the permission is to be asked again; the user grants it.
        const reloaded = recentOver(
            { load: async () => [{ file: "hero.ngsprite" }], save: async () => {} },
            test.disk,
        );
        await reloaded.load();
        const [entry] = reloaded.store.getState().entries;
        const handle = entry!.handle as FakeHandle;
        handle.readable = false;
        handle.grantsRead = true;
        expect(await test.workflows.openRecent(entry!)).toBe(true);
        expect(handle.readRequests).toBe(1);
        expect(activeDocument(test.sessions.getState())?.session.doc.name).toBe("hero");
        expect(composites(test)).toEqual(saved);
        expect(test.workflows.fileOf(activeDocument(test.sessions.getState())!.id)).toMatchObject({
            name: "hero.ngsprite",
            handle,
        });
        expect(test.notices.at(-1)).toEqual({ kind: "info", message: "Opened hero.ngsprite" });
        expect(names(recent)[0]).toBe("hero.ngsprite");
    });

    it("a refused permission takes the entry off the list after the one prompt; nothing opens", async () => {
        const { test, recent } = withRecent();
        await recent.add(diskHandle(test.disk, "kept.ngsprite"));
        await recent.add(diskHandle(test.disk, "hero.ngsprite"));
        test.disk.files.set(
            "hero.ngsprite",
            serialize(createDocument({ name: "hero", width: 2, height: 2 }).doc, new Map()),
        );
        const [entry] = recent.store.getState().entries;
        const handle = entry!.handle as FakeHandle;
        handle.readable = false;
        handle.grantsRead = false;

        expect(await test.workflows.openRecent(entry!)).toBe(false);
        expect(handle.readRequests).toBe(1);
        expect(test.sessions.getState().documents).toEqual([]);
        expect(names(recent)).toEqual(["kept.ngsprite"]);
        expect(test.notices).toEqual([
            {
                kind: "error",
                message:
                    "Could not open “hero.ngsprite”. No permission to read the file. It was " +
                    "removed from the recent files.",
            },
        ]);
        expect(test.workflows.busy).toBe(false);
    });

    it("a file that no longer exists is taken off the list; a prompt that could not be shown keeps it", async () => {
        const { test, recent } = withRecent();
        const gone = diskHandle(test.disk, "gone.ngsprite");
        gone.size = async () => {
            throw new DOMException("No file", "NotFoundError");
        };
        await recent.add(gone);
        let [entry] = recent.store.getState().entries;
        expect(await test.workflows.openRecent(entry!)).toBe(false);
        expect(names(recent)).toEqual([]);
        expect(test.notices.at(-1)?.message).toBe(
            "Could not open “gone.ngsprite”. The file no longer exists. It was removed from " +
                "the recent files.",
        );

        // Chrome refuses to prompt without the user's gesture: no answer, the entry stays.
        const lapsed = diskHandle(test.disk, "lapsed.ngsprite");
        lapsed.requestRead = async () => {
            throw new DOMException("User activation is required.", "SecurityError");
        };
        await recent.add(lapsed);
        [entry] = recent.store.getState().entries;
        expect(await test.workflows.openRecent(entry!)).toBe(false);
        expect(names(recent)).toEqual(["lapsed.ngsprite"]);
        expect(test.notices.at(-1)?.message).toBe(
            "Could not open “lapsed.ngsprite”. User activation is required.",
        );
        expect(test.sessions.getState().documents).toEqual([]);
    });
});

describe("File → Open Recent", () => {
    /** The titles and ids of the submenu, in order. */
    function submenu(): { ids: string[]; titles: string[] } {
        const file = buildMenu(appCommands.list(), ["File"]);
        const node = file.find(
            (entry): entry is Extract<MenuNode, { kind: "submenu" }> =>
                entry.kind === "submenu" && entry.title === OPEN_RECENT_PATH[1],
        );
        const commands = menuCommands(node?.children ?? []);
        return {
            ids: commands.map((command) => command.id),
            titles: commands.map((command) => command.title()),
        };
    }

    it("lists the recent files newest first, right after Open…, each opening its file; Clear empties it", async () => {
        const disk = new MemoryDisk();
        expect(submenu().ids).toEqual(["file.clearRecent"]);
        expect(appCommands.get("file.clearRecent")!.enabled()).toBe(false);

        await recentFiles.add(diskHandle(disk, "a.ngsprite"));
        await recentFiles.add(diskHandle(disk, "b.ngsprite"));
        const entries = recentFiles.store.getState().entries;
        expect(submenu()).toEqual({
            ids: [...entries.map(openRecentId), "file.clearRecent"],
            titles: ["b.ngsprite", "a.ngsprite", "Clear Recent Files"],
        });
        // The submenu follows Open… in the File menu, in its group.
        const file = buildMenu(appCommands.list(), ["File"]);
        const open = file.findIndex(
            (entry) => entry.kind === "command" && entry.command.id === "file.open",
        );
        expect(file[open + 1]).toMatchObject({ kind: "submenu", title: "Open Recent" });
        // Enabled while a file operation could run.
        expect(appCommands.get(openRecentId(entries[0]!))!.enabled()).toBe(true);
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "x", width: 2, height: 2 }));
        const stroke = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        expect(appCommands.get(openRecentId(entries[0]!))!.enabled()).toBe(false);
        stroke.abort();

        await appCommands.get("file.clearRecent")!.run();
        expect(submenu().ids).toEqual(["file.clearRecent"]);
        expect(appCommands.get(openRecentId(entries[0]!))).toBeUndefined();
    });
});
