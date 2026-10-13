import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { ATLAS_GENERATOR, bundle, pack } from "../../src/core/export";
import type { Bundle } from "../../src/core/export";
import type { ExportSettings, SpriteDoc } from "../../src/core/model";
import { cropPixels, pixelBuffersEqual } from "../../src/core/pixels";
import { exportSettings, grid, noise, show, sprite, textOf } from "./se-051-support";
import type { TagSpec } from "./se-051-support";

// `<name>.aseprite.json` (SPEC §9.5): the atlas in the shape of Aseprite's sprite-sheet data.
// The members and their order are those of Aseprite's own writer (src/app/doc_exporter.cpp
// of https://github.com/aseprite/aseprite): per frame `frame`, `rotated`, `trimmed`,
// `spriteSourceSize`, `sourceSize`, `duration`; in `meta` `app`, `version`, `image`,
// `format`, `size`, `scale`, `frameTags`; a tag's `repeat` a string, written when above 0.

interface SheetFrame {
    filename?: string;
    frame: { x: number; y: number; w: number; h: number };
    rotated: boolean;
    trimmed: boolean;
    spriteSourceSize: { x: number; y: number; w: number; h: number };
    sourceSize: { w: number; h: number };
    duration: number;
}

interface Sheet<Frames> {
    frames: Frames;
    meta: {
        app: string;
        version: string;
        image: string;
        format: string;
        size: { w: number; h: number };
        scale: string;
        frameTags: Record<string, unknown>[];
    };
}

function settings(
    form: "array" | "hash",
    change: Parameters<typeof exportSettings>[0] = {},
): ExportSettings {
    return exportSettings({ ...change, files: { asepriteJson: form } });
}

function arraySheet(made: Bundle): Sheet<SheetFrame[]> {
    return JSON.parse(textOf(made, ".aseprite.json")) as Sheet<SheetFrame[]>;
}

/** Two frames of 33 × 17, the odd size of the ticket. */
function odd(): SpriteDoc {
    return sprite({
        name: "Odd",
        frames: [noise(33, 17, 1), noise(33, 17, 2)],
        durations: [70, 130],
    });
}

describe("<name>.aseprite.json of a 33 × 17 document, not trimmed", () => {
    const made = bundle(odd(), settings("array"));
    const sheet = arraySheet(made);

    it("states every frame and source size as 33 × 17, not the padded 34 × 18", () => {
        // In the atlas the rectangles are even: 34 × 18 on a pitch of 35, at x 1 and 36.
        // The image is 2 × 35 + 1 = 71 wide and 1 × 19 + 1 = 20 high.
        expect(made.meta.frames["odd-0"]).toMatchObject({
            x: 1,
            y: 1,
            w: 34,
            h: 18,
            sourceW: 33,
            sourceH: 17,
        });
        expect(made.meta.frames["odd-1"]).toMatchObject({ x: 36, y: 1, w: 34, h: 18 });

        expect(sheet.frames).toEqual([
            {
                filename: "odd-0",
                frame: { x: 1, y: 1, w: 33, h: 17 },
                rotated: false,
                trimmed: false,
                spriteSourceSize: { x: 0, y: 0, w: 33, h: 17 },
                sourceSize: { w: 33, h: 17 },
                duration: 70,
            },
            {
                filename: "odd-1",
                frame: { x: 36, y: 1, w: 33, h: 17 },
                rotated: false,
                trimmed: false,
                spriteSourceSize: { x: 0, y: 0, w: 33, h: 17 },
                sourceSize: { w: 33, h: 17 },
                duration: 130,
            },
        ]);
        expect(sheet.meta.size).toEqual({ w: 71, h: 20 });
    });

    it("names each frame by its atlas ID", () => {
        expect(sheet.frames.map((frame) => frame.filename)).toEqual(Object.keys(made.meta.frames));
        expect(sheet.frames.map((frame) => frame.filename)).toEqual(["odd-0", "odd-1"]);
    });

    it("shows nothing of the even-size padding", () => {
        // No number of the frames is the 34 or the 18 of a rectangle.
        const numbers = JSON.stringify(sheet.frames).match(/\d+/g) ?? [];
        expect(numbers.length).toBeGreaterThan(20);
        expect(numbers).not.toContain("34");
        expect(numbers).not.toContain("18");
        for (const frame of sheet.frames) {
            expect(frame.trimmed).toBe(false);
            expect(frame.rotated).toBe(false);
        }
    });

    it("names the pixels of each frame: `frame` in the image is the whole composite", () => {
        const doc = odd();
        sheet.frames.forEach(({ frame }, index) => {
            const inAtlas = cropPixels(made.atlas, {
                x: frame.x,
                y: frame.y,
                width: frame.w,
                height: frame.h,
            });
            expect(pixelBuffersEqual(inAtlas, compositeFrame(doc, doc.frames[index].id))).toBe(
                true,
            );
        });
    });
});

