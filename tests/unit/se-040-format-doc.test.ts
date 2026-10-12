import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertInvariants } from "../../src/core/model";
import {
    MAX_ID_LENGTH,
    MAX_PROJECT_FRAMES,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_PIXEL_BYTES,
    MAX_PROJECT_TAGS,
    MAX_REFERENCE_SOURCE_BYTES,
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
import {
    MAX_DOC_JSON_BYTES,
    MAX_MANIFEST_BYTES,
    MAX_PROJECT_CONTENT_BYTES,
    MAX_PROJECT_ENTRIES,
    maxImageEntryBytes,
} from "../../src/core/project/format";
import { readManifest } from "../../src/core/project/manifest";
import { REFERENCE_PNG, fixtureDocJson, noiseImage } from "./se-040-support";

// docs/FORMAT.md is what another program is written against, so what it shows and states is
// held to the code here.

const text = readFileSync(new URL("../../docs/FORMAT.md", import.meta.url), "utf8");

/** The JSON code blocks of the document, parsed, in order. */
const examples = [...text.matchAll(/```json\n(.*?)```/gs)].map(
    (match) => JSON.parse(match[1]) as unknown,
);

/** A number as the document writes it: digits in groups of three. */
function grouped(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+$)/g, " ");
}

describe("docs/FORMAT.md, sprite project version 1", () => {
    it("has a title, a table of formats and one numbered section per format", () => {
        expect(text.startsWith("# NGNE Sprite Editor — File formats\n")).toBe(true);
        expect(text).toContain("| Format ");
        expect(text).toContain(`## 1. Sprite project (\`${PROJECT_FILE_EXTENSION}\`), version 1`);
        expect(text).toContain(`"${PROJECT_FORMAT}"`);
        expect(PROJECT_VERSION).toBe(1);
    });

    it("shows a manifest.json that the reader accepts", () => {
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
        const limits: [string, number][] = [
            ["manifest.json", MAX_MANIFEST_BYTES],
            ["doc.json", MAX_DOC_JSON_BYTES],
            ["reference source", MAX_REFERENCE_SOURCE_BYTES],
            ["pixel data", MAX_PROJECT_PIXEL_BYTES],
            ["all entries", MAX_PROJECT_CONTENT_BYTES],
            ["entries", MAX_PROJECT_ENTRIES],
            ["frames", MAX_PROJECT_FRAMES],
        ];
        for (const [name, value] of limits) {
            expect(text, name).toContain(`${grouped(value)}`);
        }
        expect(grouped(MAX_PROJECT_PIXEL_BYTES)).toBe("1 073 741 824");

        expect(text).toContain(
            "| `doc.json`, uncompressed                          | 16 MiB (16 777 216 bytes) |",
        );
        expect(text).toContain(
            "| One `refs/<sourceId>.png`, uncompressed           | 64 MiB (67 108 864 bytes) |",
        );
        expect(text).toContain("`height × (4 × width + 1) + 65 536` bytes");
        expect(maxImageEntryBytes(1024, 1024)).toBe(1024 * (4 * 1024 + 1) + 65_536);
        expect(text).toContain(
            `| Layers                                            | ${MAX_PROJECT_LAYERS}, of which`,
        );
        expect(text).toContain(
            `| Tags                                              | ${MAX_PROJECT_TAGS} |`,
        );
        expect(text).toContain(
            `| Length of an ID                                   | ${MAX_ID_LENGTH} characters |`,
        );
        expect(text).toContain(`at most ${THUMBNAIL_MAX_SIDE} px a side`);
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
            (name) => !text.includes(`| \`${name}\``) && !text.includes(`\`${name}\`, \``),
        );
        // `x` and `y` share a row; `tagId` is written inside the `frames` row.
        expect(missing.filter((name) => !["x", "y", "tagId"].includes(name))).toEqual([]);
        expect(text).toContain("| `x`, `y` ");
        expect(text).toContain('`{ "tagId": ID }`');
    });

    it("lists every blend mode", () => {
        const row = text.split("\n").find((line) => line.startsWith("| `blend` ")) ?? "";
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
});
