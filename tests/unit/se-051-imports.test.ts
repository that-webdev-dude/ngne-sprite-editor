import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as exporting from "../../src/core/export";
import { PROJECT_GENERATOR } from "../../src/core/project";
import { heroWalk } from "./se-051-support";

// SE-051 lives in `src/core`: no DOM, no React, no engine (SPEC §5). The generated module
// imports `@ngne/core`; the code that writes it does not.

const coreDir = fileURLToPath(new URL("../../src/core", import.meta.url));
const exportDir = join(coreDir, "export");

const files = readdirSync(exportDir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .sort();

/** Every module specifier a source file imports or re-exports, type-only ones included. */
function specifiers(file: string): string[] {
    const source = readFileSync(join(exportDir, file), "utf8");
    return ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName);
}

function insideCore(file: string, specifier: string): boolean {
    if (!specifier.startsWith(".")) return false;
    const target = relative(coreDir, resolve(dirname(join(exportDir, file)), specifier));
    return !target.startsWith("..") && !isAbsolute(target);
}

describe("core/export imports", () => {
    it("finds the module's source files", () => {
        expect(files).toEqual([
            "atlasFor.ts",
            "atlasFormat.ts",
            "bundle.ts",
            "errors.ts",
            "exportPlan.ts",
            "index.ts",
            "names.ts",
            "pack.ts",
            "packErrors.ts",
            "sprite-runtime.ts",
            "spritesModule.ts",
            "validateAtlas.ts",
            "writers.ts",
        ]);
    });

    it("imports nothing from outside core: no engine, no React, no package", () => {
        const outside = files.flatMap((file) =>
            specifiers(file)
                .filter((specifier) => !insideCore(file, specifier))
                .map((specifier) => `${file} imports "${specifier}"`),
        );
        expect(outside).toEqual([]);
    });

    it("names @ngne/core only in the text of the module it generates", () => {
        const mentions = files.filter((file) =>
            readFileSync(join(exportDir, file), "utf8").includes('"@ngne/core"'),
        );
        expect(mentions).toEqual(["spritesModule.ts"]);
        expect(specifiers("spritesModule.ts")).not.toContain("@ngne/core");
    });

    it("the sprite runtime imports nothing at all", () => {
        expect(specifiers("sprite-runtime.ts")).toEqual([]);
    });

    it("reads the sprite runtime as text in one place, and as code elsewhere", () => {
        const raw = files.filter((file) =>
            specifiers(file).some((specifier) => specifier.endsWith("?raw")),
        );
        expect(raw).toEqual(["spritesModule.ts"]);
        expect(specifiers("spritesModule.ts")).toContain("./sprite-runtime.ts?raw");
        // Never by turning a function into text.
        for (const file of files) {
            expect(readFileSync(join(exportDir, file), "utf8"), file).not.toMatch(
                /\.toString\(\)|Function\(/,
            );
        }
    });

    it("builds on the compositor, the tag expansion, the PNG codec and the packer", () => {
        expect(specifiers("bundle.ts")).toContain("../composite");
        expect(specifiers("bundle.ts")).toContain("../png");
        expect(specifiers("atlasFor.ts")).toContain("../animation");
        expect(specifiers("atlasFor.ts")).toContain("./pack");
    });

    it("uses no clock, no random number and no locale", () => {
        for (const file of files) {
            const source = readFileSync(join(exportDir, file), "utf8");
            expect(source, file).not.toMatch(
                /\bDate\b|Math\.random|performance\.|toLocale|\bIntl\b|crypto\./,
            );
        }
    });
});

describe("core/export API", () => {
    it("exports its functions, its errors and the constants of the format, and nothing else", () => {
        const names = Object.keys(exporting).sort();

        expect(names.filter((name) => typeof Reflect.get(exporting, name) === "function")).toEqual([
            "AtlasError",
            "ExportError",
            "PackError",
            "animationDone",
            "animationFrame",
            "animationIds",
            "atlasFor",
            "bundle",
            "bundleFileNames",
            "exportFrameIndices",
            "exportIdentifiers",
            "exportName",
            "isAtlasId",
            "pack",
            "spriteAt",
            "spriteAtTopLeft",
            "validateAtlas",
        ]);
        expect(names.filter((name) => typeof Reflect.get(exporting, name) !== "function")).toEqual([
            "ATLAS_FORMAT",
            "ATLAS_GENERATOR",
            "ATLAS_VERSION",
            "MAX_ATLAS_ENTRIES",
            "MAX_ATLAS_EXTRUDE",
            "MAX_ATLAS_FRAMES",
            "MAX_ATLAS_ID_LENGTH",
            "MAX_ATLAS_PADDING",
            "MAX_ATLAS_SIDE",
            "MAX_ENTRY_MS",
            "MAX_SLUG_LENGTH",
        ]);
    });

    it("names the format as SPEC §9.2 does", () => {
        expect(exporting.ATLAS_FORMAT).toBe("ngne-sprite-atlas");
        expect(exporting.ATLAS_VERSION).toBe(1);
    });

    it("writes the application's name and version as the generator", () => {
        const packageJson = JSON.parse(
            readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
        ) as { name: string; version: string };

        // When this fails after a version change, update ATLAS_GENERATOR in
        // src/core/export/atlasFormat.ts. Files already written keep the generator they have.
        expect(exporting.ATLAS_GENERATOR).toBe(`${packageJson.name} ${packageJson.version}`);
        // One application: the project file names it the same way.
        expect(exporting.ATLAS_GENERATOR).toBe(PROJECT_GENERATOR);
        expect(exporting.bundle(heroWalk()).meta.generator).toBe(exporting.ATLAS_GENERATOR);
    });
});

describe("core/export environment", () => {
    it("runs under Vitest in Node without a DOM", () => {
        expect(typeof process.versions.node).toBe("string");
        expect(typeof window).toBe("undefined");
        expect(typeof document).toBe("undefined");
        expect(typeof ImageData).toBe("undefined");
        expect(typeof createImageBitmap).toBe("undefined");

        const made = exporting.bundle(heroWalk());
        for (const file of made.files) {
            expect(file.bytes).toBeInstanceOf(Uint8Array);
            // An array of exactly the file's length.
            expect([file.bytes.byteOffset, file.bytes.buffer.byteLength], file.name).toEqual([
                0,
                file.bytes.length,
            ]);
        }
    });

    it("bundle and atlasFor return at once: no promise", () => {
        expect(exporting.bundle(heroWalk())).not.toBeInstanceOf(Promise);
    });
});
