import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { isProjectFileName, projectFileName } from "../../src/app/file/fileName";
import { installFileWorkflows } from "../../src/app/file/install";
import { createNotices } from "../../src/app/notices/notices";
import type { NoticeKind } from "../../src/app/notices/notices";
import type { ChosenFile } from "../../src/app/platform/projectFiles";
import { createSessionsStore, sessionsStore } from "../../src/app/state/sessions";
import { createDocument } from "../../src/core/model";
import { paint } from "./se-041-support";

// SE-041: the file commands in the registry (SPEC §7.8, §10), the page-wide parts of the
// workflows (unload guard, drop), the file name a document is saved under, and the notices.

const FILE_COMMANDS = ["file.open", "file.save", "file.saveAs", "file.revert", "file.close"];

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
});

describe("the file commands in the registry", () => {
    it("take the File menu items planned for them, in the planned order", () => {
        for (const id of FILE_COMMANDS) {
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(command(id), id).toMatchObject({
                planned: false,
                source: "../file/file.commands.ts",
                menuPath: ["File"],
                menuOrder: plan?.menuOrder,
            });
            expect(command(id).title(), id).toBe(plan?.title);
        }
        // The File menu lists them where they were planned, among the other items.
        const planned = plannedCommands
            .filter((entry) => entry.menuPath[0] === "File")
            .map((entry) => entry.id);
        const listed = menuCommands(buildMenu(appCommands.list(), ["File"])).map(
            (entry) => entry.id,
        );
        expect(listed.filter((id) => planned.includes(id))).toEqual(planned);
    });

    it("bind the keys of SPEC §7.8, marked †: they also act while a text field has focus", () => {
        const expected: Record<string, string[]> = {
            "file.open": ["Ctrl+O"],
            "file.save": ["Ctrl+S"],
            "file.saveAs": ["Ctrl+Shift+S"],
            "file.close": ["Alt+W"],
            "file.revert": [],
        };
        for (const [id, shortcuts] of Object.entries(expected)) {
            expect(command(id).shortcuts, id).toEqual(shortcuts);
            if (shortcuts.length > 0) expect(command(id).contexts, id).toEqual(["global", "text"]);
        }
        expect(appCommands.bindings("text", "Ctrl+S").map((entry) => entry.id)).toContain(
            "file.save",
        );
    });

    it("Open is enabled without a document; Save, Save As and Close need one; Revert needs its file", () => {
        const enabled = () => FILE_COMMANDS.filter((id) => command(id).enabled());
        expect(enabled()).toEqual(["file.open"]);
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "hero", width: 4, height: 3 }));
        // Never saved: no file to revert to.
        expect(enabled()).toEqual(["file.open", "file.save", "file.saveAs", "file.close"]);
        // During a stroke none of them acts.
        const transaction = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        expect(enabled()).toEqual([]);
        transaction.abort();
        expect(enabled()).toEqual(["file.open", "file.save", "file.saveAs", "file.close"]);
    });
});

