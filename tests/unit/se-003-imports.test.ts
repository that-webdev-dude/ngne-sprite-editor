import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const coreDir = fileURLToPath(new URL("../../src/core", import.meta.url));
const modelDir = join(coreDir, "model");

const modelFiles = readdirSync(modelDir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(modelDir, name));

/** Every module specifier a source file imports or re-exports, type-only ones included. */
function specifiers(file: string): string[] {
    const source = readFileSync(file, "utf8");
    return ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName);
}

function insideCore(file: string, specifier: string): boolean {
    if (!specifier.startsWith(".")) return false;
    const target = relative(coreDir, resolve(dirname(file), specifier));
    return !target.startsWith("..") && !isAbsolute(target);
}

describe("core/model imports", () => {
    it("finds the model's source files", () => {
        const names = modelFiles.map((file) => relative(modelDir, file));
        expect(names).toContain("index.ts");
        expect(names).toContain("types.ts");
        expect(names.length).toBeGreaterThanOrEqual(7);
    });

    it("no file in core/model imports from outside core", () => {
        const outside = modelFiles.flatMap((file) =>
            specifiers(file)
                .filter((specifier) => !insideCore(file, specifier))
                .map((specifier) => `${relative(coreDir, file)} imports "${specifier}"`),
        );
        expect(outside).toEqual([]);
    });

    it("the check itself rejects packages and paths that leave core", () => {
        const file = join(modelDir, "probe.ts");
        expect(insideCore(file, "./types")).toBe(true);
        expect(insideCore(file, "../pixels/buffer")).toBe(true);
        expect(insideCore(file, "../../app/store")).toBe(false);
        expect(insideCore(file, "../../core-extra/x")).toBe(false);
        expect(insideCore(file, "fast-png")).toBe(false);
        expect(insideCore(file, "node:fs")).toBe(false);
        expect(insideCore(file, "@ngne/core")).toBe(false);
    });

    it("the scan sees type-only imports, re-exports and dynamic imports", () => {
        const source = [
            'import type { A } from "./a";',
            'export * from "./b";',
            'export type * from "./c";',
            'import "./d";',
            'const e = await import("./e");',
        ].join("\n");
        const found = ts.preProcessFile(source, true, true).importedFiles.map((e) => e.fileName);
        expect(found).toEqual(["./a", "./b", "./c", "./d", "./e"]);
    });
});
