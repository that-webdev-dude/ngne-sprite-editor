import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertInvariants } from "../../src/core/model";
import {
    MAX_DOC_JSON_BYTES,
    MAX_ID_LENGTH,
    MAX_MANIFEST_BYTES,
    MAX_NAME_LENGTH,
    MAX_PROJECT_CELS,
    MAX_PROJECT_CONTENT_BYTES,
    MAX_PROJECT_ENTRIES,
    MAX_PROJECT_FRAMES,
    MAX_PROJECT_IMAGES,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_PALETTE_COLORS,
    MAX_PROJECT_PIXEL_BYTES,
    MAX_PROJECT_REFERENCE_LAYERS,
    MAX_PROJECT_TAGS,
    MAX_REFERENCE_OFFSET,
    MAX_REFERENCE_SCALE,
    MAX_REFERENCE_SOURCE_BYTES,
    MIN_REFERENCE_SCALE,
    PROJECT_FILE_EXTENSION,
    PROJECT_FORMAT,
    PROJECT_VERSION,
    THUMBNAIL_MAX_SIDE,
    deserialize,
    docFromJson,
    docToJson,
    serialize,
} from "../../src/core/project";
import type { DocJson } from "../../src/core/project";
import { readManifest } from "../../src/core/project/manifest";
import { MAX_TAG_REPEAT } from "../../src/core/tags";
import { REFERENCE_PNG, fixtureDocJson, noiseImage } from "./se-040-support";

// docs/FORMAT.md is what another program is written against, so what section 1 of it shows
// and states about the sprite project is held to the code here. The file has a section per
// format: nothing below looks at another section, or counts on there being none.

const file = readFileSync(new URL("../../docs/FORMAT.md", import.meta.url), "utf8");

const HEADING = `## 1. Sprite project (\`${PROJECT_FILE_EXTENSION}\`), version 1`;

/** Section 1: from its heading to the next heading of the same level, or to the end. */
const section = (() => {
    const start = file.indexOf(`\n${HEADING}\n`);
    if (start === -1) return "";
    const next = file.indexOf("\n## ", start + 1);
    return file.slice(start + 1, next === -1 ? undefined : next);
})();

/** The JSON code blocks of section 1, parsed, in order. */
const examples = [...section.matchAll(/```json\n(.*?)```/gs)].map(
    (match) => JSON.parse(match[1]) as unknown,
);

/** A number as the document writes it: digits in groups of three. */
function grouped(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+$)/g, " ");
}

/** The rows of the tables of section 1 that start with this cell. */
function rows(firstCell: string): string[] {
    return section.split("\n").filter((line) => line.startsWith(`| ${firstCell} `));
}

