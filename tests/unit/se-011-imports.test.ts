import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// SE-011: only `src/engine` imports `@ngne/core` (SPEC §5), and the parts of the viewport
// that are tested without a renderer do not reach NGNE through another module.

const srcDir = fileURLToPath(new URL("../../src", import.meta.url));

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
        for (const name of [
            "app/viewport/viewportController.ts",
            "core/composite/cache.ts",
            "engine/NgneViewport.ts",
            "engine/UploadQueue.ts",
            "engine/viewport/rendererInstance.ts",
            "ui/viewport/ViewportCanvas.tsx",
        ]) {
            expect(files).toContain(name);
        }
    });

    it("only src/engine imports @ngne/core", () => {
        const importers = files.filter((file) => specifiers(file).some(isNgne));
        expect(importers).toContain("engine/viewport/rendererInstance.ts");
        expect(importers.filter((file) => !file.startsWith("engine/"))).toEqual([]);
    });

    it("the scan sees a type-only import and a re-export of @ngne/core", () => {
        const source =
            'import type { Frame } from "@ngne/core";\nexport { Camera } from "@ngne/core";\n';
        const found = ts.preProcessFile(source, true, true).importedFiles.map((e) => e.fileName);
        expect(found.filter(isNgne)).toEqual(["@ngne/core", "@ngne/core"]);
    });

    it("the upload queue and the viewport's pure modules import neither NGNE nor the interface", () => {
        const pure = [
            "engine/UploadQueue.ts",
            "engine/viewport/checker.ts",
            "engine/viewport/diagnostics.ts",
            "engine/viewport/frameSlots.ts",
            "engine/viewport/geometry.ts",
            "engine/viewport/types.ts",
        ];
        for (const file of pure) {
            const imported = specifiers(file);
            expect(imported.filter(isNgne)).toEqual([]);
            expect(imported.filter((name) => /(^|\/)(app|ui)(\/|$)|^react/.test(name))).toEqual([]);
        }
    });

    it("the wiring in src/app reaches the viewport through its types, not through NGNE", () => {
        expect(specifiers("app/viewport/viewportController.ts")).toContain(
            "../../engine/viewport/types",
        );
        expect(
            specifiers("app/viewport/viewportController.ts").filter((name) =>
                /NgneViewport|rendererInstance/.test(name),
            ),
        ).toEqual([]);
    });

    it("src/engine does not import the interface", () => {
        const engine = files.filter((file) => file.startsWith("engine/"));
        const imported = engine.flatMap((file) =>
            specifiers(file).map((specifier) => `${file} imports "${specifier}"`),
        );
        expect(imported.filter((line) => /"(\.\.\/)+(app|ui)\//.test(line))).toEqual([]);
        expect(imported.filter((line) => /"react/.test(line))).toEqual([]);
    });
});