describe("<name>.aseprite.json of trimmed frames", () => {
    // Two frames of 6 × 4, trimmed. The content of both is 3 × 2, so both rectangles are
    // 4 × 2: on a pitch of 5 across, at x 1 and 6.
    const doc = sprite({
        name: "Trim",
        frames: [
            // Against the right edge: the rectangle starts at 3 and 3 + 4 = 7 = 6 + 1.
            grid("......", "...ABC", "...DEF", "......"),
            // Inside the frame: the rectangle starts at 1 and ends at 5.
            grid(".GHI..", ".JKL..", "......", "......"),
        ],
    });
    const made = bundle(doc, settings("array", { trim: true }));
    const [edge, inside] = arraySheet(made).frames;

    it("a rectangle that reaches past the frame is stated without that column", () => {
        expect(made.meta.frames["trim-0"]).toMatchObject({
            x: 1,
            y: 1,
            w: 4,
            h: 2,
            offsetX: 3,
            offsetY: 1,
        });
        // min(4, 6 − 3) = 3 wide, min(2, 4 − 1) = 2 high.
        expect(edge).toEqual({
            filename: "trim-0",
            frame: { x: 1, y: 1, w: 3, h: 2 },
            rotated: false,
            trimmed: true,
            spriteSourceSize: { x: 3, y: 1, w: 3, h: 2 },
            sourceSize: { w: 6, h: 4 },
            duration: 100,
        });
    });

    it("a rectangle that ends inside the frame keeps its even size: the column is the frame's", () => {
        expect(made.meta.frames["trim-1"]).toMatchObject({
            x: 6,
            y: 1,
            w: 4,
            h: 2,
            offsetX: 1,
            offsetY: 0,
        });
        // min(4, 6 − 1) = 4 wide: the fourth column is column 4 of the frame, transparent.
        expect(inside).toEqual({
            filename: "trim-1",
            frame: { x: 6, y: 1, w: 4, h: 2 },
            rotated: false,
            trimmed: true,
            spriteSourceSize: { x: 1, y: 0, w: 4, h: 2 },
            sourceSize: { w: 6, h: 4 },
            duration: 100,
        });
    });

    it("in both, `frame` in the image holds the pixels `spriteSourceSize` names in the frame", () => {
        const crop = (frame: SheetFrame["frame"]) =>
            show(
                cropPixels(made.atlas, { x: frame.x, y: frame.y, width: frame.w, height: frame.h }),
            );

        expect(crop(edge.frame)).toEqual(["ABC", "DEF"]);
        expect(crop(inside.frame)).toEqual(["GHI.", "JKL."]);
    });

    it("a frame without a pixel is a trimmed 2 × 2 at the corner", () => {
        const empty = sprite({ name: "Gap", frames: [grid("AB", "CD", "EF"), null], size: [2, 3] });
        const [, gap] = arraySheet(bundle(empty, settings("array", { trim: true }))).frames;

        // Frame 0 is whole: 2 × 3 in a 2 × 4 rectangle. The empty frame: min(2, 2), min(2, 3).
        expect(gap).toMatchObject({
            frame: { x: 4, y: 1, w: 2, h: 2 },
            trimmed: true,
            spriteSourceSize: { x: 0, y: 0, w: 2, h: 2 },
            sourceSize: { w: 2, h: 3 },
        });
    });

    it("a frame whose content fills it is not trimmed, trim or not", () => {
        const full = sprite({ name: "Full", frames: [noise(5, 3, 1)] });
        const [frame] = arraySheet(bundle(full, settings("array", { trim: true }))).frames;

        expect(frame).toMatchObject({
            trimmed: false,
            frame: { w: 5, h: 3 },
            sourceSize: { w: 5, h: 3 },
        });
    });
});

