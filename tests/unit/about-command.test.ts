import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ABOUT_COMMAND } from "../../src/app/about/about.commands";
import { appInfo, versionLine } from "../../src/app/about/appInfo";
import type { AppInfo } from "../../src/app/about/appInfo";
import { createAboutDialogs, openAbout } from "../../src/app/about/openAbout";
import type { AboutHost, AboutRequest } from "../../src/app/about/openAbout";
import { paletteEntries } from "../../src/app/commandPalette/paletteModel";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu } from "../../src/app/commands/menuModel";
import type { MenuNode } from "../../src/app/commands/menuModel";
import { ENGINE_PACKAGE, appInfoDefines } from "../../scripts/appInfo";

// Help → About NGNE Sprite Editor… (src/app/about): where it is, the facts it shows, which
// package.json gives at build time, and Copy version info.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license: string;
    dependencies: Record<string, string>;
};

/** The ids of a menu's commands, with "---" for a separator. */
function outline(nodes: readonly MenuNode[]): string[] {
    return nodes.map((node) => (node.kind === "command" ? node.command.id : "---"));
}

const INFO: AppInfo = {
    title: "NGNE Sprite Editor",
    packageName: "ngne-sprite-editor",
    version: "9.8.7",
    licence: "MIT",
    engine: { packageName: "@ngne/core", version: "6.5.4" },
    repositoryUrl: "https://example.test/repo",
    changelogUrl: "https://example.test/repo/CHANGELOG.md",
};

/** A host that records what the command does; `write` is what the clipboard does. */
function fakeHost(write: (text: string) => Promise<unknown>) {
    const written: string[] = [];
    const shown: Omit<AboutRequest, "kind" | "answer">[] = [];
    const host: AboutHost = {
        userAgent: "TestAgent/1.0",
        writeText: async (text) => {
            written.push(text);
            return write(text);
        },
        show: async (options) => {
            shown.push(options);
        },
    };
    return { host, written, shown };
}

describe("the app's facts", () => {
    it("are package.json's name, version, licence and engine version, put in at build time", () => {
        expect(appInfo).toMatchObject({
            title: "NGNE Sprite Editor",
            packageName: pkg.name,
            version: pkg.version,
            licence: pkg.license,
            engine: { packageName: "@ngne/core", version: pkg.dependencies["@ngne/core"] },
            repositoryUrl: "https://github.com/that-webdev-dude/ngne-sprite-editor",
            changelogUrl:
                "https://github.com/that-webdev-dude/ngne-sprite-editor/blob/main/CHANGELOG.md",
        });
        expect(pkg.license).toBe("MIT");
        expect(ENGINE_PACKAGE).toBe("@ngne/core");
    });

    it("are defined as JSON strings from package.json, for Vite and Vitest alike", () => {
        expect(appInfoDefines(ROOT)).toEqual({
            "import.meta.env.APP_PACKAGE": JSON.stringify(pkg.name),
            "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
            "import.meta.env.APP_LICENSE": JSON.stringify(pkg.license),
            "import.meta.env.ENGINE_PACKAGE": JSON.stringify("@ngne/core"),
            "import.meta.env.ENGINE_VERSION": JSON.stringify(pkg.dependencies["@ngne/core"]),
        });
    });

    it("are not written into the sources: no file under src has either version as a literal", () => {
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name);
                if (statSync(path).isDirectory()) walk(path);
                else files.push(path);
            }
        };
        walk(join(ROOT, "src"));
        // A version alone between quotes of any kind: "1.0.2", '1.0.2', `1.0.2`.
        const literals = [pkg.version, pkg.dependencies["@ngne/core"]!].map(
            (version) => new RegExp(`(["'\`])${version.replaceAll(".", "\\.")}\\1`),
        );
        const holding = files.filter((file) => {
            const text = readFileSync(file, "utf8");
            return literals.some((literal) => literal.test(text));
        });
        // The check finds such a literal.
        expect(literals[0]!.test(`x = '${pkg.version}';`)).toBe(true);
        expect(holding).toEqual([]);
    });

    it("make the one line Copy version info copies", () => {
        expect(versionLine(INFO, "TestAgent/1.0")).toBe(
            "ngne-sprite-editor 9.8.7 · @ngne/core 6.5.4 · TestAgent/1.0",
        );
    });
});

