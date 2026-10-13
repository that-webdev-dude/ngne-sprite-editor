import { describe, expect, it } from "vitest";
import { expandTag } from "../../src/core/animation";
import { compositeFrame } from "../../src/core/composite";
import {
    AtlasError,
    ExportError,
    MAX_ATLAS_ENTRIES,
    MAX_ATLAS_FRAMES,
    PackError,
    atlasFor,
    bundle,
    exportFrameIndices,
    validateAtlas,
} from "../../src/core/export";
import type { AtlasMeta } from "../../src/core/export";
import type { PixelBuffer, SpriteDoc } from "../../src/core/model";
import { createPixelBuffer, pixelBuffersEqual } from "../../src/core/pixels";
import { MAX_TAG_REPEAT } from "../../src/core/tags";
import { errorOf, exportSettings, grid, heroWalk, noise, show, sprite } from "./se-051-support";
import type { TagSpec } from "./se-051-support";

// The mapping from a document to an atlas (SPEC §9.3), and what `bundle` and `atlasFor`
// refuse. Sizes and positions are worked out by hand from SPEC §9.4:
//
//     atlas side = n × (cell + padding + 2·extrude) + padding      n cells along the side
//     rect start = padding + extrude + i × (cell + padding + 2·extrude)

/** Four frames of 2 × 2 with durations 10, 20, 30 and 40 ms. */
function four(tags: TagSpec[] = [], name = "Hero"): SpriteDoc {
    return sprite({
        name,
        frames: [grid("AA", "AA"), grid("BB", "BB"), grid("CC", "CC"), grid("DD", "DD")],
        durations: [10, 20, 30, 40],
        tags,
    });
}

/** The entries of an animation as "frame:ms" words. */
function sequence(meta: AtlasMeta, id: string): string {
    return meta.animations[id].entries.map((entry) => `${entry.frame}:${entry.ms}`).join(" ");
}

describe("frames of the atlas", () => {
    it("are named <name>-<index> from 0, in frame order", () => {
        const { meta } = bundle(four());

        expect(Object.keys(meta.frames)).toEqual(["hero-0", "hero-1", "hero-2", "hero-3"]);
        expect(meta.image).toBe("hero.png");
    });

    it("carry the rectangle `pack` gave them, the size of the canvas and the pivot", () => {
        const doc = four();
        doc.pivot = { x: 0.25, y: 1 };
        const { meta, atlas } = bundle(doc);

        // Four rects of 2 × 2 on 2 × 2 cells, padding 1: each side 2 × (2 + 1) + 1 = 7;
        // starts 1 and 1 + 3 = 4.
        expect([meta.width, meta.height]).toEqual([7, 7]);
        expect([atlas.width, atlas.height]).toEqual([7, 7]);
        const at = (x: number, y: number) => ({
            x,
            y,
            w: 2,
            h: 2,
            sourceW: 2,
            sourceH: 2,
            offsetX: 0,
            offsetY: 0,
            pivot: [0.25, 1],
        });
        expect(meta.frames).toEqual({
            "hero-0": at(1, 1),
            "hero-1": at(4, 1),
            "hero-2": at(1, 4),
            "hero-3": at(4, 4),
        });
        expect(show(atlas)).toEqual([
            ".......",
            ".AA.BB.",
            ".AA.BB.",
            ".......",
            ".CC.DD.",
            ".CC.DD.",
            ".......",
        ]);
    });

    it("that are identical share one rectangle under their own IDs", () => {
        const doc = sprite({
            name: "Hero",
            frames: [grid("AB", "CD"), grid("EF", "GH"), grid("AB", "CD"), grid("EF", "GH")],
        });
        const merged = bundle(doc).meta;

        // Two rectangles in one row: width 2 × (2 + 1) + 1 = 7, height 1 × 3 + 1 = 4.
        expect([merged.width, merged.height]).toEqual([7, 4]);
        expect(Object.keys(merged.frames)).toHaveLength(4);
        expect(merged.frames["hero-2"]).toEqual(merged.frames["hero-0"]);
        expect(merged.frames["hero-3"]).toEqual(merged.frames["hero-1"]);
        expect(merged.frames["hero-0"]).toMatchObject({ x: 1, y: 1 });
        expect(merged.frames["hero-1"]).toMatchObject({ x: 4, y: 1 });

        // Without merging: four rectangles on 2 × 2 cells, 7 × 7.
        const separate = bundle(doc, exportSettings({ mergeDuplicates: false })).meta;
        expect([separate.width, separate.height]).toEqual([7, 7]);
        expect(separate.frames["hero-2"]).toMatchObject({ x: 1, y: 4 });
        expect(separate.frames["hero-2"]).not.toEqual(separate.frames["hero-0"]);
    });

    it("are packed with the settings: layout, padding, extrude, trim", () => {
        const doc = sprite({
            name: "Hero",
            frames: [grid("A...", "....", "....", "...."), grid("BBBB", "BBBB", "BBBB", "BBBB")],
        });

        // Row, padding 2, extrude 1: pitch 4 + 2 + 2 = 8; width 2 × 8 + 2 = 18, height 10;
        // starts 2 + 1 = 3 and 3 + 8 = 11.
        const row = bundle(doc, exportSettings({ layout: "row", padding: 2, extrude: 1 })).meta;
        expect([row.width, row.height]).toEqual([18, 10]);
        expect(row.frames["hero-1"]).toMatchObject({ x: 11, y: 3, w: 4, h: 4 });

        // Column, padding 0: width 4, height 2 × 4 = 8.
        const column = bundle(doc, exportSettings({ layout: "column", padding: 0 })).meta;
        expect([column.width, column.height]).toEqual([4, 8]);
        expect(column.frames["hero-1"]).toMatchObject({ x: 0, y: 4 });

        // Trim: frame 0 is one pixel, a 2 × 2 rectangle at offset 0, 0 of its 4 × 4 frame.
        const trimmed = bundle(doc, exportSettings({ trim: true })).meta;
        expect(trimmed.frames["hero-0"]).toMatchObject({ w: 2, h: 2, sourceW: 4, sourceH: 4 });
        expect(trimmed.frames["hero-1"]).toMatchObject({ w: 4, h: 4, sourceW: 4, sourceH: 4 });
    });
});

