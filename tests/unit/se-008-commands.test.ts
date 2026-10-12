import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { preferences } from "../../src/app/preferences/preferences";
import {
    createSpriteDialogs,
    NEW_SPRITE_SIZE_PRESETS,
    newSpriteProblems,
    spriteDialogs,
} from "../../src/app/sprite/dialogs";
import type {
    NewSpriteRequest,
    SpriteDialogRequest,
    SpritePropertiesRequest,
    SpritePropertiesValues,
} from "../../src/app/sprite/dialogs";
import { NEW_SPRITE_DEFAULTS } from "../../src/app/sprite/sprite.commands";
import { activeDocument, isDirty, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import {
    assertInvariants,
    createDocument,
    MAX_DOCUMENT_SIDE,
    MIN_DOCUMENT_SIDE,
} from "../../src/core/model";
import { GridRangeError, PivotRangeError, SpriteNameError } from "../../src/core/sprite";

// SE-008: the New Sprite and Sprite Properties commands of the registry, driven the way the
// dialogs drive them: a command opens a request, the test answers it.

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

function request(): SpriteDialogRequest | null {
    return spriteDialogs.store.getState().request;
}

function newSpriteRequest(): NewSpriteRequest {
    const open = request();
    if (open?.kind !== "new-sprite") throw new Error("the New sprite dialog is not open");
    return open;
}

function propertiesRequest(): SpritePropertiesRequest {
    const open = request();
    if (open?.kind !== "sprite-properties") {
        throw new Error("the Sprite properties dialog is not open");
    }
    return open;
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document is open");
    return document;
}

/** Opens a document through the store, as a later ticket or the test hook does. */
function open(name = "start", width = 8, height = 8): OpenDocument {
    return sessionsStore.getState().open(createDocument({ name, width, height }));
}

/** Runs New Sprite and answers its dialog. */
async function createSprite(values: { name: string; width: number; height: number }) {
    const done = command("file.new").run();
    newSpriteRequest().answer(values);
    await done;
}

/** Runs Sprite Properties and answers its dialog with the initial values changed by `edit`. */
async function editProperties(edit: (values: SpritePropertiesValues) => void) {
    const done = command("sprite.properties").run();
    const { initial, answer } = propertiesRequest();
    const values = structuredClone(initial);
    edit(values);
    answer(values);
    await done;
}

afterEach(() => {
    request()?.answer(null);
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    preferences.reset();
});

describe("the sprite commands in the registry", () => {
    it("New Sprite takes its planned menu item and binds Ctrl+Alt+N, also in text fields", () => {
        expect(command("file.new")).toMatchObject({
            planned: false,
            source: "../sprite/sprite.commands.ts",
            shortcuts: ["Ctrl+Alt+N"],
            contexts: ["global", "text"],
            menuPath: ["File"],
        });
        expect(command("file.new").title()).toBe("New Sprite…");
        expect(command("file.new").enabled()).toBe(true);
        // First item of File, where it was planned.
        const plan = plannedCommands.find((entry) => entry.id === "file.new");
        expect(command("file.new").menuOrder).toBe(plan?.menuOrder);
        expect(menuCommands(buildMenu(appCommands.list(), ["File"]))[0]?.id).toBe("file.new");
    });

    it("Sprite Properties takes its planned menu item and needs an open document", () => {
        expect(command("sprite.properties")).toMatchObject({
            planned: false,
            source: "../sprite/sprite.commands.ts",
            shortcuts: [],
            menuPath: ["Sprite"],
        });
        expect(command("sprite.properties").title()).toBe("Properties…");
        expect(menuCommands(buildMenu(appCommands.list(), ["Sprite"]))[0]?.id).toBe(
            "sprite.properties",
        );

        expect(command("sprite.properties").enabled()).toBe(false);
        const { history, session } = open();
        expect(command("sprite.properties").enabled()).toBe(true);
        // Not while a stroke is open: the history accepts no command then.
        const { activeLayerId: layerId, activeFrameId: frameId } = session;
        const transaction = history.begin({ layerId, frameId });
        expect(command("sprite.properties").enabled()).toBe(false);
        transaction.abort();
        expect(command("sprite.properties").enabled()).toBe(true);
    });

    it("the registry tells its subscribers when a document opens, so the menu item follows", () => {
        let notified = 0;
        const stop = appCommands.subscribe(() => notified++);
        open();
        expect(notified).toBeGreaterThan(0);
        stop();
    });
});

describe("New Sprite", () => {
    it("opens the dialog with the defaults and nothing to discard", async () => {
        const done = command("file.new").run();
        expect(newSpriteRequest()).toMatchObject({
            kind: "new-sprite",
            initial: { name: "Sprite", width: 32, height: 32 },
            discards: null,
        });
        expect(newSpriteRequest().initial).toEqual(NEW_SPRITE_DEFAULTS);
        expect(newSpriteProblems(newSpriteRequest().initial).message).toBeNull();
        newSpriteRequest().answer(null);
        await done;
    });

    it("creates a 32×32 document named hero as the active session, and it passes the invariants", async () => {
        await createSprite({ name: "hero", width: 32, height: 32 });
        expect(request()).toBeNull();
        const { documents, activeId } = sessionsStore.getState();
        expect(documents).toHaveLength(1);
        const document = active();
        expect(document.id).toBe(activeId);
        assertInvariants(document.session);
        expect(document.session.doc).toMatchObject({
            name: "hero",
            width: 32,
            height: 32,
            pivot: { x: 0.5, y: 0.5 },
        });
        expect(document.session.doc.layers).toHaveLength(1);
        expect(document.session.doc.frames).toHaveLength(1);
        // A new document has nothing to undo and nothing to save.
        expect(document.history.canUndo).toBe(false);
        expect(isDirty(document)).toBe(false);
    });

    it("stores the name without surrounding white space", async () => {
        await createSprite({ name: "  hero  ", width: 16, height: 16 });
        expect(active().session.doc.name).toBe("hero");
    });

    it("cancelling the dialog creates nothing", async () => {
        const done = command("file.new").run();
        newSpriteRequest().answer(null);
        await done;
        expect(sessionsStore.getState().documents).toEqual([]);
        expect(request()).toBeNull();
    });

    it("takes the grid size of a new document from the preference store's default grid", async () => {
        // The preference as it ships.
        const { width, height } = preferences.get("grid");
        await createSprite({ name: "a", width: 32, height: 32 });
        expect(active().session.doc.settings.grid).toEqual({
            width,
            height,
            offsetX: 0,
            offsetY: 0,
            visible: false,
        });

        // The preference when the command creates the document, not when the app started.
        preferences.set("grid", { width: 8, height: 12 });
        await createSprite({ name: "b", width: 32, height: 32 });
        expect(active().session.doc.settings.grid).toMatchObject({ width: 8, height: 12 });

        // And not when the dialog was opened.
        const done = command("file.new").run();
        preferences.set("grid", { width: 24, height: 6 });
        newSpriteRequest().answer({ name: "c", width: 64, height: 64 });
        await done;
        expect(active().session.doc.settings.grid).toMatchObject({ width: 24, height: 6 });
        expect(active().session.doc.width).toBe(64);
    });

    it("replaces the open document: one document stays open, the new one", async () => {
        const first = open("first");
        await createSprite({ name: "second", width: 16, height: 24 });
        const { documents } = sessionsStore.getState();
        expect(documents).toHaveLength(1);
        expect(active().id).not.toBe(first.id);
        expect(active().session.doc).toMatchObject({ name: "second", width: 16, height: 24 });
    });

    it("has nothing to confirm while the open document has no unsaved changes", async () => {
        open("clean");
        // A view preference does not make a document dirty (SPEC §5.2).
        sessionsStore.getState().updateDocSettings(active().id, (settings) => {
            settings.grid.visible = true;
        });
        const done = command("file.new").run();
        expect(newSpriteRequest().discards).toBeNull();
        newSpriteRequest().answer(null);
        await done;
    });

    it("names the open document to discard when it has unsaved changes", async () => {
        const first = open("first");
        await editProperties((values) => {
            values.pivot = { x: 0, y: 0 };
        });
        expect(isDirty(active())).toBe(true);

        let done = command("file.new").run();
        expect(newSpriteRequest().discards).toBe("first");
        // Cancelled: the document and its changes are still there.
        newSpriteRequest().answer(null);
        await done;
        expect(active().id).toBe(first.id);
        expect(active().session.doc.pivot).toEqual({ x: 0, y: 0 });
        expect(active().history.canUndo).toBe(true);

        // Saved: nothing to discard any more.
        sessionsStore.getState().markSaved(first.id);
        done = command("file.new").run();
        expect(newSpriteRequest().discards).toBeNull();
        newSpriteRequest().answer(null);
        await done;

        // Export settings count as unsaved changes too.
        sessionsStore.getState().updateExportSettings(first.id, (settings) => {
            settings.padding = 2;
        });
        done = command("file.new").run();
        expect(newSpriteRequest().discards).toBe("first");
        newSpriteRequest().answer({ name: "second", width: 8, height: 8 });
        await done;
        expect(active().session.doc.name).toBe("second");
        expect(sessionsStore.getState().documents).toHaveLength(1);
    });

    it("refuses a size outside 1..1024 and leaves the open document alone", async () => {
        const first = open("first");
        for (const size of [
            { width: 0, height: 32 },
            { width: 32, height: 1025 },
            { width: 12.5, height: 32 },
        ]) {
            const done = command("file.new").run();
            newSpriteRequest().answer({ name: "bad", ...size });
            await expect(done).rejects.toMatchObject({ name: "DocumentSizeError" });
            expect(active().id).toBe(first.id);
        }
        const done = command("file.new").run();
        newSpriteRequest().answer({ name: " ", width: 8, height: 8 });
        await expect(done).rejects.toBeInstanceOf(SpriteNameError);
        expect(active().id).toBe(first.id);
    });
});

describe("the checks of the New sprite dialog", () => {
    const check = (width: number, height: number, name = "hero") =>
        newSpriteProblems({ name, width, height });

    it("accepts every size from 1 to 1024", () => {
        expect(MIN_DOCUMENT_SIDE).toBe(1);
        expect(MAX_DOCUMENT_SIDE).toBe(1024);
        for (const [width, height] of [
            [1, 1],
            [32, 32],
            [1024, 1024],
            [1, 1024],
        ] as const) {
            expect(check(width, height)).toEqual({
                name: false,
                width: false,
                height: false,
                message: null,
            });
        }
    });

    it("width or height outside 1..1024 is a problem with a message that names it", () => {
        expect(check(0, 32)).toMatchObject({
            width: true,
            height: false,
            message: "Width must be from 1 to 1024 px.",
        });
        expect(check(1025, 32)).toMatchObject({ width: true, height: false });
        expect(check(32, 0)).toMatchObject({
            width: false,
            height: true,
            message: "Height must be from 1 to 1024 px.",
        });
        expect(check(32, 1025).height).toBe(true);
        expect(check(-4, 4096)).toMatchObject({
            width: true,
            height: true,
            message: "Width and height must each be from 1 to 1024 px.",
        });
        // Not an integer, not a number.
        expect(check(16.5, 32).width).toBe(true);
        expect(check(32, Number.NaN).height).toBe(true);
    });

    it("the dialog's own answer never reaches the command's size error", () => {
        // Whatever the checks accept, the model accepts.
        for (const side of [1, 2, 31, 1023, 1024]) {
            expect(check(side, side).message).toBeNull();
            expect(() => createDocument({ name: "a", width: side, height: side })).not.toThrow();
        }
    });

    it("an empty name is a problem, reported after the size", () => {
        expect(check(32, 32, "   ")).toEqual({
            name: true,
            width: false,
            height: false,
            message: "Enter a name.",
        });
        expect(check(0, 32, "")).toMatchObject({
            name: true,
            message: "Width must be from 1 to 1024 px.",
        });
    });

    it("offers the presets of DESIGN §7, each of them a valid size", () => {
        expect(NEW_SPRITE_SIZE_PRESETS).toEqual([16, 32, 48, 64, 128]);
        for (const size of NEW_SPRITE_SIZE_PRESETS) expect(check(size, size).message).toBeNull();
    });
});

describe("Sprite Properties", () => {
    it("opens the dialog with the name, pivot and grid of the active document", async () => {
        const { session } = open("hero", 32, 24);
        session.doc.settings.grid = {
            width: 8,
            height: 4,
            offsetX: 2,
            offsetY: -1,
            visible: true,
        };
        const done = command("sprite.properties").run();
        expect(propertiesRequest().initial).toEqual({
            name: "hero",
            pivot: { x: 0.5, y: 0.5 },
            grid: { width: 8, height: 4, offsetX: 2, offsetY: -1 },
        });
        // The dialog edits a copy.
        expect(propertiesRequest().initial.pivot).not.toBe(session.doc.pivot);
        propertiesRequest().answer(null);
        await done;
    });

    it("does nothing without an open document", async () => {
        await command("sprite.properties").run();
        expect(request()).toBeNull();
    });

    it("cancelling, or OK without a change, makes no history entry", async () => {
        const document = open("hero");
        const done = command("sprite.properties").run();
        propertiesRequest().answer(null);
        await done;
        await editProperties(() => {});
        expect(active().history.canUndo).toBe(false);
        expect(isDirty(active())).toBe(false);
        expect(active().revision).toBe(document.revision);
    });

    it("setting pivot to bottom-centre stores { x: 0.5, y: 1 }; undo restores the previous value", async () => {
        const { session, history } = open("hero");
        await editProperties((values) => {
            values.pivot = { x: 0.5, y: 1 };
        });
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 1 });
        expect(history.undoLabel).toBe("Set Pivot");
        assertInvariants(session);

        expect(command("edit.undo").title()).toBe("Undo Set Pivot");
        await command("edit.undo").run();
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 0.5 });
        await command("edit.redo").run();
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 1 });
    });

    it("renaming is an undoable history entry", async () => {
        const { session, history } = open("hero");
        await editProperties((values) => {
            values.name = " villain ";
        });
        expect(session.doc.name).toBe("villain");
        expect(history.undoLabel).toBe("Rename Sprite");
        expect(history.undoCount).toBe(1);
        expect(isDirty(active())).toBe(true);

        await command("edit.undo").run();
        expect(session.doc.name).toBe("hero");
        expect(isDirty(active())).toBe(false);
        await command("edit.redo").run();
        expect(session.doc.name).toBe("villain");
    });

    it("a name that differs only in surrounding white space is no change", async () => {
        open("hero");
        await editProperties((values) => {
            values.name = "  hero ";
        });
        expect(active().history.canUndo).toBe(false);
    });

    it("changing the grid size adds no history entry and does not set the dirty flag; changing the pivot does both", async () => {
        const { session, history } = open("hero");
        const position = history.position;

        await editProperties((values) => {
            values.grid.width = 8;
            values.grid.height = 12;
        });
        expect(session.doc.settings.grid).toMatchObject({ width: 8, height: 12 });
        expect(history.undoCount).toBe(0);
        expect(history.position).toBe(position);
        expect(isDirty(active())).toBe(false);
        // Not undoable: there is nothing to undo.
        expect(command("edit.undo").enabled()).toBe(false);

        await editProperties((values) => {
            values.pivot = { x: 1, y: 0 };
        });
        expect(session.doc.pivot).toEqual({ x: 1, y: 0 });
        expect(history.undoCount).toBe(1);
        expect(history.position).not.toBe(position);
        expect(isDirty(active())).toBe(true);
    });

    it("changing the grid offset adds no history entry and does not set the dirty flag", async () => {
        const { session, history } = open("hero");
        session.doc.settings.grid.visible = true;
        await editProperties((values) => {
            values.grid.offsetX = 4;
            values.grid.offsetY = -2;
        });
        expect(session.doc.settings.grid).toEqual({
            width: 16,
            height: 16,
            offsetX: 4,
            offsetY: -2,
            visible: true,
        });
        expect(history.undoCount).toBe(0);
        expect(isDirty(active())).toBe(false);
    });

    it("tells subscribers of the store about a grid change", async () => {
        const before = open("hero").revision;
        await editProperties((values) => {
            values.grid.width = 4;
        });
        expect(active().revision).toBeGreaterThan(before);
    });

    it("undo does not take a grid change back", async () => {
        const { session } = open("hero");
        await editProperties((values) => {
            values.pivot = { x: 0, y: 1 };
            values.grid.width = 4;
        });
        await command("edit.undo").run();
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 0.5 });
        expect(session.doc.settings.grid.width).toBe(4);
    });

    it("name and pivot changed together are one undo step", async () => {
        const { session, history } = open("hero");
        await editProperties((values) => {
            values.name = "villain";
            values.pivot = { x: 0.5, y: 1 };
        });
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Sprite Properties");
        expect(session.doc).toMatchObject({ name: "villain", pivot: { x: 0.5, y: 1 } });
        await command("edit.undo").run();
        expect(session.doc).toMatchObject({ name: "hero", pivot: { x: 0.5, y: 0.5 } });
        expect(isDirty(active())).toBe(false);
    });

    it("refuses values it does not accept and changes nothing", async () => {
        const { session, history } = open("hero");
        const before = structuredClone({
            name: session.doc.name,
            pivot: session.doc.pivot,
            grid: session.doc.settings.grid,
        });
        const unchanged = () => {
            expect({
                name: session.doc.name,
                pivot: session.doc.pivot,
                grid: session.doc.settings.grid,
            }).toEqual(before);
            expect(history.canUndo).toBe(false);
        };
        // Each with valid changes next to the invalid one: nothing of them is applied.
        await expect(
            editProperties((values) => {
                values.name = "";
                values.pivot = { x: 0, y: 0 };
                values.grid.width = 8;
            }),
        ).rejects.toBeInstanceOf(SpriteNameError);
        unchanged();
        await expect(
            editProperties((values) => {
                values.name = "villain";
                values.pivot = { x: 1.5, y: 0 };
                values.grid.width = 8;
            }),
        ).rejects.toBeInstanceOf(PivotRangeError);
        unchanged();
        await expect(
            editProperties((values) => {
                values.name = "villain";
                values.pivot = { x: 0, y: 0 };
                values.grid.height = 0;
            }),
        ).rejects.toBeInstanceOf(GridRangeError);
        unchanged();
    });
});

