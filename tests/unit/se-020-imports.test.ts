import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as layers from "../../src/core/layers";

// `core/layers` builds on the public modules of `core` only: it reaches the model, the
// history, the compositor and the pixel helpers through their index, and nothing else. It
// shares no file with the frame, cel and tag commands of SE-021 (EXECUTION.md, Shared modules).

const layersDir = fileURLToPath(new URL("../../src/core/layers", import.meta.url));

const files = readdirSync(layersDir, { recursive: true, encoding: "utf8" }).filter((name) =>
    /\.tsx?$/.test(name),
);

/** Every module specifier a source file imports or re-exports, type-only ones included. */
function specifiers(file: string): string[] {
    const source = readFileSync(join(layersDir, file), "utf8");
    return ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName);
}

describe("core/layers imports", () => {
    it("finds the module's source files", () => {
        expect(files).toContain("index.ts");
        expect(files.length).toBeGreaterThanOrEqual(6);
    });

    it("imports its own files and the index of four core modules, nothing else", () => {
        const outside = new Set(
            files.flatMap((file) => specifiers(file)).filter((name) => !name.startsWith("./")),
        );

        expect([...outside].sort()).toEqual([
            "../composite",
            "../history",
            "../model",
            "../pixels",
        ]);
    });

    it("the scan sees a type-only import and a deep import", () => {
        const source = 'import type { A } from "../history/allocate";\n';
        const found = ts.preProcessFile(source, true, true).importedFiles.map((e) => e.fileName);
        expect(found).toEqual(["../history/allocate"]);
    });
});

describe("core/layers exports", () => {
    // Every export the module documents is there. A later ticket may add to them.
    it.each([
        "LayerError",
        "addLayerCommand",
        "canDeleteLayer",
        "deleteLayerCommand",
        "duplicateLayerCommand",
        "flattenCommand",
        "isLayerName",
        "mergeDownCommand",
        "mergeDownTarget",
        "nextLayerName",
        "normalizeLayerName",
        "renameLayerCommand",
        "reorderLayerCommand",
        "setLayerBlendModeCommand",
        "setLayerLockedCommand",
        "setLayerOpacityCommand",
        "setLayerVisibleCommand",
    ])("exports %s", (name) => {
        expect(layers).toHaveProperty(name);
        expect(typeof (layers as Record<string, unknown>)[name]).toBe("function");
    });
});