describe("animations of the atlas", () => {
    it("a tag is written out as SPEC §7.4 has it, with the durations of its frames", () => {
        const { meta } = bundle(
            four([
                { name: "Forward", from: 0, to: 3, direction: "forward" },
                { name: "Reverse", from: 0, to: 3, direction: "reverse" },
                { name: "Ping Pong", from: 0, to: 3, direction: "pingpong" },
            ]),
        );

        // For the frames a b c d: forward a b c d, reverse d c b a, ping-pong a b c d c b.
        expect(sequence(meta, "forward")).toBe("hero-0:10 hero-1:20 hero-2:30 hero-3:40");
        expect(sequence(meta, "reverse")).toBe("hero-3:40 hero-2:30 hero-1:20 hero-0:10");
        expect(sequence(meta, "ping-pong")).toBe(
            "hero-0:10 hero-1:20 hero-2:30 hero-3:40 hero-2:30 hero-1:20",
        );
        // 10 + 20 + 30 + 40 = 100; the ping-pong adds 30 + 20.
        expect(meta.animations.forward.durationMs).toBe(100);
        expect(meta.animations.reverse.durationMs).toBe(100);
        expect(meta.animations["ping-pong"].durationMs).toBe(150);
    });

    it("repeat 0 is a loop of one pass; repeat n is n passes played once", () => {
        const { meta } = bundle(
            four([
                { name: "loop", from: 1, to: 2, repeat: 0 },
                { name: "one", from: 1, to: 2, repeat: 1 },
                { name: "three", from: 1, to: 2, repeat: 3, direction: "reverse" },
                { name: "bounce", from: 0, to: 2, repeat: 2, direction: "pingpong" },
            ]),
        );

        expect(meta.animations.loop).toMatchObject({ playback: "loop", durationMs: 50 });
        expect(sequence(meta, "loop")).toBe("hero-1:20 hero-2:30");
        expect(meta.animations.one).toMatchObject({ playback: "once", durationMs: 50 });
        expect(sequence(meta, "one")).toBe("hero-1:20 hero-2:30");
        // 3 × (30 + 20) = 150.
        expect(meta.animations.three).toMatchObject({ playback: "once", durationMs: 150 });
        expect(sequence(meta, "three")).toBe(
            "hero-2:30 hero-1:20 hero-2:30 hero-1:20 hero-2:30 hero-1:20",
        );
        // a b c b twice: 2 × (10 + 20 + 30 + 20) = 160.
        expect(meta.animations.bounce).toMatchObject({ playback: "once", durationMs: 160 });
        expect(sequence(meta, "bounce")).toBe(
            "hero-0:10 hero-1:20 hero-2:30 hero-1:20 hero-0:10 hero-1:20 hero-2:30 hero-1:20",
        );
    });

    it("is what expandTag gives for the tag, frame for frame", () => {
        const doc = heroWalk();
        const { meta } = bundle(doc);
        const idOf = new Map(doc.frames.map((frame, index) => [frame.id, `hero-walk-${index}`]));

        expect(Object.keys(meta.animations)).toEqual(["walk", "turn-around", "walk-2"]);
        Object.values(meta.animations).forEach((animation, index) => {
            const expanded = expandTag(doc, doc.tags[index]);
            expect(animation.entries).toEqual(
                expanded.map((entry) => ({ frame: idOf.get(entry.frameId), ms: entry.ms })),
            );
            expect(animation.durationMs).toBe(expanded.reduce((sum, entry) => sum + entry.ms, 0));
        });
    });

    it("frames outside every tag are exported as frames", () => {
        const { meta } = bundle(four([{ name: "mid", from: 1, to: 2 }]));

        expect(Object.keys(meta.frames)).toEqual(["hero-0", "hero-1", "hero-2", "hero-3"]);
        expect(Object.keys(meta.animations)).toEqual(["mid"]);
    });

    it("a document of several frames and no tag gets one loop named <name> over all frames", () => {
        const { meta } = bundle(four([], "Hero Walk"));

        expect(Object.keys(meta.animations)).toEqual(["hero-walk"]);
        expect(meta.animations["hero-walk"]).toEqual({
            playback: "loop",
            durationMs: 100,
            entries: [
                { frame: "hero-walk-0", ms: 10 },
                { frame: "hero-walk-1", ms: 20 },
                { frame: "hero-walk-2", ms: 30 },
                { frame: "hero-walk-3", ms: 40 },
            ],
        });
    });

    it("a document of one frame and no tag has no animation; one with a tag has it", () => {
        const single = sprite({ name: "Icon", frames: [grid("A")] });
        expect(bundle(single).meta.animations).toEqual({});

        const tagged = sprite({
            name: "Icon",
            frames: [grid("A")],
            tags: [{ name: "still", from: 0, to: 0 }],
        });
        expect(bundle(tagged).meta.animations).toEqual({
            still: { playback: "loop", durationMs: 100, entries: [{ frame: "icon-0", ms: 100 }] },
        });
    });

    it("tags of one slug get the suffixes of animationIds", () => {
        const { meta } = bundle(
            four([
                { name: "Walk", from: 0, to: 1 },
                { name: "walk", from: 2, to: 3 },
                { name: "WALK!", from: 1, to: 1 },
                { name: "", from: 3, to: 3 },
            ]),
        );

        expect(Object.keys(meta.animations)).toEqual(["walk", "walk-2", "walk-3", "tag"]);
        expect(sequence(meta, "walk-2")).toBe("hero-2:30 hero-3:40");
        expect(sequence(meta, "walk-3")).toBe("hero-1:20");
    });

    it("a frame and an animation may have the same ID: they are two lists", () => {
        const { meta } = bundle(four([{ name: "hero-0", from: 0, to: 0 }]));

        expect(Object.keys(meta.frames)).toContain("hero-0");
        expect(Object.keys(meta.animations)).toEqual(["hero-0"]);
    });

    it("an ID that is a whole number stands first, as in every JavaScript object", () => {
        const made = bundle(
            four([
                { name: "walk", from: 0, to: 0 },
                { name: "2", from: 1, to: 1 },
                { name: "1", from: 2, to: 2 },
            ]),
        );

        // The order of members has no meaning in the format; every file has the same one.
        expect(Object.keys(made.meta.animations)).toEqual(["1", "2", "walk"]);
        const text = (ending: string) =>
            new TextDecoder().decode(made.files.find((file) => file.name.endsWith(ending))?.bytes);
        expect(
            [...text(".atlas.json").matchAll(/^ {8}"([a-z0-9]+)": \{\n {12}"playback"/gm)].map(
                (m) => m[1],
            ),
        ).toEqual(["1", "2", "walk"]);
        expect(
            [...text(".preview.config.mjs").matchAll(/^ {12}id: "([a-z0-9]+)",$/gm)].map(
                (m) => m[1],
            ),
        ).toEqual(["1", "2", "walk"]);
    });
});

describe("exporting one tag", () => {
    const tags: TagSpec[] = [
        { name: "Walk", from: 0, to: 1 },
        { name: "walk", from: 2, to: 3, direction: "pingpong", repeat: 2 },
    ];

    it("exports that tag's frames and animation, under the IDs of the full export", () => {
        const doc = four(tags);
        const full = bundle(doc).meta;
        const { meta, atlas } = bundle(doc, exportSettings({ frames: { tagId: "tag-1" } }));

        expect(exportFrameIndices(doc, exportSettings({ frames: { tagId: "tag-1" } }))).toEqual([
            2, 3,
        ]);
        // The frames keep their document indices; the animation keeps its suffix.
        expect(Object.keys(meta.frames)).toEqual(["hero-2", "hero-3"]);
        expect(Object.keys(meta.animations)).toEqual(["walk-2"]);
        expect(meta.animations["walk-2"]).toEqual(full.animations["walk-2"]);
        expect(sequence(meta, "walk-2")).toBe("hero-2:30 hero-3:40 hero-2:30 hero-3:40");
        // Two rectangles in one row: 2 × 3 + 1 = 7 wide, 1 × 3 + 1 = 4 high.
        expect([meta.width, meta.height]).toEqual([7, 4]);
        expect(show(atlas)).toEqual([".......", ".CC.DD.", ".CC.DD.", "......."]);
    });

    it("uses the document's own setting when none is given", () => {
        const doc = four(tags);
        doc.exportSettings.frames = { tagId: "tag-0" };

        expect(exportFrameIndices(doc)).toEqual([0, 1]);
        expect(Object.keys(bundle(doc).meta.frames)).toEqual(["hero-0", "hero-1"]);
        expect(Object.keys(bundle(doc).meta.animations)).toEqual(["walk"]);
        // Settings given in the call take the place of the document's.
        expect(Object.keys(bundle(doc, exportSettings()).meta.frames)).toHaveLength(4);
    });

    it("exports every frame for `all`", () => {
        expect(exportFrameIndices(four(tags))).toEqual([0, 1, 2, 3]);
    });
});

describe("atlasFor", () => {
    it("gives the atlas and the metadata of bundle, from composites", () => {
        const doc = heroWalk();
        const frames = doc.frames.map((frame) => compositeFrame(doc, frame.id));
        const made = bundle(doc);
        const { atlas, meta } = atlasFor(frames, doc);

        expect(meta).toEqual(made.meta);
        expect(JSON.stringify(meta)).toBe(JSON.stringify(made.meta));
        expect(pixelBuffersEqual(atlas, made.atlas)).toBe(true);
        expect(Object.keys({ atlas, meta })).toEqual(["atlas", "meta"]);
    });

    it("reads the name, the frames, the tags and the pivot of the document, and no pixel", () => {
        const doc = heroWalk();
        const frames = doc.frames.map((frame) => compositeFrame(doc, frame.id));
        const expected = atlasFor(frames, doc);
        // What a worker is sent: the document without its layers, cels and images.
        const bare: SpriteDoc = {
            ...doc,
            layers: [],
            cels: new Map(),
            images: new Map(),
            width: 0,
            height: 0,
        };
        const trap = new Proxy(bare, {
            get(target, key, receiver) {
                if (!["name", "frames", "tags", "pivot"].includes(String(key))) {
                    throw new Error(`atlasFor read \`${String(key)}\` of the document`);
                }
                return Reflect.get(target, key, receiver) as unknown;
            },
        });

        expect(atlasFor(frames, trap, doc.exportSettings).meta).toEqual(expected.meta);
    });

    it("takes the composites of the exported frames only, in their order", () => {
        const doc = four([{ name: "end", from: 2, to: 3 }]);
        const settings = exportSettings({ frames: { tagId: "tag-0" } });
        const frames = exportFrameIndices(doc, settings).map((index) =>
            compositeFrame(doc, doc.frames[index].id),
        );
        const { atlas, meta } = atlasFor(frames, doc, settings);

        expect(frames).toHaveLength(2);
        expect(Object.keys(meta.frames)).toEqual(["hero-2", "hero-3"]);
        expect(show(atlas)).toEqual([".......", ".CC.DD.", ".CC.DD.", "......."]);
    });

    it("refuses a list that is not one composite per exported frame", () => {
        const doc = four();
        const frames = doc.frames.map((frame) => compositeFrame(doc, frame.id));

        for (const list of [[], frames.slice(0, 3), [...frames, frames[0]]]) {
            const error = errorOf(ExportError, () => atlasFor(list, doc));
            expect(error.code).toBe("frames");
            expect(error.message).toContain(`${list.length} composites`);
            expect(error.message).toContain("4 frames");
        }
    });

    it("describes the composites it is given: their size is the source size", () => {
        // The preview may pack frames at another size than the canvas the document states.
        const doc = four();
        const { meta } = atlasFor(
            [noise(3, 5, 1), noise(3, 5, 2), noise(3, 5, 3), noise(3, 5, 4)],
            doc,
        );

        expect(meta.frames["hero-0"]).toMatchObject({ w: 4, h: 6, sourceW: 3, sourceH: 5 });
    });

    it("does not change the document, the composites or the settings", () => {
        const doc = heroWalk();
        const frames = doc.frames.map((frame) => compositeFrame(doc, frame.id));
        const before = { doc: structuredClone(doc), frames: structuredClone(frames) };

        atlasFor(frames, doc);
        bundle(doc);

        expect(doc).toEqual(before.doc);
        expect(frames).toEqual(before.frames);
    });
});

describe("what cannot be exported", () => {
    it("settings that name a tag the document does not have", () => {
        const doc = four([{ name: "walk", from: 0, to: 1 }]);
        const settings = exportSettings({ frames: { tagId: "tag-9" } });

        for (const run of [
            () => bundle(doc, settings),
            () => atlasFor([], doc, settings),
            () => exportFrameIndices(doc, settings),
        ]) {
            const error = errorOf(ExportError, run);
            expect(error.code).toBe("settings");
            expect(error.message).toContain('"tag-9"');
        }
    });

    it("settings that are not settings", () => {
        const doc = four();
        const frames = (value: unknown) =>
            ({ ...exportSettings(), frames: value }) as SpriteDoc["exportSettings"];
        for (const value of ["none", null, undefined, 3, {}, { tagId: 5 }, []]) {
            expect(errorOf(ExportError, () => bundle(doc, frames(value))).code).toBe("settings");
        }
        const files = (asepriteJson: unknown) =>
            ({
                ...exportSettings(),
                files: { spritesTs: true, previewConfig: true, asepriteJson },
            }) as SpriteDoc["exportSettings"];
        for (const value of ["json", "", null, true, "Array"]) {
            const error = errorOf(ExportError, () => bundle(doc, files(value)));
            expect(error.code).toBe("settings");
            expect(error.message).toContain("none, array, hash");
        }
        // Packing options outside their range are reported by `pack`.
        const packed = errorOf(PackError, () => bundle(doc, exportSettings({ padding: 9 })));
        expect(packed.code).toBe("options");
    });

    it("a document that breaks what the atlas depends on", () => {
        const broken: [string, (doc: SpriteDoc) => void][] = [
            ["a tag that ends on no frame", (doc) => (doc.tags[0].toFrameId = "gone")],
            ["a tag that starts on no frame", (doc) => (doc.tags[0].fromFrameId = "gone")],
            [
                "a tag that runs backwards",
                (doc) =>
                    Object.assign(doc.tags[0], { fromFrameId: "frame-3", toFrameId: "frame-0" }),
            ],
            ["a repeat count of -1", (doc) => (doc.tags[0].repeat = -1)],
            ["a repeat count of 1.5", (doc) => (doc.tags[0].repeat = 1.5)],
            ["no frame", (doc) => (doc.frames = [])],
        ];
        for (const [name, damage] of broken) {
            const doc = four([{ name: "walk", from: 0, to: 1 }]);
            damage(doc);
            // Found from the plan: nothing has been composited or packed.
            expect(errorOf(ExportError, () => atlasFor([], doc)).code, name).toBe("document");
            expect(errorOf(ExportError, () => exportFrameIndices(doc)).code, name).toBe("document");
        }
    });

    it("a value the finished atlas shows to be outside the format", () => {
        const broken: [string, (doc: SpriteDoc) => void, string][] = [
            [
                "a duration of 0",
                (doc) => (doc.frames[1].durationMs = 0),
                'animations["walk"].entries[1].ms',
            ],
            [
                "a duration of 65536",
                (doc) => (doc.frames[0].durationMs = 65_536),
                'animations["walk"].entries[0].ms',
            ],
            [
                "a duration of 1.5",
                (doc) => (doc.frames[0].durationMs = 1.5),
                'animations["walk"].entries[0].ms',
            ],
            [
                "a pivot outside the frame",
                (doc) => (doc.pivot = { x: 0.5, y: 1.5 }),
                'frames["hero-0"].pivot[1]',
            ],
            [
                "a pivot that is no number",
                (doc) => (doc.pivot = { x: NaN, y: 0 }),
                'frames["hero-0"].pivot[0]',
            ],
        ];
        for (const [name, damage, path] of broken) {
            const doc = four([{ name: "walk", from: 0, to: 1 }]);
            damage(doc);
            const error = errorOf(ExportError, () => bundle(doc));

            expect(error.code, name).toBe("document");
            expect(error.cause, name).toBeInstanceOf(AtlasError);
            expect((error.cause as AtlasError).path, name).toBe(path);
            expect(error.message, name).toContain("cannot be exported");
        }
    });

    it("an atlas beyond 8192 px a side, with the error of pack", () => {
        // 100 frames of 1024 × 2 in a column without merging: height 100 × (2 + 1) + 1 = 301,
        // fine; in a row: width 100 × (1024 + 1) + 1 = 102 501, height 1 × (2 + 1) + 1 = 4.
        const doc = sprite({
            name: "Wide",
            frames: new Array<PixelBuffer | null>(100).fill(null),
            size: [1024, 2],
        });
        const frames = new Array<PixelBuffer>(100).fill(createPixelBuffer(1024, 2, 0xff0000ff));
        const settings = exportSettings({ layout: "row", mergeDuplicates: false });
        const error = errorOf(PackError, () => atlasFor(frames, doc, settings));

        expect(error.code).toBe("atlas-size");
        expect(error.required).toEqual({ width: 102_501, height: 4 });
        expect(atlasFor(frames, doc, { ...settings, layout: "column" }).meta.height).toBe(301);
    });
});

// Atlases at the limit hold 65 536 entries: slow when other suites keep the machine busy.
describe("the limit on animation entries", { timeout: 60_000 }, () => {
    /** A document of `count` frames of 1 × 1, without pixels, with these tags. */
    function strip(count: number, tags: TagSpec[]): SpriteDoc {
        return sprite({
            name: "Strip",
            frames: new Array<PixelBuffer | null>(count).fill(null),
            tags,
        });
    }
    const blank = (count: number) => new Array<PixelBuffer>(count).fill(createPixelBuffer(1, 1));

    it("is 65 536 entries for all animations of an atlas together", () => {
        expect(MAX_ATLAS_ENTRIES).toBe(65_536);
        expect(MAX_TAG_REPEAT).toBe(255);
    });

    it("an atlas of exactly 65 536 entries is written, every pass in it", () => {
        // 512 frames forward, 128 times: 512 × 128 = 65 536 entries.
        const doc = strip(512, [{ name: "long", from: 0, to: 511, repeat: 128 }]);
        const { meta, atlas } = atlasFor(blank(512), doc);

        expect(meta.animations.long.entries).toHaveLength(65_536);
        // 512 × 100 ms × 128 = 6 553 600 ms.
        expect(meta.animations.long.durationMs).toBe(6_553_600);
        expect(meta.animations.long.entries[65_535]).toEqual({ frame: "strip-511", ms: 100 });
        expect(meta.animations.long.entries[512]).toEqual({ frame: "strip-0", ms: 100 });
        // All 512 blank frames share one 2 × 2 rectangle: the atlas is 1 × (2 + 1) + 1 = 4.
        expect([atlas.width, atlas.height]).toEqual([4, 4]);
        expect(validateAtlas(JSON.parse(JSON.stringify(meta)), atlas)).toEqual(meta);
    });

    it("one entry more is refused, with the count and the limit", () => {
        // The 65 536 entries of the tag above and one frame once: 65 537.
        const doc = strip(512, [
            { name: "long", from: 0, to: 511, repeat: 128 },
            { name: "one", from: 7, to: 7, repeat: 1 },
        ]);
        const error = errorOf(ExportError, () => atlasFor(blank(512), doc));

        expect(error.code).toBe("too-many-entries");
        expect([error.count, error.limit]).toEqual([65_537, 65_536]);
        expect(error.message).toContain("65537 entries");
        expect(error.message).toContain("at most 65536");
        // Exported alone, each tag fits.
        const alone = exportSettings({ frames: { tagId: "tag-1" } });
        expect(Object.keys(atlasFor(blank(1), doc, alone).meta.animations)).toEqual(["one"]);
    });

    it("counts a ping-pong pass as 2n − 2 entries and a loop as one pass", () => {
        // 258 frames ping-pong: 2 × 258 − 2 = 514 entries a pass. 127 passes are 65 278,
        // 128 passes 65 792.
        const fits = strip(258, [
            { name: "bounce", from: 0, to: 257, direction: "pingpong", repeat: 127 },
        ]);
        expect(atlasFor(blank(258), fits).meta.animations.bounce.entries).toHaveLength(65_278);

        const over = strip(258, [
            { name: "bounce", from: 0, to: 257, direction: "pingpong", repeat: 128 },
        ]);
        const error = errorOf(ExportError, () => atlasFor(blank(258), over));
        expect([error.code, error.count]).toEqual(["too-many-entries", 65_792]);

        // With repeat 0 the same tag is one pass of 514, however long it plays.
        const loop = strip(258, [
            { name: "bounce", from: 0, to: 257, direction: "pingpong", repeat: 0 },
        ]);
        expect(atlasFor(blank(258), loop).meta.animations.bounce.entries).toHaveLength(514);
    });

    it("is checked before an entry is written out or a frame composited", () => {
        // The largest a document can ask for: 65 535 frames ping-pong, 255 times, in each of
        // 16 tags: 16 × 255 × (2 × 65 535 − 2) = 534 757 440 entries. Written out, they
        // would not fit in memory; the error comes at once and from every entry point.
        const tags = Array.from({ length: 16 }, (_, index): TagSpec => ({
            name: `t${index}`,
            from: 0,
            to: 65_534,
            direction: "pingpong",
            repeat: 255,
        }));
        const doc = strip(65_535, tags);
        const started = performance.now();
        const errors = [
            errorOf(ExportError, () => bundle(doc)),
            errorOf(ExportError, () => atlasFor([], doc)),
            errorOf(ExportError, () => exportFrameIndices(doc)),
        ];

        for (const error of errors) {
            expect([error.code, error.count, error.limit]).toEqual([
                "too-many-entries",
                534_757_440,
                65_536,
            ]);
        }
        expect(performance.now() - started).toBeLessThan(20_000);
    });
});

describe("the limit on frames", { timeout: 60_000 }, () => {
    const frames = (count: number): SpriteDoc => {
        const doc = sprite({ name: "Many", frames: [null] });
        doc.frames = Array.from({ length: count }, (_, index) => ({
            id: `f${index}`,
            durationMs: 1,
        }));
        return doc;
    };

    it("is 65 536 frames", () => {
        expect(MAX_ATLAS_FRAMES).toBe(65_536);
        // A document at the limit: its one animation, all frames once over, has 65 536 entries.
        expect(exportFrameIndices(frames(65_536))).toHaveLength(65_536);
    });

    it("one frame more is refused, with the count and the limit", () => {
        const error = errorOf(ExportError, () => exportFrameIndices(frames(65_537)));

        expect(error.code).toBe("too-many-frames");
        expect([error.count, error.limit]).toEqual([65_537, 65_536]);
        expect(errorOf(ExportError, () => atlasFor([], frames(65_537))).code).toBe(
            "too-many-frames",
        );
    });
});

describe("the errors of the export", () => {
    it("ExportError has a name, a code and the numbers of a limit", () => {
        const cause = new Error("inner");
        const error = new ExportError("too-many-entries", "Too many.", {
            count: 9,
            limit: 4,
            cause,
        });

        expect(error).toBeInstanceOf(Error);
        expect([error.name, error.code, error.message, error.count, error.limit]).toEqual([
            "ExportError",
            "too-many-entries",
            "Too many.",
            9,
            4,
        ]);
        expect(error.cause).toBe(cause);
        const plain = new ExportError("settings", "No.");
        expect([plain.count, plain.limit, plain.cause]).toEqual([undefined, undefined, undefined]);
        expect("cause" in plain).toBe(false);
    });

    it("AtlasError has a name, a code and the path of the member at fault", () => {
        const error = new AtlasError("bounds", 'frames["a"]', "Outside.");

        expect(error).toBeInstanceOf(Error);
        expect([error.name, error.code, error.path, error.message]).toEqual([
            "AtlasError",
            "bounds",
            'frames["a"]',
            "Outside.",
        ]);
    });
});
