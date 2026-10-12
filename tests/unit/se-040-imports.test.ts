import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as project from "../../src/core/project";
import { expectSamePixels, fixtureDocument, fixtureSources } from "./se-040-support";

const coreDir = fileURLToPath(new URL("../../src/core", import.meta.url));
const projectDir = join(coreDir, "project");

const files = readdirSync(projectDir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(projectDir, name));

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

describe("core/project imports", () => {
    it("finds the module's source files", () => {
        const names = files.map((file) => relative(projectDir, file));
        for (const name of ["index.ts", "serialize.ts", "deserialize.ts", "zip.ts"]) {
            expect(names).toContain(name);
        }
    });

    it("imports nothing but core and fflate", () => {
        const outside = new Set(
            files.flatMap((file) =>
                specifiers(file).filter((specifier) => !insideCore(file, specifier)),
            ),
        );
        // The zip dependency of SPEC §4, and only in the container.
        expect([...outside]).toEqual(["fflate"]);
        const users = files.filter((file) => specifiers(file).includes("fflate"));
        expect(users.map((file) => relative(projectDir, file))).toEqual(["zip.ts"]);
    });

    it("builds on the model, the PNG codec and the compositor of core", () => {
        const imported = new Set(files.flatMap(specifiers));
        for (const specifier of ["../model", "../png", "../composite", "../pixels"]) {
            expect(imported).toContain(specifier);
        }
    });
});

describe("core/project API", () => {
    it("exports its functions, its error and the constants a caller needs, and nothing else", () => {
        const names = Object.keys(project).sort();

        expect(names.filter((name) => typeof Reflect.get(project, name) === "function")).toEqual([
            "ProjectError",
            "deserialize",
            "docFromJson",
            "docToJson",
            "isProjectId",
            "projectThumbnail",
            "serialize",
        ]);
        expect(names.filter((name) => typeof Reflect.get(project, name) !== "function")).toEqual([
            "MAX_ID_LENGTH",
            "MAX_PROJECT_FRAMES",
            "MAX_PROJECT_LAYERS",
            "MAX_PROJECT_PIXEL_BYTES",
            "MAX_PROJECT_TAGS",
            "MAX_REFERENCE_SOURCE_BYTES",
            "PROJECT_FILE_EXTENSION",
            "PROJECT_FORMAT",
            "PROJECT_GENERATOR",
            "PROJECT_VERSION",
            "THUMBNAIL_MAX_SIDE",
        ]);
    });

    it("names the format as SPEC §10 does", () => {
        expect(project.PROJECT_FORMAT).toBe("ngne-sprite-project");
        expect(project.PROJECT_VERSION).toBe(1);
        expect(project.PROJECT_FILE_EXTENSION).toBe(".ngsprite");
    });

    it("writes the application's name and version as the generator", () => {
        const packageJson = JSON.parse(
            readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
        ) as { name: string; version: string };

        // When this fails after a version change, update PROJECT_GENERATOR in
        // src/core/project/format.ts. Files already written keep the generator they have.
        expect(project.PROJECT_GENERATOR).toBe(`${packageJson.name} ${packageJson.version}`);
    });

    it("gives its error a name, a code and the entry at fault", () => {
        const cause = new Error("inner");
        const error = new project.ProjectError("corrupt-entry", "Entry is damaged.", {
            entry: "doc.json",
            cause,
        });

        expect(error).toBeInstanceOf(Error);
        expect([error.name, error.code, error.entry, error.message]).toEqual([
            "ProjectError",
            "corrupt-entry",
            "doc.json",
            "Entry is damaged.",
        ]);
        expect(error.cause).toBe(cause);
        const plain = new project.ProjectError("not-a-zip", "Not a zip.");
        expect([plain.entry, plain.cause]).toEqual([undefined, undefined]);
        expect("cause" in plain).toBe(false);
    });
});

describe("core/project environment", () => {
    it("runs under Vitest in Node without a DOM", async () => {
        expect(typeof process.versions.node).toBe("string");
        expect(typeof window).toBe("undefined");
        expect(typeof document).toBe("undefined");
        expect(typeof ImageData).toBe("undefined");
        expect(typeof HTMLCanvasElement).toBe("undefined");
        expect(typeof createImageBitmap).toBe("undefined");

        const bytes = project.serialize(fixtureDocument(), fixtureSources());
        expect(bytes).toBeInstanceOf(Uint8Array);
        // An array of exactly the file's length.
        expect([bytes.byteOffset, bytes.buffer.byteLength]).toEqual([0, bytes.length]);
        const read = await project.deserialize(bytes);
        expect(read.doc).toEqual(fixtureDocument());
        expectSamePixels(read.doc, fixtureDocument());
    });

    it("deserialize returns a promise and serialize returns at once", () => {
        const bytes = project.serialize(fixtureDocument(), fixtureSources());
        const pending = project.deserialize(bytes);
        expect(pending).toBeInstanceOf(Promise);
        return pending;
    });
});
