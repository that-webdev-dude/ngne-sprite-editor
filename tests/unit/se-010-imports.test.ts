import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The cache takes the `touched` shape of the document model (SE-003) and does not depend on
// the history that produces it (SE-010 scope).

const compositeDir = fileURLToPath(new URL("../../src/core/composite", import.meta.url));

const files = readdirSync(compositeDir, { recursive: true, encoding: "utf8" }).filter((name) =>
    /\.tsx?$/.test(name),
);

/** Every module specifier a source file imports or re-exports, type-only ones included. */
function specifiers(file: string): string[] {
    const source = readFileSync(join(compositeDir, file), "utf8");
    return ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName);
}

describe("core/composite imports", () => {
    it("finds the compositor's source files", () => {
        for (const name of ["blend.ts", "cache.ts", "compositeFrame.ts", "index.ts"]) {
            expect(files).toContain(name);
        }
    });

    it("no file in core/composite imports the history", () => {
        const imported = files.flatMap((file) =>
            specifiers(file).map((specifier) => `${file} imports "${specifier}"`),
        );

        expect(imported).toContain('cache.ts imports "../model"');
        expect(imported.filter((line) => /history/i.test(line))).toEqual([]);
    });

    it("the scan sees a type-only import of the history", () => {
        const source = 'import type { Command } from "../history";\n';
        const found = ts.preProcessFile(source, true, true).importedFiles.map((e) => e.fileName);
        expect(found).toEqual(["../history"]);
    });
});
