import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ABOUT_COMMAND } from "@ngne/editor-ui/about";
import type { AppInfo } from "@ngne/editor-ui";
import { appInfo, versionLine } from "../../src/app/about/appInfo";
import { editorUi } from "../../src/app/editorUi";
import { paletteEntries } from "@ngne/editor-ui/commands";
import { appCommands } from "../../src/app/testing/pageModules";
import { buildMenu } from "@ngne/editor-ui/commands";
import type { MenuNode } from "@ngne/editor-ui/commands";
import { appInfoDefines } from "@ngne/editor-ui/about/build";

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
    packageName: "ngne-sprite-editor",
    version: "9.8.7",
    licence: "MIT",
    engine: { packageName: "@ngne/core", version: "6.5.4" },
    repositoryUrl: "https://example.test/repo",
    changelogUrl: "https://example.test/repo/CHANGELOG.md",
};

describe("the app's facts", () => {
    it("are package.json's name, version, licence and engine version, put in at build time", () => {
        expect(editorUi.config.productName).toBe("NGNE Sprite Editor");
        expect(appInfo).toMatchObject({
            packageName: pkg.name,
            version: pkg.version,
            licence: pkg.license,
            engine: { packageName: "@ngne/core", version: pkg.dependencies["@ngne/core"] },
            repositoryUrl: "https://github.com/that-webdev-dude/ngne-sprite-editor",
            changelogUrl:
                "https://github.com/that-webdev-dude/ngne-sprite-editor/blob/main/CHANGELOG.md",
        });
        expect(pkg.license).toBe("MIT");
    });

    it("are defined as JSON strings from package.json, for Vite and Vitest alike", () => {
        expect(appInfoDefines(join(ROOT, "package.json"))).toEqual({
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
            source: "@ngne/editor-ui/about/about.commands.ts",
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
        const entries = paletteEntries(appCommands.list(), appCommands.menus, [], "about");
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
        const entries = paletteEntries(
            appCommands.list(),
            appCommands.menus,
            [],
            "keyboard shortcuts",
        );
        expect(entries[0]).toMatchObject({ title: "Keyboard Shortcuts…", group: "Help" });
        expect(entries[0]?.command).toBe(appCommands.get("edit.shortcuts"));
    });
});