describe("<name>.aseprite.json, array and hash", () => {
    const tags: TagSpec[] = [{ name: "Walk", from: 0, to: 1 }];
    const doc = () =>
        sprite({
            name: "Hero",
            frames: [grid("AB", "CD"), grid("EF", "GH"), grid("AB", "CD")],
            durations: [50, 60, 70],
            tags,
        });

    it("the hash form has the frames as members named by their IDs, without `filename`", () => {
        const array = arraySheet(bundle(doc(), settings("array")));
        const hash = JSON.parse(textOf(bundle(doc(), settings("hash")), ".aseprite.json")) as Sheet<
            Record<string, SheetFrame>
        >;

        expect(Object.keys(hash.frames)).toEqual(["hero-0", "hero-1", "hero-2"]);
        const unnamed = array.frames.map((frame) => {
            const copy = { ...frame };
            delete copy.filename;
            return copy;
        });
        expect(Object.values(hash.frames)).toEqual(unnamed);
        expect(Object.keys(hash.frames["hero-0"])).toEqual([
            "frame",
            "rotated",
            "trimmed",
            "spriteSourceSize",
            "sourceSize",
            "duration",
        ]);
        expect(hash.meta).toEqual(array.meta);
    });

    it("writes the members in Aseprite's order, indented by four spaces", () => {
        const made = bundle(doc(), settings("array"));
        const text = textOf(made, ".aseprite.json");
        const sheet = arraySheet(made);

        expect(Object.keys(sheet)).toEqual(["frames", "meta"]);
        expect(Object.keys(sheet.frames[0])).toEqual([
            "filename",
            "frame",
            "rotated",
            "trimmed",
            "spriteSourceSize",
            "sourceSize",
            "duration",
        ]);
        expect(Object.keys(sheet.meta)).toEqual([
            "app",
            "version",
            "image",
            "format",
            "size",
            "scale",
            "frameTags",
        ]);
        expect(text).toBe(`${JSON.stringify(sheet, null, 4)}\n`);
    });

    it("states the image, its size and format, and the application", () => {
        const { meta } = arraySheet(bundle(doc(), settings("array")));

        // Two rectangles (frame 2 repeats frame 0): 2 × 3 + 1 = 7 wide, 1 × 3 + 1 = 4 high.
        expect(meta).toMatchObject({
            image: "hero.png",
            format: "RGBA8888",
            size: { w: 7, h: 4 },
            // A string, as Aseprite writes it.
            scale: "1",
        });
        expect(`${meta.app} ${meta.version}`).toBe(ATLAS_GENERATOR);
        expect(meta.app).toBe("ngne-sprite-editor");
    });

    it("lists merged frames one by one, at the same place", () => {
        const { frames } = arraySheet(bundle(doc(), settings("array")));

        expect(frames).toHaveLength(3);
        expect(frames[2].frame).toEqual(frames[0].frame);
        expect([frames[0].duration, frames[1].duration, frames[2].duration]).toEqual([50, 60, 70]);
    });

    it("is written only when the settings ask for it", () => {
        const names = (form: ExportSettings["files"]["asepriteJson"]) =>
            bundle(doc(), exportSettings({ files: { asepriteJson: form } })).files.map(
                (file) => file.name,
            );

        expect(names("none")).not.toContain("hero.aseprite.json");
        expect(names("array")[4]).toBe("hero.aseprite.json");
        expect(names("hash")[4]).toBe("hero.aseprite.json");
    });
});

