import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    ATLAS_FORMAT,
    ATLAS_GENERATOR,
    ATLAS_VERSION,
    ExportError,
    MAX_ATLAS_ENTRIES,
    MAX_ATLAS_FRAMES,
    MAX_ATLAS_ID_LENGTH,
    MAX_ATLAS_SIDE,
    MAX_ENTRY_MS,
    MAX_SLUG_LENGTH,
    animationDone,
    animationFrame,
    atlasFor,
    bundle,
    spriteAt,
    spriteAtTopLeft,
    validateAtlas,
} from "../../src/core/export";
import type { AtlasErrorCode, AtlasMeta } from "../../src/core/export";
import type { PixelBuffer } from "../../src/core/model";
import { blitPixels, createPixelBuffer } from "../../src/core/pixels";
import { MAX_TAG_REPEAT } from "../../src/core/tags";
import { Recorder, errorOf, noise, sprite } from "./se-051-support";
import type { TagSpec } from "./se-051-support";

// docs/FORMAT.md is what another program is written against, so what section 2 of it shows
// and states about the sprite atlas is held to the code here. Nothing below looks at another
// section.

const file = readFileSync(new URL("../../docs/FORMAT.md", import.meta.url), "utf8");

const HEADING = `## 2. Sprite atlas (\`${ATLAS_FORMAT}\`), version 1`;

/** Section 2: from its heading to the next heading of the same level, or to the end. */
const section = (() => {
    const start = file.indexOf(`\n${HEADING}\n`);
    if (start === -1) return "";
    const next = file.indexOf("\n## ", start + 1);
    return file.slice(start + 1, next === -1 ? undefined : next);
})();

/** The JSON code blocks of section 2, parsed, in order. */
const examples = [...section.matchAll(/```json\n(.*?)```/gs)].map(
    (match) => JSON.parse(match[1]) as unknown,
);

/** The image the example of §2.2 describes. */
const EXAMPLE_SIZE = { width: 67, height: 34 };

/** A number as the document writes it: digits in groups of three. */
function grouped(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+$)/g, " ");
}