describe("docs/FORMAT.md, sprite project version 1", () => {
    it("is section 1 of a document with a title and a table of formats", () => {
        expect(file.startsWith("# NGNE Sprite Editor — File formats\n")).toBe(true);
        expect(section.startsWith(`${HEADING}\n`)).toBe(true);
        // The table of formats, above the sections, has a row that points to this one.
        const head = file.slice(0, file.indexOf(`\n${HEADING}\n`));
        expect(head).toContain("| Format ");
        expect(head).toMatch(/\| NGNE sprite project \| `<name>\.ngsprite` +\| 1 +\| \[1\]\(#1-/);
        expect(section).toContain(`"${PROJECT_FORMAT}"`);
        expect(PROJECT_VERSION).toBe(1);
    });

    it("keeps the rules of this format in its own section", () => {
        // What is shared by every format is how the tables are to be read, and no more.
        const start = file.indexOf("\n## Conventions\n");
        const shared = file.slice(start, file.indexOf("\n## ", start + 1));
        expect(start).toBeGreaterThan(-1);
        expect(shared).toContain("Shared by every format");
        for (const rule of ["refuses", "byte order mark", "#rrggbbaa", "UTF-16", "indent"]) {
            expect(shared, rule).not.toContain(rule);
        }
        // The rules a reader of a project follows stand in section 1.
        expect(section).toContain("A reader refuses an entry with a missing or an unknown member");
        expect(section).toContain(
            "a reader refuses\n  an entry in which an object has two members of the same name",
        );
        expect(section).toContain("byte order mark; a reader skips one");
        expect(section).toContain("`#rrggbbaa`");
    });

    it("shows a manifest.json that the reader accepts", () => {
        // The examples of this section: the manifest and the document.
        expect(examples).toHaveLength(2);
        const manifest = readManifest(examples[0]);

        expect([manifest.format, manifest.version]).toEqual([PROJECT_FORMAT, PROJECT_VERSION]);
        expect(Object.keys(examples[0] as object)).toEqual(["format", "version", "generator"]);
    });

    it("shows a doc.json that the reader accepts and the writer reproduces", async () => {
        const example = examples[1] as DocJson;
        const images = new Map([
            ["image-bg", noiseImage(1)],
            ["image-body", noiseImage(2)],
        ]);
        const doc = docFromJson(example, images);

        assertInvariants({
            doc,
            selection: null,
            activeLayerId: "layer-bg",
            activeFrameId: "frame-1",
        });
        // Field for field and in the order the writer uses.
        expect(JSON.stringify(docToJson(doc))).toBe(JSON.stringify(example));
        // The example has every member the fixture's doc.json has, at every level.
        const members = (value: unknown, path = ""): string[] =>
            typeof value !== "object" || value === null
                ? []
                : Object.entries(value).flatMap(([key, item]) => {
                      const name = Array.isArray(value) ? `${path}[]` : `${path}.${key}`;
                      return [name, ...members(item, name)];
                  });
        expect([...new Set(members(example))].sort()).toEqual(
            [...new Set(members(fixtureDocJson()))].sort(),
        );

        // As a file, with the entries the text lists.
        const bytes = serialize(doc, new Map([["source-sketch", REFERENCE_PNG]]));
        expect((await deserialize(bytes)).doc).toEqual(doc);
    });

    it("states the limits the code enforces", () => {
        const limit = (what: string): string => {
            const found = rows(what);
            expect(found, what).toHaveLength(1);
            return found[0].split("|")[2].trim();
        };

        expect(limit("Layers")).toBe(
            `${MAX_PROJECT_LAYERS}, of which at most ${MAX_PROJECT_REFERENCE_LAYERS} reference layers`,
        );
        expect(limit("Frames")).toBe(grouped(MAX_PROJECT_FRAMES));
        expect(limit("Tags")).toBe(String(MAX_PROJECT_TAGS));
        expect(limit("Cels")).toMatch(new RegExp(`^${grouped(MAX_PROJECT_CELS)} \\(`));
        expect(limit("Images")).toMatch(new RegExp(`^${grouped(MAX_PROJECT_IMAGES)};`));
        expect(limit("Palette colours")).toBe(String(MAX_PROJECT_PALETTE_COLORS));
        expect(limit("Length of an ID")).toBe(`${MAX_ID_LENGTH} characters`);
        expect(limit("Length of a text (a name, `generator`)")).toBe(
            `${MAX_NAME_LENGTH} UTF-16 code units`,
        );

        expect(limit("`manifest.json`, uncompressed")).toBe(
            `64 KiB (${grouped(MAX_MANIFEST_BYTES)} bytes)`,
        );
        expect(limit("`doc.json`, uncompressed")).toBe(
            `64 MiB (${grouped(MAX_DOC_JSON_BYTES)} bytes)`,
        );
        expect(limit("One `images/<imageId>.png`, uncompressed")).toMatch(
            /^`height × \(4 × width \+ 1\) \+ 65 536` bytes/,
        );
        expect(limit("One `refs/<sourceId>.png`, uncompressed")).toBe(
            `64 MiB (${grouped(MAX_REFERENCE_SOURCE_BYTES)} bytes)`,
        );
        expect(limit("Pixel data: images × `width` × `height` × 4")).toBe(
            `1 GiB (${grouped(MAX_PROJECT_PIXEL_BYTES)} bytes)`,
        );
        expect(limit("All entries of the project together, uncompressed")).toBe(
            `2 GiB (${grouped(MAX_PROJECT_CONTENT_BYTES)} bytes)`,
        );
        expect(limit("Entries in the archive")).toBe(grouped(MAX_PROJECT_ENTRIES));
        expect(section).toContain(`at most ${THUMBNAIL_MAX_SIDE} px a side`);
        expect(section).toContain(`at most\n  ${grouped(MAX_PROJECT_ENTRIES)} entries`);
        // The figure of the worst case, which se-040-limits.test.ts measures.
        expect(section).toContain("the editor writes 52.5 MiB");
    });

    it("states the ranges the code enforces where the code has a constant for them", () => {
        // The first row of that name: `frames` is also a member of the export settings.
        const constraint = (member: string): string => {
            const found = rows(`\`${member}\``);
            expect(found.length, member).toBeGreaterThan(0);
            return found[0].split("|")[3].trim();
        };

        expect(constraint("repeat")).toBe(`0..${MAX_TAG_REPEAT}`);
        expect(constraint("scale")).toBe(
            `${MIN_REFERENCE_SCALE.toFixed(6)}..${grouped(MAX_REFERENCE_SCALE)}`,
        );
        expect(rows("`x`, `y`")[0].split("|")[3].trim()).toBe(
            `−${grouped(MAX_REFERENCE_OFFSET)}..${grouped(MAX_REFERENCE_OFFSET)}`,
        );
        expect(constraint("layers")).toMatch(new RegExp(`^At most ${MAX_PROJECT_LAYERS};`));
        expect(constraint("frames")).toBe(`1 to ${grouped(MAX_PROJECT_FRAMES)}`);
        expect(constraint("cels")).toBe(
            `At most ${grouped(MAX_PROJECT_CELS)}, on at most ${grouped(MAX_PROJECT_IMAGES)} images`,
        );
        expect(constraint("tags")).toBe(`At most ${MAX_PROJECT_TAGS}`);
        expect(constraint("colors")).toBe(`At most ${MAX_PROJECT_PALETTE_COLORS}`);
    });

    it("names every member of doc.json in its tables", () => {
        // `grid.width` and the like are written with a dot; the rest by their own name.
        const dotted = new Set(["grid", "onion", "symmetry", "files"]);
        const names = (value: unknown, prefix = ""): string[] =>
            typeof value !== "object" || value === null || Array.isArray(value)
                ? []
                : Object.entries(value).flatMap(([key, item]) =>
                      dotted.has(key)
                          ? names(item, `${key}.`)
                          : [`${prefix}${key}`, ...names(item)],
                  );
        const json = fixtureDocJson();
        const all = new Set([
            ...names(json),
            ...json.layers.flatMap((layer) => names(layer)),
            ...names(json.frames[0]),
            ...names(json.cels[0]),
            ...names(json.tags[0]),
        ]);
        expect(all.size).toBeGreaterThan(60);
        const missing = [...all].filter(
            (name) => !section.includes(`| \`${name}\``) && !section.includes(`\`${name}\`, \``),
        );
        // `x` and `y` share a row; `tagId` is written inside the `frames` row.
        expect(missing.filter((name) => !["x", "y", "tagId"].includes(name))).toEqual([]);
        expect(section).toContain("| `x`, `y` ");
        expect(section).toContain('`{ "tagId": ID }`');
    });

    it("marks every free text as text, and nothing else", () => {
        const typed = section
            .split("\n")
            .filter((line) => /^\| `[A-Za-z.]+` +\| text +\|/.test(line))
            .map((line) => line.split("|")[1].trim());
        // The names of the document, a layer, a tag and the palette, and the generator.
        expect(typed.sort()).toEqual(["`generator`", "`name`", "`name`", "`name`", "`name`"]);

        // Each of them takes the full length and not one code unit more.
        const long = "n".repeat(MAX_NAME_LENGTH + 1);
        const refuses = (read: () => unknown): boolean => {
            try {
                read();
            } catch {
                return true;
            }
            return false;
        };
        const refused = (change: (doc: DocJson) => void): boolean => {
            const doc: DocJson = { ...fixtureDocJson(), cels: [] };
            change(doc);
            return refuses(() => docFromJson(doc, new Map()));
        };
        for (const length of [MAX_NAME_LENGTH, MAX_NAME_LENGTH + 1]) {
            const name = long.slice(0, length);
            const over = length > MAX_NAME_LENGTH;
            expect(refused((doc) => void (doc.name = name))).toBe(over);
            expect(refused((doc) => void (doc.layers[1].name = name))).toBe(over);
            expect(refused((doc) => void (doc.tags[0].name = name))).toBe(over);
            expect(refused((doc) => void (doc.palette.name = name))).toBe(over);
            const manifest = { format: PROJECT_FORMAT, version: 1, generator: name };
            expect(refuses(() => readManifest(manifest))).toBe(over);
        }
    });

    it("lists every blend mode", () => {
        const row = rows("`blend`")[0] ?? "";
        const listed = [...row.matchAll(/`"([a-z-]+)"`/g)].map((match) => match[1]);

        expect(listed).toHaveLength(19);
        expect(new Set(listed).size).toBe(19);
        // Each is a blend mode the reader accepts.
        for (const blend of listed) {
            const json = fixtureDocJson();
            json.cels = [];
            Object.assign(json.layers[1], { blend });
            expect(docFromJson(json, new Map()).layers[1], blend).toMatchObject({ blend });
        }
    });

    it("is read the same when another format's section follows it", () => {
        // What SE-051 will do to the file: append a section with rows and JSON of its own.
        const appended =
            `${file}\n## 2. Another format, version 1\n\n` +
            "| `repeat` | integer | 0..9 | not this format's |\n\n" +
            '```json\n{ "format": "another" }\n```\n';
        const start = appended.indexOf(`\n${HEADING}\n`);
        const next = appended.indexOf("\n## ", start + 1);
        expect(next).toBeGreaterThan(start);
        expect(appended.slice(start + 1, next)).toBe(section);
        expect(section).not.toContain("Another format");
    });
});