describe("<name>.aseprite.json, frame tags", () => {
    const frames = [grid("A"), grid("B"), grid("C"), grid("D")];

    it("has one tag per animation of the atlas, under its ID, as Aseprite writes tags", () => {
        const doc = sprite({
            name: "Hero",
            frames,
            tags: [
                {
                    name: "Walk",
                    from: 0,
                    to: 1,
                    direction: "forward",
                    repeat: 0,
                    color: 0x3cb371ff,
                },
                {
                    name: "walk",
                    from: 1,
                    to: 3,
                    direction: "pingpong",
                    repeat: 3,
                    color: 0xff000080,
                },
                {
                    name: "Fall Down",
                    from: 2,
                    to: 2,
                    direction: "reverse",
                    repeat: 255,
                    color: 0xabcdef00,
                },
            ],
        });
        const made = bundle(doc, settings("array"));

        expect(arraySheet(made).meta.frameTags).toEqual([
            // Repeat 0 plays without end: Aseprite writes no `repeat` then.
            { name: "walk", from: 0, to: 1, direction: "forward", color: "#3cb371ff" },
            {
                name: "walk-2",
                from: 1,
                to: 3,
                direction: "pingpong",
                repeat: "3",
                color: "#ff000080",
            },
            // A colour with alpha 0 is left out, as Aseprite leaves it out.
            { name: "fall-down", from: 2, to: 2, direction: "reverse", repeat: "255" },
        ]);
        expect(arraySheet(made).meta.frameTags.map((tag) => tag.name)).toEqual(
            Object.keys(made.meta.animations),
        );
        // The members in Aseprite's order.
        expect(Object.keys(arraySheet(made).meta.frameTags[1])).toEqual([
            "name",
            "from",
            "to",
            "direction",
            "repeat",
            "color",
        ]);
    });

    it("counts `from` and `to` in the frames of the file when one tag is exported", () => {
        const doc = sprite({
            name: "Hero",
            frames,
            tags: [
                { name: "a", from: 0, to: 1 },
                { name: "b", from: 2, to: 3, repeat: 1 },
            ],
        });
        const sheet = arraySheet(bundle(doc, settings("array", { frames: { tagId: "tag-1" } })));

        // Frames 2 and 3 of the document are frames 0 and 1 of this file.
        expect(sheet.frames.map((frame) => frame.filename)).toEqual(["hero-2", "hero-3"]);
        expect(sheet.meta.frameTags).toEqual([
            { name: "b", from: 0, to: 1, direction: "forward", repeat: "1", color: "#000000ff" },
        ]);
    });

    it("has the one animation of a document without tags, and none for a single frame", () => {
        const untagged = sprite({ name: "Hero Walk", frames });
        expect(arraySheet(bundle(untagged, settings("array"))).meta.frameTags).toEqual([
            { name: "hero-walk", from: 0, to: 3, direction: "forward" },
        ]);

        const single = sprite({ name: "Icon", frames: [grid("A")] });
        expect(arraySheet(bundle(single, settings("hash"))).meta.frameTags).toEqual([]);
    });
});