describe("the About command", () => {
    it("is the last item of the Help menu, below Keyboard Shortcuts…", () => {
        const command = appCommands.get(ABOUT_COMMAND);
        expect(command).toMatchObject({
            planned: false,
            menuPath: ["Help"],
            shortcuts: [],
            source: "../about/about.commands.ts",
        });
        expect(ABOUT_COMMAND).toBe("help.about");
        expect(command?.title()).toBe("About NGNE Sprite Editor…");
        // Always available: it needs no document.
        expect(command?.enabled()).toBe(true);
        expect(outline(buildMenu(appCommands.list(), ["Help"]))).toEqual([
            "edit.shortcuts",
            "---",
            ABOUT_COMMAND,
        ]);
    });

    it("is listed by the command palette, under Help", () => {
        const entries = paletteEntries(appCommands.list(), [], "about");
        expect(entries[0]).toMatchObject({
            title: "About NGNE Sprite Editor…",
            group: "Help",
        });
        expect(entries[0]?.command).toBe(appCommands.get(ABOUT_COMMAND));
    });

    it("has Keyboard Shortcuts… in the Help menu, on ?", () => {
        expect(appCommands.get("edit.shortcuts")).toMatchObject({
            menuPath: ["Help"],
            shortcuts: ["?"],
        });
    });

    it("lists Keyboard Shortcuts… in the command palette, under Help", () => {
        const entries = paletteEntries(appCommands.list(), [], "keyboard shortcuts");
        expect(entries[0]).toMatchObject({ title: "Keyboard Shortcuts…", group: "Help" });
        expect(entries[0]?.command).toBe(appCommands.get("edit.shortcuts"));
    });
});

describe("openAbout", () => {
    it("shows the facts and the version line of the browser", async () => {
        const { host, shown, written } = fakeHost(async () => undefined);
        await openAbout(host, INFO);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toMatchObject({
            info: INFO,
            versionLine: "ngne-sprite-editor 9.8.7 · @ngne/core 6.5.4 · TestAgent/1.0",
        });
        // Nothing is copied until asked.
        expect(written).toEqual([]);
    });

    it("copies the version line, and answers whether that worked", async () => {
        const { host, shown, written } = fakeHost(async () => undefined);
        await openAbout(host, INFO);
        await expect(shown[0]!.copy()).resolves.toBe(true);
        expect(written).toEqual(["ngne-sprite-editor 9.8.7 · @ngne/core 6.5.4 · TestAgent/1.0"]);
    });

    it("answers false, without throwing, when the clipboard refuses or is missing", async () => {
        const refused = fakeHost(() =>
            Promise.reject(new DOMException("Denied", "NotAllowedError")),
        );
        await openAbout(refused.host, INFO);
        await expect(refused.shown[0]!.copy()).resolves.toBe(false);

        const missing = fakeHost(async () => false);
        await openAbout(missing.host, INFO);
        await expect(missing.shown[0]!.copy()).resolves.toBe(false);
    });
});

describe("the About dialog", () => {
    it("asks for a dialog of kind about and resolves with null once it is closed", async () => {
        const dialogs = createAboutDialogs();
        dialogs.attachHost();
        const copy = async () => true;
        const shown = dialogs.show({ info: INFO, versionLine: "line", copy });
        const request = dialogs.store.getState().request;
        expect(request).toMatchObject({ kind: "about", info: INFO, versionLine: "line", copy });
        request?.answer(null);
        await expect(shown).resolves.toBeNull();
        expect(dialogs.store.getState().request).toBeNull();
    });

    it("is answered with null at once while no host shows it", async () => {
        const dialogs = createAboutDialogs();
        await expect(
            dialogs.show({ info: INFO, versionLine: "line", copy: async () => true }),
        ).resolves.toBeNull();
        expect(dialogs.store.getState().request).toBeNull();
    });
});
