import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/check-links.mjs", import.meta.url));

function fixture(files: Record<string, string>, verify: (root: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), "se-073-links-"));
    try {
        execFileSync("git", ["init", "--quiet", root]);
        for (const [path, content] of Object.entries(files)) {
            mkdirSync(join(root, path, ".."), { recursive: true });
            writeFileSync(join(root, path), content);
        }
        execFileSync("git", ["add", "."], { cwd: root });
        verify(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe("SE-073 documentation links", () => {
    it("every relative link and anchor in tracked Markdown resolves", () => {
        expect(
            execFileSync(process.execPath, [SCRIPT], {
                cwd: fileURLToPath(new URL("../../", import.meta.url)),
                encoding: "utf8",
            }),
        ).toMatch(/^Links OK: \d+ tracked Markdown files/);
    });

    it("checks GitHub slugs, collisions, Unicode, code headings, references, images and HTML", () => {
        fixture(
            {
                "README.md": [
                    "# Hello, `world`!",
                    "# Hello, world!",
                    "# Hello-world-1",
                    "# Café 日本語 → _x_ a_b",
                    "# `_literal_`",
                    "A setext heading",
                    "----------------",
                    '<a id="custom"></a>',
                    "[one](#hello-world) [two](#hello-world-1) [three](#hello-world-1-1)",
                    "[unicode](#caf%C3%A9-%E6%97%A5%E6%9C%AC%E8%AA%9E--x-a_b)",
                    "[setext](#a-setext-heading) [custom](#custom)",
                    "[code](#_literal_)",
                    "[inline](<docs/a (b).md#contents>) ![image](image.png)",
                    "[full][ref] [ref][] [ref] [parentheses](docs/a_(b).md)",
                    '[ref]: docs/a_(b).md#contents "Title"',
                    '<a href="docs/a_(b).md#contents">HTML</a>',
                    "[root](/docs/a_(b).md#contents) [query](docs/a_(b).md?raw=1#contents)",
                    "[external](https://invalid.example/#missing) [email](mailto:a@example.test)",
                    "`[not a link](missing.md)`",
                    "```md\n# Pretend\n[ignored](missing.md)\n```",
                    "~~~\n[ignored](missing.md)\n~~~",
                    "<!-- [ignored](missing.md) -->",
                    "",
                    "    [indented code](missing.md)",
                    "",
                    "> # Quoted heading",
                    "> [quote](#quoted-heading)",
                    "- Outer list",
                    "    - [nested](docs/a_(b).md#contents)",
                    "      [continuation](#hello-world)",
                    "",
                    "      ```md",
                    "      [nested code](missing.md)",
                    "      ```",
                ].join("\n"),
                "docs/a (b).md": "# Contents\n",
                "docs/a_(b).md": "# Contents\n",
                "image.png": "fixture",
            },
            (root) => {
                const result = spawnSync(process.execPath, [SCRIPT], {
                    cwd: root,
                    encoding: "utf8",
                });
                expect(result.stderr).toBe("");
                expect(result.status).toBe(0);
                expect(result.stdout).toContain("3 tracked Markdown files");
                // Untracked Markdown must not affect the result.
                writeFileSync(join(root, "untracked.md"), "[bad](missing.md)");
                expect(spawnSync(process.execPath, [SCRIPT], { cwd: root }).status).toBe(0);
            },
        );
    });

    it("lists every missing file and anchor with its source line and exits nonzero", () => {
        fixture(
            {
                "README.md":
                    "# Here\n[bad](gone.md)\n[bad](#absent)\n[bad][ref]\n[ref]: other.md#absent\n![bad](lost.png)\n<a href='other.md#missing'>bad</a>\n[bad](#pretend)\n```\n# Pretend\n```\n- Outer\n    - [bad nested](missing.md)\n      [bad continuation](#absent)\n> [bad quote](#absent)\n",
                "other.md": "# Exists\n",
            },
            (root) => {
                const result = spawnSync(process.execPath, [SCRIPT], {
                    cwd: root,
                    encoding: "utf8",
                });
                expect(result.status).toBe(1);
                for (const [line, target] of [
                    [2, "gone.md"],
                    [3, "#absent"],
                    [4, "other.md#absent"],
                    [5, "other.md#absent"],
                    [6, "lost.png"],
                    [7, "other.md#missing"],
                    [8, "#pretend"],
                    [13, "missing.md"],
                    [14, "#absent"],
                    [15, "#absent"],
                ]) {
                    expect(result.stderr).toContain(`README.md:${line}: ${target}`);
                }
            },
        );
    });
});
