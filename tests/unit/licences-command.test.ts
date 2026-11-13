import { describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu } from "../../src/app/commands/menuModel";
import type { MenuNode } from "../../src/app/commands/menuModel";
import { LICENCES_COMMAND } from "../../src/app/licences/licences.commands";
import {
    LICENCES_PATH,
    createLicencesDialogs,
    openLicences,
} from "../../src/app/licences/openLicences";
import type { LicencesHost } from "../../src/app/licences/openLicences";

// The Open Source Licences command (src/app/licences): where it is, and how it shows the
// licences file the build writes, in a dialog of the app.

/** The ids of a menu's commands, with "---" for a separator. */
function outline(nodes: readonly MenuNode[]): string[] {
    return nodes.map((node) => (node.kind === "command" ? node.command.id : "---"));
}

/** A host that records what the command does; `text` is what the fetch gives. */
function fakeHost(text: string | null) {
    const log: string[] = [];
    const host: LicencesHost = {
        baseUrl: "https://example.test/sub/path/index.html?x=1",
        fetchText: async (url) => {
            log.push(`fetch ${url}`);
            return text;
        },
        show: async (shown, address) => {
            log.push(`show ${JSON.stringify(shown)} ${address}`);
        },
    };
    return { host, log };
}

describe("the Open Source Licences command", () => {
    it("is the last item of the View menu, in a group of its own, from a module of its own", () => {
        const command = appCommands.get(LICENCES_COMMAND);
        expect(command).toMatchObject({
            planned: false,
            menuPath: ["View"],
            shortcuts: [],
            source: "../licences/licences.commands.ts",
        });
        expect(command?.title()).toBe("Open Source Licences…");
        // Always available: it needs no document.
        expect(command?.enabled()).toBe(true);
        expect(outline(buildMenu(appCommands.list(), ["View"])).slice(-2)).toEqual([
            "---",
            LICENCES_COMMAND,
        ]);
    });
});

describe("openLicences", () => {
    it("fetches the file beside the app and shows its text in the dialog", async () => {
        const { host, log } = fakeHost("Licences\n");
        await openLicences(host);
        expect(log).toEqual([
            "fetch https://example.test/sub/path/licences.txt",
            'show "Licences\\n" https://example.test/sub/path/licences.txt',
        ]);
        expect(LICENCES_PATH).toBe("licences.txt");
    });

    it("shows that the file could not be read, with its address, when the fetch fails", async () => {
        const { host, log } = fakeHost(null);
        await openLicences(host);
        expect(log).toEqual([
            "fetch https://example.test/sub/path/licences.txt",
            "show null https://example.test/sub/path/licences.txt",
        ]);
    });
});

describe("the licences dialog", () => {
    it("asks for a dialog of kind licences and resolves with null once it is closed", async () => {
        const dialogs = createLicencesDialogs();
        dialogs.attachHost();
        const shown = dialogs.show({ text: "Licences\n", address: "https://example.test/l" });
        const request = dialogs.store.getState().request;
        expect(request).toMatchObject({
            kind: "licences",
            text: "Licences\n",
            address: "https://example.test/l",
        });
        request?.answer(null);
        await expect(shown).resolves.toBeNull();
        expect(dialogs.store.getState().request).toBeNull();
    });

    it("is answered with null at once while no host shows it", async () => {
        const dialogs = createLicencesDialogs();
        await expect(dialogs.show({ text: "x", address: "y" })).resolves.toBeNull();
        expect(dialogs.store.getState().request).toBeNull();
    });
});
