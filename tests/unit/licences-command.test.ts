import { describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu } from "../../src/app/commands/menuModel";
import type { MenuNode } from "../../src/app/commands/menuModel";
import { LICENCES_COMMAND } from "../../src/app/licences/licences.commands";
import { LICENCES_PATH, openLicences } from "../../src/app/licences/openLicences";
import type { LicencesHost, LicencesTab } from "../../src/app/licences/openLicences";

// The Open Source Licences command (src/app/licences): where it is, and how it shows the
// licences file the build writes.

/** The ids of a menu's commands, with "---" for a separator. */
function outline(nodes: readonly MenuNode[]): string[] {
    return nodes.map((node) => (node.kind === "command" ? node.command.id : "---"));
}

/** A host that records what the command does; `text` is what the fetch gives. */
function fakeHost(
    text: string | null,
    tab: LicencesTab | null = { location: { href: "" }, opener: {} },
) {
    const log: string[] = [];
    const host: LicencesHost = {
        baseUrl: "https://example.test/sub/path/index.html?x=1",
        openTab: () => {
            log.push("open");
            return tab;
        },
        fetchText: async (url) => {
            log.push(`fetch ${url}`);
            return text;
        },
        textUrl: (value) => {
            log.push(`text ${value}`);
            return "blob:https://example.test/1";
        },
        releaseLater: (url) => void log.push(`release ${url}`),
    };
    return { host, log, tab };
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
        expect(command?.title()).toBe("Open Source Licences");
        // Always available: it needs no document.
        expect(command?.enabled()).toBe(true);
        expect(outline(buildMenu(appCommands.list(), ["View"])).slice(-2)).toEqual([
            "---",
            LICENCES_COMMAND,
        ]);
    });
});

describe("openLicences", () => {
    it("opens a tab first, then shows the fetched file there as plain text", async () => {
        const { host, log, tab } = fakeHost("Licences\n");
        expect(await openLicences(host)).toBe(true);
        // The tab before any wait, so the browser counts it as the user's.
        expect(log).toEqual([
            "open",
            "fetch https://example.test/sub/path/licences.txt",
            "text Licences\n",
            "release blob:https://example.test/1",
        ]);
        expect(tab?.location.href).toBe("blob:https://example.test/1");
        // The file has no access to the editor's window.
        expect(tab?.opener).toBeNull();
        expect(LICENCES_PATH).toBe("licences.txt");
    });

    it("sends the tab to the file's address when the file cannot be fetched", async () => {
        const { host, log, tab } = fakeHost(null);
        expect(await openLicences(host)).toBe(true);
        expect(log).toEqual(["open", "fetch https://example.test/sub/path/licences.txt"]);
        expect(tab?.location.href).toBe("https://example.test/sub/path/licences.txt");
    });

    it("does nothing more when the browser refuses the tab", async () => {
        const { host, log } = fakeHost("Licences\n", null);
        expect(await openLicences(host)).toBe(false);
        expect(log).toEqual(["open"]);
    });
});