/** The anchor a Markdown viewer gives a heading: lower case, punctuation dropped, hyphens. */
function anchorOf(heading: string): string {
    return heading
        .replace(/^#+ /, "")
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replaceAll(" ", "-");
}

/**
 * The document the example of §2.2 is the atlas of: 31 × 32 pixels, three frames, exported
 * with trim; frame 1 is 20 × 10 pixels from (5, 22); frame 2 has the pixels of frame 0.
 */
function exampleDocument() {
    const small: PixelBuffer = createPixelBuffer(31, 32);
    blitPixels(small, noise(20, 10, 2), 5, 22);
    return sprite({
        name: "Hero",
        frames: [noise(31, 32, 1), small, noise(31, 32, 1)],
        durations: [100, 150, 100],
        tags: [
            { name: "Walk", from: 0, to: 1, direction: "forward", repeat: 0 },
            { name: "Wave", from: 1, to: 2, direction: "reverse", repeat: 2 },
        ],
        pivot: [0.5, 1],
        settings: { trim: true },
    });
}

// One test packs four atlases near the entry limit: slow on a busy machine.
describe("docs/FORMAT.md, sprite atlas version 1", { timeout: 60_000 }, () => {
    it("is section 2 of the document, with a row in the table of formats", () => {
        expect(section.startsWith(`${HEADING}\n`)).toBe(true);
        expect(ATLAS_VERSION).toBe(1);
        // The table of formats, above the sections, has a row that points to this one.
        const head = file.slice(0, file.indexOf("\n## "));
        expect(head).toContain(
            `| NGNE sprite atlas   | \`<name>.atlas.json\`  | 1       | [2](#${anchorOf(HEADING)}) |`,
        );
        expect(anchorOf(HEADING)).toBe("2-sprite-atlas-ngne-sprite-atlas-version-1");
        // It is the last section so far, after the sprite project.
        expect(file.indexOf("\n## 1. ")).toBeLessThan(file.indexOf(`\n${HEADING}\n`));
        expect(section.endsWith("\n")).toBe(true);
    });

    it("names the fixture file that is kept of this version", () => {
        expect(section).toContain(
            "`tests/unit/se-051-fixtures/hero-walk.atlas.json.golden` and `hero-walk.png`",
        );
        for (const name of ["hero-walk.atlas.json.golden", "hero-walk.png"]) {
            expect(existsSync(new URL(`./se-051-fixtures/${name}`, import.meta.url)), name).toBe(
                true,
            );
        }
    });

    it("shows an atlas that the reader accepts", () => {
        // The one JSON example of the section.
        expect(examples).toHaveLength(1);
        const atlas = validateAtlas(examples[0], EXAMPLE_SIZE);

        expect(atlas).toEqual(examples[0]);
        expect([atlas.format, atlas.version]).toEqual([ATLAS_FORMAT, ATLAS_VERSION]);
        // The members in the order of the tables, which is the order the writer uses.
        expect(JSON.stringify(atlas)).toBe(JSON.stringify(examples[0]));
    });

    it("shows the atlas the writer makes of the document it describes", () => {
        const example = examples[0] as AtlasMeta;
        const { meta, atlas } = bundle(exampleDocument());

        expect([atlas.width, atlas.height]).toEqual([EXAMPLE_SIZE.width, EXAMPLE_SIZE.height]);
        expect(example.generator).toMatch(/^ngne-sprite-editor \d+\.\d+\.\d+$/);
        expect(ATLAS_GENERATOR).toMatch(/^ngne-sprite-editor \d+\.\d+\.\d+$/);
        // Member for member and in the same order; the example names the release version.
        expect(JSON.stringify({ ...meta, generator: example.generator })).toBe(
            JSON.stringify(example),
        );
    });

    it("names every member of the atlas in its tables", () => {
        const names = (value: unknown, inIds = false): string[] =>
            typeof value !== "object" || value === null
                ? []
                : Object.entries(value).flatMap(([key, item]) => [
                      // The members of `frames` and `animations` are IDs, not names of members.
                      ...(inIds || Array.isArray(value) ? [] : [key]),
                      ...names(item, key === "frames" || key === "animations"),
                  ]);
        const all = [...new Set(names(examples[0]))];

        expect(all).toHaveLength(8 + 9 + 3 + 2);
        const missing = all.filter((name) => !section.includes(`| \`${name}\` `));
        // `x`, `y` and `w`, `h` share a row each.
        expect(missing).toEqual(["x", "y", "w", "h"]);
        expect(section).toContain("| `x`, `y` ");
        expect(section).toContain("| `w`, `h` ");
    });

    it("states the limits the code enforces", () => {
        const rows = [
            `| Width and height of the image                | ${MAX_ATLAS_SIDE} px`,
            `| \`sourceW\`, \`sourceH\`                         | ${MAX_ATLAS_SIDE} px |`,
            `| Frames                                       | ${grouped(MAX_ATLAS_FRAMES)} |`,
            `| Entries of all animations together           | ${grouped(MAX_ATLAS_ENTRIES)} |`,
            `| \`ms\` of an entry                             | ${grouped(MAX_ENTRY_MS)} |`,
            `| Length of an ID                              | ${MAX_ATLAS_ID_LENGTH} characters |`,
        ];
        for (const row of rows) expect(section, row).toContain(row);
        expect(grouped(MAX_ATLAS_ENTRIES)).toBe("65 536");
        // The same numbers where the members are specified.
        expect(section).toContain(`a string of 1 to ${MAX_ATLAS_ID_LENGTH} characters`);
        expect(section).toContain("(`[a-z0-9][a-z0-9_-]*`)");
        expect(section).toContain(`| \`ms\`    | integer | 1..${MAX_ENTRY_MS} `);
        expect(section).toContain(`| 1..${MAX_ATLAS_SIDE} `);
        expect(section).toContain(`| 2..${MAX_ATLAS_SIDE}, **even** `);
        expect(section).toContain(`at most ${grouped(MAX_ATLAS_FRAMES)} | The frames`);
        expect(section).toContain(
            `at most ${grouped(MAX_ATLAS_ENTRIES)} × ${grouped(MAX_ENTRY_MS)} = ${grouped(MAX_ATLAS_ENTRIES * MAX_ENTRY_MS)}`,
        );
        // A frame ID of the editor: a name of 64 characters, a hyphen, an index of 5 digits.
        expect(section).toContain("the ID of a frame at most 70 characters");
        expect(MAX_SLUG_LENGTH + 1 + String(MAX_ATLAS_FRAMES - 1).length).toBe(70);
    });

    it("states what a tag of 255 repeats may hold, as the writer has it", () => {
        expect(section).toContain(
            `A tag that repeats ${MAX_TAG_REPEAT} times fits with up to 257 frames,\nor with up to 129 frames played back and forth (256 entries a pass).`,
        );
        const blank = createPixelBuffer(1, 1);
        const entries = (frames: number, direction: TagSpec["direction"]) => {
            const doc = sprite({
                name: "Strip",
                frames: new Array<PixelBuffer | null>(frames).fill(null),
                tags: [{ name: "all", from: 0, to: frames - 1, direction, repeat: MAX_TAG_REPEAT }],
            });
            return atlasFor(new Array<PixelBuffer>(frames).fill(blank), doc).meta.animations.all
                .entries.length;
        };

        // 257 × 255 = 65 535; 258 × 255 = 65 790. Back and forth: (2 × 129 − 2) × 255 =
        // 65 280; (2 × 130 − 2) × 255 = 65 790.
        expect(entries(257, "forward")).toBe(65_535);
        expect(errorOf(ExportError, () => entries(258, "forward")).count).toBe(65_790);
        expect(entries(129, "pingpong")).toBe(65_280);
        expect(errorOf(ExportError, () => entries(130, "pingpong")).count).toBe(65_790);
    });

    it("lists every code of the reader's error", () => {
        const codes: Record<AtlasErrorCode, true> = {
            format: true,
            "newer-version": true,
            field: true,
            id: true,
            "image-size": true,
            bounds: true,
            "frame-reference": true,
            duration: true,
            limit: true,
        };
        const listed = [...section.matchAll(/^\| `([a-z-]+)` +\| (?:The|A|An|More|`)/gm)]
            .map((match) => match[1])
            .filter((name) => name in codes);

        expect(listed).toEqual(Object.keys(codes));
    });

    it("keeps the rules of this format in its own section", () => {
        // A reader of an atlas ignores what it does not know, as NGNE does; a reader of a
        // project refuses it. Each rule stands in its section and nowhere else.
        expect(section).toContain("A reader ignores a member it does not know");
        expect(section).not.toContain(
            "A reader refuses an entry with a missing or an unknown member",
        );
        const extra = { ...(examples[0] as object), note: "kept by a tool" };
        expect(validateAtlas(extra, EXAMPLE_SIZE)).toEqual(examples[0]);
        // Rules, and what only the editor's writer does, are told apart.
        for (const heading of ["### 2.7 What the editor writes", "### 2.8 Reading"]) {
            expect(section).toContain(`\n${heading}\n`);
        }
        expect(section).toContain("A reader must not rely on anything of §2.7");
    });

    it("works the drawing example out as the sprite runtime does", () => {
        const atlas = validateAtlas(examples[0], EXAMPLE_SIZE);
        const sink = new Recorder();
        spriteAt(sink, atlas, "hero", "hero-1", 100, 80);
        spriteAt(sink, atlas, "hero", "hero-0", 100, 80);
        const [small, whole] = sink.sprites;

        expect(section).toContain(
            "`d = (5 + 10 − 15.5, 22 + 5 − 32) = (−0.5, −5)`, rounded `(0, −5)`",
        );
        expect(section).toContain("on `(100, 75)`, which covers 90..110 by 70..80");
        expect(section).toContain("`uv = (34/67, 1/34, 20/67, 10/34)`");
        expect(small).toEqual({
            x: 100,
            y: 75,
            width: 20,
            height: 10,
            texture: "hero",
            u: 34 / 67,
            v: 1 / 34,
            uw: 20 / 67,
            vh: 10 / 34,
            rotation: 0,
        });

        expect(section).toContain(
            "`hero-0` has `d = (0.5, −16)`, rounded `(1, −16)`, and\ncovers 85..117 by 48..80",
        );
        expect([whole.x - 16, whole.x + 16, whole.y - 16, whole.y + 16]).toEqual([85, 117, 48, 80]);
        // "Both put the source frame at 85, 48": the quad's corner less the offset.
        expect([small.x - 10 - 5, small.y - 5 - 22]).toEqual([85, 48]);
        expect([whole.x - 16 - 0, whole.y - 16 - 0]).toEqual([85, 48]);

        // "To place a frame by the top-left corner of its source frame, take [0, 0]".
        const corner = new Recorder();
        spriteAtTopLeft(corner, atlas, "hero", "hero-1", 100, 80);
        const zero: AtlasMeta = {
            ...atlas,
            frames: { ...atlas.frames, "hero-1": { ...atlas.frames["hero-1"], pivot: [0, 0] } },
        };
        spriteAt(corner, zero, "hero", "hero-1", 100, 80);
        expect(corner.sprites[0]).toEqual(corner.sprites[1]);
    });

    it("states how an animation is read, as the sprite runtime reads it", () => {
        const atlas = validateAtlas(examples[0], EXAMPLE_SIZE);

        expect(section).toContain(
            "the\n  first shows for `0 ≤ t < 100` and the second for `100 ≤ t < 250`",
        );
        expect(animationFrame(atlas, "walk", 0)).toBe("hero-0");
        expect(animationFrame(atlas, "walk", 99)).toBe("hero-0");
        expect(animationFrame(atlas, "walk", 100)).toBe("hero-1");
        expect(animationFrame(atlas, "walk", 249)).toBe("hero-1");
        // A loop at t is the loop at t modulo durationMs; a once animation ends on its last.
        expect(animationFrame(atlas, "walk", 250)).toBe("hero-0");
        expect(animationFrame(atlas, "wave", 499)).toBe("hero-1");
        expect(animationFrame(atlas, "wave", 5000)).toBe("hero-1");
        expect([animationDone(atlas, "wave", 499), animationDone(atlas, "wave", 500)]).toEqual([
            false,
            true,
        ]);
        expect(animationDone(atlas, "walk", 5000)).toBe(false);
    });
});
