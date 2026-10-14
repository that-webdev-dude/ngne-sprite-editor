import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import { activeDocument, isDirty, sessionsStore } from "../../src/app/state/sessions";
import { createDocument } from "../../src/core/model";

// SE-013: the grid toggles of the View menu, bound to `DocSettings.grid.visible` and
// `DocSettings.pixelGrid` of the active document. View preferences: no history entry, never
// dirty (SPEC §5.2).

const command = (id: string) => {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
};

function open(name = "hero") {
    return sessionsStore.getState().open(createDocument({ name, width: 16, height: 16 }));
}

const settings = () => {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document");
    return document.session.doc.settings;
};

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
});

describe("grid toggles", () => {
    it("take the View menu items planned for them, in their group, without a shortcut", () => {
        for (const [id, title] of [
            ["view.grid", "Grid"],
            ["view.pixelGrid", "Pixel Grid"],
        ] as const) {
            const toggle = command(id);
            expect(toggle.planned, id).toBe(false);
            expect(toggle.source).toMatch(/overlay\/grid\.commands\.ts$/);
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(plan?.title).toBe(title);
            expect(toggle.menuPath).toEqual(["View"]);
            expect(toggle.menuOrder).toBe(plan?.menuOrder);
            expect(toggle.shortcuts).toEqual([]);
        }
        const view = menuCommands(buildMenu(appCommands.list(), ["View"])).map((entry) => entry.id);
        expect(view.indexOf("view.pixelGrid")).toBe(view.indexOf("view.grid") + 1);
    });

    it("are disabled while no document is open", () => {
        expect(command("view.grid").enabled()).toBe(false);
        expect(command("view.pixelGrid").enabled()).toBe(false);
        expect(command("view.grid").title()).toBe("Show Grid");
        expect(command("view.pixelGrid").title()).toBe("Show Pixel Grid");
    });

    it("flip the setting of the active document, and their titles say what choosing them does", async () => {
        const document = open();
        const other = sessionsStore
            .getState()
            .open(createDocument({ name: "other", width: 4, height: 4 }), { activate: false });
        const grid = command("view.grid");
        const pixelGrid = command("view.pixelGrid");
        expect(grid.enabled() && pixelGrid.enabled()).toBe(true);
        // A new document: tile grid hidden, pixel grid shown (SPEC §5.1 defaults).
        expect([settings().grid.visible, settings().pixelGrid]).toEqual([false, true]);
        expect([grid.title(), pixelGrid.title()]).toEqual(["Show Grid", "Hide Pixel Grid"]);

        await grid.run();
        expect(settings().grid.visible).toBe(true);
        expect(grid.title()).toBe("Hide Grid");
        await pixelGrid.run();
        expect(settings().pixelGrid).toBe(false);
        expect(pixelGrid.title()).toBe("Show Pixel Grid");
        // Only the setting: the grid's size and offset stay.
        expect(settings().grid).toEqual({
            width: 16,
            height: 16,
            offsetX: 0,
            offsetY: 0,
            visible: true,
        });
        await grid.run();
        await pixelGrid.run();
        expect([settings().grid.visible, settings().pixelGrid]).toEqual([false, true]);

        // The other document's settings are its own.
        expect(other.session.doc.settings.grid.visible).toBe(false);
        expect(other.session.doc.settings.pixelGrid).toBe(true);
        expect(document.id).toBe(sessionsStore.getState().activeId);
    });

    it("make no history entry and leave the document clean", async () => {
        const document = open();
        const { history } = document;
        const position = history.position;
        await command("view.grid").run();
        await command("view.pixelGrid").run();
        const now = activeDocument(sessionsStore.getState());
        expect(history.position).toBe(position);
        expect(history.canUndo).toBe(false);
        expect(now && isDirty(now)).toBe(false);
    });
});