describe("sprite dialog requests", () => {
    it("one dialog at a time: a request made while another is open is answered with null", async () => {
        const dialogs = createSpriteDialogs();
        const initial = { name: "a", width: 8, height: 8 };
        const first = dialogs.newSprite({ initial, discards: null });
        const open = dialogs.store.getState().request;
        expect(open?.kind).toBe("new-sprite");
        const properties = {
            name: "a",
            pivot: { x: 0, y: 0 },
            grid: { width: 1, height: 1, offsetX: 0, offsetY: 0 },
        };
        await expect(dialogs.spriteProperties({ initial: properties })).resolves.toBeNull();
        expect(dialogs.store.getState().request).toBe(open);

        if (open?.kind !== "new-sprite") throw new Error("expected the New sprite dialog");
        open.answer({ name: "b", width: 4, height: 4 });
        await expect(first).resolves.toEqual({ name: "b", width: 4, height: 4 });
        expect(dialogs.store.getState().request).toBeNull();
    });

    it("an answer closes the dialog; a second answer changes nothing", async () => {
        const dialogs = createSpriteDialogs();
        const initial = { name: "a", width: 8, height: 8 };
        const first = dialogs.newSprite({ initial, discards: "old" });
        const stale = dialogs.store.getState().request;
        if (stale?.kind !== "new-sprite") throw new Error("expected the New sprite dialog");
        expect(stale.discards).toBe("old");
        stale.answer(null);
        await expect(first).resolves.toBeNull();

        // The next dialog is not closed by the answer of the previous one.
        const second = dialogs.newSprite({ initial, discards: null });
        const current = dialogs.store.getState().request;
        stale.answer({ name: "stale", width: 1, height: 1 });
        expect(dialogs.store.getState().request).toBe(current);
        current?.answer(null);
        await expect(second).resolves.toBeNull();
    });

    it("tells subscribers when a dialog opens and closes", async () => {
        const dialogs = createSpriteDialogs();
        const seen: (string | null)[] = [];
        dialogs.store.subscribe((state) => seen.push(state.request?.kind ?? null));
        const done = dialogs.newSprite({
            initial: { name: "a", width: 8, height: 8 },
            discards: null,
        });
        dialogs.store.getState().request?.answer(null);
        await done;
        expect(seen).toEqual(["new-sprite", null]);
    });
});