describe("the unload guard and the drop (installFileWorkflows)", () => {
    function setup() {
        const target = new EventTarget();
        const sessions = createSessionsStore();
        const opened: string[][] = [];
        const state = { overlay: false, busy: false };
        const stop = installFileWorkflows({
            target,
            sessions,
            overlayOpen: () => state.overlay,
            workflows: {
                get busy() {
                    return state.busy;
                },
                async openFiles(files: readonly ChosenFile[]) {
                    opened.push(files.map((file) => file.name));
                    return true;
                },
            },
        });
        /** Whether leaving the page now would be confirmed. */
        const guarded = () => {
            const event = new Event("beforeunload", { cancelable: true });
            target.dispatchEvent(event);
            return event.defaultPrevented;
        };
        return { target, sessions, opened, state, stop, guarded };
    }

    function drag(type: string, types: string[], names: string[] = []) {
        const event = new Event(type, { cancelable: true });
        const items = names.map((name) => ({
            kind: "file",
            getAsFile: () => new File([Uint8Array.of(1)], name),
        }));
        const dataTransfer = { types, items, files: [], dropEffect: "none" };
        Object.assign(event, { dataTransfer });
        return { event, dataTransfer };
    }

    it("asks before the page is left while any document is dirty, and only then", () => {
        const { sessions, stop, guarded } = setup();
        expect(guarded()).toBe(false);
        const document = sessions
            .getState()
            .open(createDocument({ name: "hero", width: 4, height: 3 }));
        expect(guarded()).toBe(false);
        // A view preference does not make the document dirty (SPEC §5.2).
        sessions.getState().updateDocSettings(document.id, (settings) => {
            settings.grid.visible = true;
        });
        expect(guarded()).toBe(false);
        paint(document, 1);
        expect(guarded()).toBe(true);
        sessions.getState().markSaved(document.id);
        expect(guarded()).toBe(false);
        sessions.getState().updateExportSettings(document.id, (settings) => {
            settings.padding = 4;
        });
        expect(guarded()).toBe(true);
        // A second, clean document changes nothing; closing the dirty one ends the guard.
        sessions.getState().open(createDocument({ name: "other", width: 2, height: 2 }));
        expect(guarded()).toBe(true);
        sessions.getState().close(document.id);
        expect(guarded()).toBe(false);
        paint(sessions.getState().documents[0]!, 2);
        expect(guarded()).toBe(true);
        stop();
        expect(guarded()).toBe(false);
    });

    it("a drop of files opens them; the browser never takes the drop", () => {
        const { target, opened, state, stop } = setup();
        const over = drag("dragover", ["Files"]);
        target.dispatchEvent(over.event);
        expect(over.event.defaultPrevented).toBe(true);
        expect(over.dataTransfer.dropEffect).toBe("copy");

        const drop = drag("drop", ["Files"], ["hero.ngsprite", "notes.txt"]);
        target.dispatchEvent(drop.event);
        expect(drop.event.defaultPrevented).toBe(true);
        expect(opened).toEqual([["hero.ngsprite", "notes.txt"]]);

        // While a menu or dialog is open, or a file operation runs: refused, still prevented.
        for (const key of ["overlay", "busy"] as const) {
            state[key] = true;
            const refusedOver = drag("dragover", ["Files"]);
            target.dispatchEvent(refusedOver.event);
            expect(refusedOver.dataTransfer.dropEffect, key).toBe("none");
            const refused = drag("drop", ["Files"], ["hero.ngsprite"]);
            target.dispatchEvent(refused.event);
            expect(refused.event.defaultPrevented, key).toBe(true);
            expect(opened, key).toHaveLength(1);
            state[key] = false;
        }

        // A drag of text is not the workflows' to take.
        const text = drag("drop", ["text/plain"]);
        target.dispatchEvent(text.event);
        expect(text.event.defaultPrevented).toBe(false);
        stop();
        const after = drag("drop", ["Files"], ["hero.ngsprite"]);
        target.dispatchEvent(after.event);
        expect(after.event.defaultPrevented).toBe(false);
        expect(opened).toHaveLength(1);
    });
});

describe("the file name of a document without a file", () => {
    it("is its name with the extension", () => {
        expect(projectFileName("hero")).toBe("hero.ngsprite");
        expect(projectFileName("Hero ✦ idle")).toBe("Hero ✦ idle.ngsprite");
        expect(projectFileName("hero.NGSPRITE")).toBe("hero.ngsprite");
    });

    it("holds no character a file name cannot hold, and never ends in a dot or a space", () => {
        expect(projectFileName('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j.ngsprite");
        expect(projectFileName("tab\there\u0000")).toBe("tab_here_.ngsprite");
        expect(projectFileName("  walk cycle.  ")).toBe("walk cycle.ngsprite");
        expect(projectFileName("con")).toBe("_con.ngsprite");
        expect(projectFileName("LPT1.v2")).toBe("_LPT1.v2.ngsprite");
        expect(projectFileName("console")).toBe("console.ngsprite");
    });

    it("falls back to Sprite and keeps at most 200 characters", () => {
        expect(projectFileName("")).toBe("Sprite.ngsprite");
        expect(projectFileName("...")).toBe("Sprite.ngsprite");
        const long = projectFileName("✦".repeat(255));
        expect(Array.from(long.replace(".ngsprite", ""))).toHaveLength(200);
    });

    it("recognises a project file by its extension, in any case", () => {
        expect(isProjectFileName("hero.ngsprite")).toBe(true);
        expect(isProjectFileName("HERO.NgSprite")).toBe(true);
        expect(isProjectFileName("hero.png")).toBe(false);
        expect(isProjectFileName("ngsprite")).toBe(false);
    });
});

describe("notices", () => {
    it("go to every attached sink until it is removed", () => {
        const notices = createNotices();
        const shown: [NoticeKind, string][] = [];
        const detach = notices.attachSink((kind, message) => shown.push([kind, message]));
        notices.info("Saved hero.ngsprite");
        notices.error("Could not open “x”.");
        expect(shown).toEqual([
            ["info", "Saved hero.ngsprite"],
            ["error", "Could not open “x”."],
        ]);
        detach();
        notices.info("later");
        expect(shown).toHaveLength(2);
    });
});
