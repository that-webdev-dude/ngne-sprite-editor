import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// SE-011: only `src/engine` imports `@ngne/core` (SPEC §5). The rule is checked on the import
// statements of every source file; no path is pinned, so files may move and be added.

const srcDir = fileURLToPath(new URL("../../src", import.meta.url));

/** Every source file, as a path from `src` with forward slashes. */
const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => name.replaceAll("\\", "/"));

/** Every module specifier a source file imports or re-exports, type-only ones included. */
function specifiers(file: string): string[] {
    const source = readFileSync(join(srcDir, file), "utf8");
    return ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName);
}

const isNgne = (specifier: string) => specifier === "@ngne/core" || specifier.startsWith("@ngne/");

describe("@ngne/core imports", () => {
    it("finds the source files of every layer", () => {
        for (const layer of ["app", "core", "engine", "ui"]) {
            expect(files.filter((file) => file.startsWith(`${layer}/`)).length).toBeGreaterThan(3);
        }
    });

    it("only src/engine imports @ngne/core", () => {
        const importers = files.filter((file) => specifiers(file).some(isNgne));
        // The scan does find the engine's own imports.
        expect(importers.length).toBeGreaterThan(0);
        expect(importers.filter((file) => !file.startsWith("engine/"))).toEqual([]);
    });

    it("the scan sees a type-only import, a re-export and a dynamic import of @ngne/core", () => {
        const source = [
            'import type { Frame } from "@ngne/core";',
            'export { Camera } from "@ngne/core";',
            'export const later = () => import("@ngne/core");',
        ].join("\n");
        const found = ts.preProcessFile(source, true, true).importedFiles.map((e) => e.fileName);
        expect(found.filter(isNgne)).toEqual(["@ngne/core", "@ngne/core", "@ngne/core"]);
    });
});
