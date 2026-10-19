import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { fileDialogs } from "../../src/app/file/dialogs";
import { fileWorkflows } from "../../src/app/file/workflows";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { sessionsStore } from "../../src/app/state/sessions";
import { createDocument } from "../../src/core/model";
import { paint } from "./se-041-support";

// SE-052: the export commands in the registry (SPEC §7.8, §9.6): where the File menu lists
// them, their keys, and when they can run.

const EXPORT_COMMANDS = [
    "file.export",
    "file.exportAgain",
    "file.exportFramePng",
    "file.exportSpriteSheet",
    "file.exportPngSequence",
];

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

const enabled = () => EXPORT_COMMANDS.filter((id) => command(id).enabled());

afterEach(() => {
    setKeyContext("floating", false);
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
});

describe("the export commands in the registry", () => {
    it("take the items planned for Export… and Export Again; the other exports follow them", () => {
        for (const id of ["file.export", "file.exportAgain"]) {
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(command(id), id).toMatchObject({
                planned: false,
                source: "../export/export.commands.ts",
                menuPath: ["File"],
                menuOrder: plan?.menuOrder,
            });
            expect(command(id).title(), id).toBe(plan?.title);
        }
        const file = menuCommands(buildMenu(appCommands.list(), ["File"])).map((entry) => entry.id);
        const at = file.indexOf("file.export");
        expect(file.slice(at, at + EXPORT_COMMANDS.length)).toEqual(EXPORT_COMMANDS);
        expect(EXPORT_COMMANDS.map((id) => command(id).title())).toEqual([
            "Export…",
            "Export Again",
            "Export Frame PNG…",
            "Export Sprite Sheet PNG…",
            "Export PNG Sequence…",
        ]);
        // One group of the menu: the hundreds of their orders are those of Export….
        const group = Math.floor(command("file.export").menuOrder / 100);
        for (const id of EXPORT_COMMANDS) {
            expect(Math.floor(command(id).menuOrder / 100), id).toBe(group);
        }
    });

    it("bind Ctrl+E and Ctrl+Shift+E (SPEC §7.8, marked †: also in a text field)", () => {
        expect(command("file.export").shortcuts).toEqual(["Ctrl+E"]);
        expect(command("file.exportAgain").shortcuts).toEqual(["Ctrl+Shift+E"]);
        for (const id of ["file.export", "file.exportAgain"]) {
            expect(command(id).contexts, id).toEqual(["global", "text"]);
        }
        for (const id of EXPORT_COMMANDS.slice(2)) expect(command(id).shortcuts, id).toEqual([]);
    });

    it("need a document; not during a stroke; while a selection floats, which they apply first", () => {
        expect(enabled()).toEqual([]);
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "hero", width: 4, height: 3 }));
        expect(enabled()).toEqual(EXPORT_COMMANDS);
        const transaction = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        expect(enabled()).toEqual([]);
        // The transaction of a floating selection (SE-032): the `floating` context says so.
        setKeyContext("floating", true);
        expect(enabled()).toEqual(EXPORT_COMMANDS);
        setKeyContext("floating", false);
        transaction.abort();
        expect(enabled()).toEqual(EXPORT_COMMANDS);
    });

    it("wait while a file operation runs", async () => {
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "hero", width: 4, height: 3 }));
        paint(document, 1);
        const detach = fileDialogs.attachHost();
        try {
            const closing = fileWorkflows.close();
            expect(fileWorkflows.busy).toBe(true);
            expect(enabled()).toEqual([]);
            fileDialogs.store.getState().request?.answer(null);
            expect(await closing).toBe(false);
            expect(enabled()).toEqual(EXPORT_COMMANDS);
        } finally {
            detach();
        }
    });
});