describe("<name>.aseprite.json of any document", { timeout: 60_000 }, () => {
    const pixel = fc.constantFrom(".", ".", "A", "B", "C");
    const documents = fc
        .record({
            width: fc.integer({ min: 1, max: 6 }),
            height: fc.integer({ min: 1, max: 5 }),
            count: fc.integer({ min: 1, max: 5 }),
            trim: fc.boolean(),
            mergeDuplicates: fc.boolean(),
            padding: fc.integer({ min: 0, max: 3 }),
            extrude: fc.integer({ min: 0, max: 2 }),
            form: fc.constantFrom("array" as const, "hash" as const),
        })
        .chain((shape) =>
            fc
                .array(
                    fc.array(
                        fc.string({ unit: pixel, minLength: shape.width, maxLength: shape.width }),
                        {
                            minLength: shape.height,
                            maxLength: shape.height,
                        },
                    ),
                    { minLength: shape.count, maxLength: shape.count },
                )
                .map((rows) => ({ ...shape, rows })),
        );

    it("names, for every frame, pixels of the image that are the pixels of its composite", () => {
        fc.assert(
            fc.property(documents, ({ rows, trim, mergeDuplicates, padding, extrude, form }) => {
                const doc = sprite({ name: "Any", frames: rows.map((frame) => grid(...frame)) });
                const made = bundle(
                    doc,
                    settings(form, { trim, mergeDuplicates, padding, extrude }),
                );
                const sheet = JSON.parse(textOf(made, ".aseprite.json")) as Sheet<
                    SheetFrame[] | Record<string, SheetFrame>
                >;
                const list = Array.isArray(sheet.frames)
                    ? sheet.frames
                    : Object.values(sheet.frames);

                expect(list).toHaveLength(doc.frames.length);
                expect(sheet.meta.size).toEqual({ w: made.atlas.width, h: made.atlas.height });
                // The size stated is the content size the packer reports for the rectangle.
                const composites = doc.frames.map((frame) => compositeFrame(doc, frame.id));
                const { rects } = pack(composites, { trim, mergeDuplicates, padding, extrude });
                for (const rect of rects) {
                    for (const index of rect.frameIndices) {
                        expect(list[index].frame).toEqual({
                            x: rect.x,
                            y: rect.y,
                            w: rect.contentW,
                            h: rect.contentH,
                        });
                        expect(list[index].spriteSourceSize).toEqual({
                            x: rect.offsetX,
                            y: rect.offsetY,
                            w: rect.contentW,
                            h: rect.contentH,
                        });
                    }
                }
                list.forEach(
                    ({ frame, spriteSourceSize: inSource, sourceSize, trimmed }, index) => {
                        expect(sourceSize).toEqual({ w: doc.width, h: doc.height });
                        expect([frame.w, frame.h]).toEqual([inSource.w, inSource.h]);
                        // Inside the source frame and inside the image.
                        expect(inSource.x + inSource.w).toBeLessThanOrEqual(doc.width);
                        expect(inSource.y + inSource.h).toBeLessThanOrEqual(doc.height);
                        expect(frame.x + frame.w).toBeLessThanOrEqual(made.atlas.width);
                        expect(frame.y + frame.h).toBeLessThanOrEqual(made.atlas.height);
                        const whole =
                            inSource.x === 0 &&
                            inSource.y === 0 &&
                            frame.w === doc.width &&
                            frame.h === doc.height;
                        expect(trimmed).toBe(!whole);
                        if (!trim) expect(trimmed).toBe(false);

                        const composite = compositeFrame(doc, doc.frames[index].id);
                        const inAtlas = cropPixels(made.atlas, {
                            x: frame.x,
                            y: frame.y,
                            width: frame.w,
                            height: frame.h,
                        });
                        const named = cropPixels(composite, {
                            x: inSource.x,
                            y: inSource.y,
                            width: inSource.w,
                            height: inSource.h,
                        });
                        expect(pixelBuffersEqual(inAtlas, named)).toBe(true);
                        // What the frame leaves out of the source frame is transparent.
                        const outside = show(composite).map((row, y) =>
                            [...row]
                                .filter(
                                    (_, x) =>
                                        x < inSource.x ||
                                        x >= inSource.x + inSource.w ||
                                        y < inSource.y ||
                                        y >= inSource.y + inSource.h,
                                )
                                .join(""),
                        );
                        expect(outside.join("")).toMatch(/^\.*$/);
                    },
                );
            }),
            { numRuns: 200 },
        );
    });
});
