import { posix, win32 } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    AtlasError,
    MAX_ATLAS_ENTRIES,
    MAX_ATLAS_FRAMES,
    MAX_ATLAS_SIDE,
    MAX_ENTRY_MS,
    bundle,
    validateAtlas,
} from "../../src/core/export";
import type { AtlasErrorCode } from "../../src/core/export";
import { errorOf, exportSettings, heroWalk, textOf } from "./se-051-support";

// `validateAtlas`: the rules of `ngne-sprite-atlas` version 1 (docs/FORMAT.md §2), and
// what it does with a value that is not an atlas at all. Its input is untrusted.

type Json = Record<string, unknown>;

const SIZE = { width: 67, height: 67 };

/** Control characters, made from their numbers so that this file holds none. */
const CONTROL = {
    nul: String.fromCharCode(0x00),
    tab: String.fromCharCode(0x09),
    lineFeed: String.fromCharCode(0x0a),
    del: String.fromCharCode(0x7f),
    nextLine: String.fromCharCode(0x85),
};

/**
 * A valid atlas, written out by hand: the example of SPEC §9.2 with a second frame, whose
 * 31 × 31 source frame lies in an even 32 × 32 rectangle (0 + 32 = 31 + 1), and an
 * animation of 100 + 200 = 300 ms. Two rectangles of 32 × 32 with padding 1 fill the top
 * row of a 67 × 67 image: 1..33 and 34..66.
 */
function valid(): {
    format: string;
    version: number;
    generator: string;
    image: string;
    width: number;
    height: number;
    frames: Record<string, Json>;
    animations: Record<string, { playback: string; durationMs: number; entries: Json[] }>;
} {
    return {
        format: "ngne-sprite-atlas",
        version: 1,
        generator: "ngne-sprite-editor 1.0.0",
        image: "hero.png",
        width: 67,
        height: 67,
        frames: {
            "hero-0": {
                x: 1,
                y: 1,
                w: 32,
                h: 32,
                sourceW: 32,
                sourceH: 32,
                offsetX: 0,
                offsetY: 0,
                pivot: [0.5, 0.5],
            },
            "hero-1": {
                x: 34,
                y: 1,
                w: 32,
                h: 32,
                sourceW: 31,
                sourceH: 31,
                offsetX: 0,
                offsetY: 0,
                pivot: [0.5, 1],
            },
        },
        animations: {
            walk: {
                playback: "loop",
                durationMs: 300,
                entries: [
                    { frame: "hero-0", ms: 100 },
                    { frame: "hero-1", ms: 200 },
                ],
            },
        },
    };
}

type Atlas = ReturnType<typeof valid>;

/** The error for a valid atlas after `damage`. */
function refused(damage: (atlas: Atlas) => void, size = SIZE): AtlasError {
    const atlas = valid();
    damage(atlas);
    return errorOf(AtlasError, () => validateAtlas(atlas, size));
}

/** Expects `damage` to be refused with this code at this path. */
function expectRefused(
    damage: (atlas: Atlas) => void,
    code: AtlasErrorCode,
    path: string,
): AtlasError {
    const error = refused(damage);
    expect([error.code, error.path], error.message).toEqual([code, path]);
    return error;
}

describe("validateAtlas accepts", () => {
    it("a valid atlas, and returns it", () => {
        expect(validateAtlas(valid(), SIZE)).toEqual(valid());
    });

    it("returns a new object with the members of the format in their order", () => {
        const atlas = valid();
        const result = validateAtlas(atlas, SIZE);

        expect(result).not.toBe(atlas);
        expect(result.frames).not.toBe(atlas.frames);
        expect(result.frames["hero-0"]).not.toBe(atlas.frames["hero-0"]);
        expect(result.animations.walk.entries).not.toBe(atlas.animations.walk.entries);
        expect(JSON.stringify(result)).toBe(JSON.stringify(valid()));

        // Whatever the order in the file.
        const shuffled = Object.fromEntries(Object.entries(valid()).reverse()) as Atlas;
        shuffled.frames["hero-0"] = Object.fromEntries(
            Object.entries(shuffled.frames["hero-0"]).reverse(),
        );
        expect(JSON.stringify(validateAtlas(shuffled, SIZE))).toBe(JSON.stringify(valid()));
    });

    it("leaves out members the format does not name, at every level", () => {
        const atlas = valid() as Atlas & Json;
        atlas.comment = "made by hand";
        atlas.meta = { app: "other" };
        atlas.frames["hero-0"].rotated = false;
        atlas.frames["hero-0"].name = "idle";
        Object.assign(atlas.animations.walk, { loop: true, fps: 10 });
        atlas.animations.walk.entries[0].event = "step";

        expect(validateAtlas(atlas, SIZE)).toEqual(valid());
    });

    it("an image under any plain file name", () => {
        const names = [
            "hero.png",
            "hero",
            ".hero.png",
            "hero..png",
            "hero.",
            "a.b.c.png",
            "hero walk.png",
            " hero.png",
            "hero.PNG",
            "héro.png",
            "英雄.png",
            // Not devices: a device name is the whole part before the first dot.
            "console.png",
            "null.png",
            "nul-sprite.png",
            "com10.png",
            "com.png",
            "lpt.png",
            "hero.con",
            "hero.nul.png",
            `${"x".repeat(300)}.png`,
        ];
        for (const image of names) {
            const atlas = valid();
            atlas.image = image;
            expect(validateAtlas(atlas, SIZE).image, image).toBe(image);
        }
    });

    it("a rectangle in the last corner of the largest image", () => {
        // 8190 + 2 = 8192: the largest x and y a frame can have.
        const atlas = valid();
        atlas.width = 8192;
        atlas.height = 8192;
        Object.assign(atlas.frames["hero-1"], {
            x: 8190,
            y: 8190,
            w: 2,
            h: 2,
            sourceW: 2,
            sourceH: 2,
        });
        const result = validateAtlas(atlas, { width: 8192, height: 8192 });

        expect(result.frames["hero-1"]).toMatchObject({ x: 8190, y: 8190, w: 2, h: 2 });
    });

    it("a rectangle that touches the edge of the image", () => {
        // 35 + 32 = 67 and 35 + 32 = 67: the last column and row of the image.
        const atlas = valid();
        Object.assign(atlas.frames["hero-1"], { x: 35, y: 35 });
        expect(validateAtlas(atlas, SIZE).frames["hero-1"]).toMatchObject({ x: 35, y: 35 });
    });

    it("a rectangle one pixel past its source frame, on either axis", () => {
        const atlas = valid();
        // 4 + 32 = 36 = 35 + 1 across; 0 + 32 = 32 = 31 + 1 down.
        Object.assign(atlas.frames["hero-1"], { sourceW: 35, offsetX: 4 });
        expect(validateAtlas(atlas, SIZE).frames["hero-1"]).toMatchObject({
            sourceW: 35,
            offsetX: 4,
        });
        // A rectangle well inside a large source frame.
        Object.assign(atlas.frames["hero-1"], {
            sourceW: 8192,
            sourceH: 8192,
            offsetX: 4000,
            offsetY: 8159,
        });
        expect(validateAtlas(atlas, SIZE).frames["hero-1"]).toMatchObject({ offsetY: 8159 });
    });

    it("a pivot on the edge of the frame, and no animation", () => {
        const atlas = valid();
        atlas.frames["hero-0"].pivot = [0, 1];
        atlas.animations = {};
        expect(validateAtlas(atlas, SIZE)).toMatchObject({
            frames: { "hero-0": { pivot: [0, 1] } },
            animations: {},
        });
    });

    it("the two kinds of playback, entries of 1 and of 65 535 ms, a frame shown twice", () => {
        expect(MAX_ENTRY_MS).toBe(65_535);
        const atlas = valid();
        atlas.animations.once = {
            playback: "once",
            // 1 + 65 535 + 1 = 65 537.
            durationMs: 65_537,
            entries: [
                { frame: "hero-1", ms: 1 },
                { frame: "hero-1", ms: 65_535 },
                { frame: "hero-0", ms: 1 },
            ],
        };
        expect(validateAtlas(atlas, SIZE).animations.once.durationMs).toBe(65_537);
    });

    it("numbers that JSON writes in another way", () => {
        const text = JSON.stringify(valid())
            .replace('"x":1,', '"x":1.0,')
            .replace('"w":32,', '"w":3.2e1,')
            .replace('"offsetX":0,', '"offsetX":-0,');
        expect(text).toContain("3.2e1");
        const result = validateAtlas(JSON.parse(text), SIZE);

        expect(result).toEqual(valid());
        // −0 is the integer 0.
        expect(Object.is(result.frames["hero-0"].offsetX, 0)).toBe(true);
    });

    it("the atlas JSON of a bundle, which it gives back as it is written", () => {
        for (const settings of [
            exportSettings(),
            exportSettings({ trim: true, extrude: 2, padding: 0, layout: "row" }),
        ]) {
            const made = bundle(heroWalk(), settings);
            const text = textOf(made, ".atlas.json");
            const result = validateAtlas(JSON.parse(text), made.atlas);

            expect(result).toEqual(made.meta);
            expect(`${JSON.stringify(result, null, 4)}\n`).toBe(text);
        }
    });
});

describe("validateAtlas rejects", () => {
    it("a value that is not an atlas", () => {
        for (const value of [null, undefined, 5, "atlas", true, [], [valid()], () => valid()]) {
            const error = errorOf(AtlasError, () => validateAtlas(value, SIZE));
            expect([error.code, error.path], String(value)).toEqual(["format", ""]);
        }
        for (const format of ["ngne-sprite-project", "", "NGNE-SPRITE-ATLAS", 1, null, undefined]) {
            expectRefused((atlas) => Object.assign(atlas, { format }), "format", "format");
        }
        expectRefused((atlas) => delete (atlas as Json).format, "format", "format");
        expect(refused((atlas) => (atlas.format = "aseprite")).message).toBe(
            '`format` must be "ngne-sprite-atlas", got "aseprite": this is not a sprite atlas.',
        );
    });

    it("a newer version, by its number, before it looks at anything else", () => {
        const error = refused((atlas) => {
            atlas.version = 2;
            // What a later version might hold cannot be known.
            (atlas as Json).frames = "elsewhere";
        });

        expect([error.code, error.path]).toEqual(["newer-version", "version"]);
        expect(error.message).toBe("`version` is 2; this reader knows the format up to version 1.");
        for (const version of [0, -1, 1.5, "1", null, [1]]) {
            expectRefused((atlas) => Object.assign(atlas, { version }), "field", "version");
        }
    });

    it("a missing member, wherever it is missing", () => {
        for (const key of [
            "version",
            "generator",
            "image",
            "width",
            "height",
            "frames",
            "animations",
        ]) {
            const error = expectRefused((atlas) => delete (atlas as Json)[key], "field", "");
            expect(error.message).toBe(`The atlas has no member \`${key}\`.`);
        }
        for (const key of [
            "x",
            "y",
            "w",
            "h",
            "sourceW",
            "sourceH",
            "offsetX",
            "offsetY",
            "pivot",
        ]) {
            const error = expectRefused(
                (atlas) => delete atlas.frames["hero-1"][key],
                "field",
                'frames["hero-1"]',
            );
            expect(error.message).toBe(`\`frames["hero-1"]\` has no member \`${key}\`.`);
        }
        for (const key of ["playback", "durationMs", "entries"]) {
            expectRefused(
                (atlas) => delete (atlas.animations.walk as Json)[key],
                "field",
                'animations["walk"]',
            );
        }
        for (const key of ["frame", "ms"]) {
            expectRefused(
                (atlas) => delete atlas.animations.walk.entries[1][key],
                "field",
                'animations["walk"].entries[1]',
            );
        }
    });

    it("a member of the wrong type", () => {
        expectRefused((atlas) => Object.assign(atlas, { generator: 1 }), "field", "generator");
        expectRefused((atlas) => Object.assign(atlas, { image: null }), "field", "image");
        expectRefused((atlas) => Object.assign(atlas, { frames: [] }), "field", "frames");
        expectRefused((atlas) => Object.assign(atlas, { frames: null }), "field", "frames");
        expectRefused(
            (atlas) => Object.assign(atlas, { animations: "none" }),
            "field",
            "animations",
        );
        expectRefused(
            (atlas) => Object.assign(atlas.frames, { "hero-0": [1, 1, 32, 32] }),
            "field",
            'frames["hero-0"]',
        );
        expectRefused(
            (atlas) => Object.assign(atlas.animations, { walk: null }),
            "field",
            'animations["walk"]',
        );
        expectRefused(
            (atlas) => Object.assign(atlas.animations.walk, { entries: {} }),
            "field",
            'animations["walk"].entries',
        );
        expectRefused(
            (atlas) => (atlas.animations.walk.entries[0] = [] as unknown as Json),
            "field",
            'animations["walk"].entries[0]',
        );
        expectRefused(
            (atlas) => (atlas.animations.walk.entries[0].frame = 0),
            "field",
            'animations["walk"].entries[0].frame',
        );
        expectRefused(
            (atlas) => (atlas.animations.walk.playback = "pingpong"),
            "field",
            'animations["walk"].playback',
        );
        expectRefused(
            (atlas) => Object.assign(atlas.animations.walk, { playback: true }),
            "field",
            'animations["walk"].playback',
        );
    });

    it("an image name that is not a plain file name", () => {
        const refusedNames = [
            // No name, a folder, a drive.
            "",
            "atlas/hero.png",
            "..\\hero.png",
            "/hero.png",
            "C:\\hero.png",
            // A drive without a folder is a path on Windows; a colon also names a stream.
            "C:hero.png",
            "hero.png:Zone.Identifier",
            ":",
            // The folder itself and the one above it.
            ".",
            "..",
            "...",
            // Control characters: NUL, line feed, tab, DEL and one of U+0080 to U+009F.
            `a${CONTROL.nul}.png`,
            `hero${CONTROL.lineFeed}.png`,
            `${CONTROL.tab}hero.png`,
            `hero.png${CONTROL.del}`,
            `hero${CONTROL.nextLine}.png`,
            // Devices of Windows, whatever the case, the extension and the spaces behind.
            "CON",
            "con",
            "Con.png",
            "nul",
            "NUL.tar.gz",
            "aux .png",
            "PRN",
            "COM1",
            "com0.png",
            "lpt9.png",
            "LPT1",
        ];
        for (const image of refusedNames) {
            const error = expectRefused((atlas) => (atlas.image = image), "field", "image");
            expect(error.message, JSON.stringify(image)).toContain("must be a plain file name");
        }
        expect(refused((atlas) => (atlas.image = "C:hero.png")).message).toBe(
            "`image` must be a plain file name, without a folder, a drive, a control character " +
                'or the name of a device, got "C:hero.png".',
        );
        // A control character is shown by its number, not put into the message.
        const message = refused((atlas) => (atlas.image = `a${CONTROL.nul}.png`)).message;
        expect(message).toContain('got "a\\u0000.png"');
        expect(message.includes(CONTROL.nul)).toBe(false);
    });

    it("a rectangle that is not made of integers", () => {
        for (const key of ["x", "y", "w", "h", "sourceW", "sourceH", "offsetX", "offsetY"]) {
            for (const value of [1.5, "1", null, true, [2], NaN, Infinity, -1]) {
                const error = expectRefused(
                    (atlas) => (atlas.frames["hero-0"][key] = value),
                    "field",
                    `frames["hero-0"].${key}`,
                );
                expect(error.message).toContain("must be an integer from");
            }
        }
        // The smallest rectangle is 2 × 2 and the largest image 8192 a side: 8192 − 2 = 8190.
        expect(refused((atlas) => (atlas.frames["hero-0"].x = 1.5)).message).toBe(
            '`frames["hero-0"].x` must be an integer from 0 to 8190, got 1.5.',
        );
        for (const beyond of [8191, 8192, 8193]) {
            expectRefused(
                (atlas) => (atlas.frames["hero-0"].x = beyond),
                "field",
                'frames["hero-0"].x',
            );
            expectRefused(
                (atlas) => (atlas.frames["hero-0"].y = beyond),
                "field",
                'frames["hero-0"].y',
            );
        }
    });

    it("an odd w or h", () => {
        const width = expectRefused(
            (atlas) => (atlas.frames["hero-0"].w = 31),
            "field",
            'frames["hero-0"].w',
        );
        expect(width.message).toBe('`frames["hero-0"].w` must be even, got 31.');
        expectRefused((atlas) => (atlas.frames["hero-0"].h = 33), "field", 'frames["hero-0"].h');
        // Nor a rectangle of no size.
        expectRefused((atlas) => (atlas.frames["hero-0"].w = 0), "field", 'frames["hero-0"].w');
        expectRefused((atlas) => (atlas.frames["hero-0"].h = 1), "field", 'frames["hero-0"].h');
    });

    it("a rectangle outside the image", () => {
        // 36 + 32 = 68, one pixel past the 67 of the image.
        const right = expectRefused(
            (atlas) => (atlas.frames["hero-1"].x = 36),
            "bounds",
            'frames["hero-1"]',
        );
        expect(right.message).toBe(
            '`frames["hero-1"]` covers 36, 1 to 68, 33, outside the image of 67x67 px.',
        );
        expectRefused((atlas) => (atlas.frames["hero-1"].y = 36), "bounds", 'frames["hero-1"]');
        expectRefused((atlas) => (atlas.frames["hero-0"].w = 68), "bounds", 'frames["hero-0"]');
        // The last x a frame can have at all: 8190 + 32 is far outside this image.
        expectRefused((atlas) => (atlas.frames["hero-0"].x = 8190), "bounds", 'frames["hero-0"]');
        // A corrupted bundle: a rectangle of the fixture moved out of its 22 × 11 image.
        const made = bundle(heroWalk());
        const corrupted = JSON.parse(textOf(made, ".atlas.json")) as Atlas;
        corrupted.frames["hero-walk-4"].x = 17;
        const error = errorOf(AtlasError, () => validateAtlas(corrupted, made.atlas));
        // 17 + 6 = 23 > 22.
        expect([error.code, error.path]).toEqual(["bounds", 'frames["hero-walk-4"]']);
    });

    it("a rectangle more than one pixel past its source frame", () => {
        // 0 + 32 = 32 = 30 + 2.
        const error = expectRefused(
            (atlas) => (atlas.frames["hero-1"].sourceW = 30),
            "bounds",
            'frames["hero-1"]',
        );
        expect(error.message).toBe(
            '`frames["hero-1"]` reaches 2 px past its source frame of 30x31 px; at most 1 px is allowed.',
        );
        expectRefused(
            (atlas) => (atlas.frames["hero-1"].sourceH = 30),
            "bounds",
            'frames["hero-1"]',
        );
        expectRefused(
            (atlas) => (atlas.frames["hero-0"].offsetX = 2),
            "bounds",
            'frames["hero-0"]',
        );
        // An offset outside the source frame leaves no content at all.
        expectRefused(
            (atlas) => (atlas.frames["hero-0"].offsetX = 32),
            "field",
            'frames["hero-0"].offsetX',
        );
        expectRefused(
            (atlas) => (atlas.frames["hero-0"].offsetY = 40),
            "field",
            'frames["hero-0"].offsetY',
        );
        expectRefused(
            (atlas) => (atlas.frames["hero-0"].sourceW = 0),
            "field",
            'frames["hero-0"].sourceW',
        );
        expectRefused(
            (atlas) => (atlas.frames["hero-0"].sourceH = 8193),
            "field",
            'frames["hero-0"].sourceH',
        );
    });

    it("a pivot that is not two numbers from 0 to 1", () => {
        for (const pivot of [[0.5], [0.5, 0.5, 0.5], "0.5,0.5", { x: 0.5, y: 0.5 }, null, 0.5]) {
            expectRefused(
                (atlas) => (atlas.frames["hero-0"].pivot = pivot),
                "field",
                'frames["hero-0"].pivot',
            );
        }
        for (const part of ["0.5", null, -0.01, 1.01, NaN, Infinity, [0.5]]) {
            expectRefused(
                (atlas) => (atlas.frames["hero-0"].pivot = [part, 0.5]),
                "field",
                'frames["hero-0"].pivot[0]',
            );
            expectRefused(
                (atlas) => (atlas.frames["hero-0"].pivot = [0.5, part]),
                "field",
                'frames["hero-0"].pivot[1]',
            );
        }
    });

    it("a size that is not that of the image", () => {
        expect(MAX_ATLAS_SIDE).toBe(8192);
        for (const size of [
            { width: 68, height: 67 },
            { width: 67, height: 66 },
            { width: 134, height: 134 },
        ]) {
            const error = refused(() => undefined, size);
            expect([error.code, error.path]).toEqual(["image-size", ""]);
        }
        expect(refused(() => undefined, { width: 68, height: 67 }).message).toBe(
            "The atlas states an image of 67x67 px, but the image is 68x67 px.",
        );
        // A size that is none: the caller's mistake is reported like any other.
        const none: unknown[] = [null, undefined, {}, { width: "67", height: 67 }, [67, 67], 67];
        for (const size of none) {
            const error = errorOf(AtlasError, () => validateAtlas(valid(), size as typeof SIZE));
            expect(error.code, JSON.stringify(size)).toBe("image-size");
        }
        for (const side of [0, -67, 8193, 67.5, "67", null]) {
            expectRefused((atlas) => Object.assign(atlas, { width: side }), "field", "width");
            expectRefused((atlas) => Object.assign(atlas, { height: side }), "field", "height");
        }
    });

    it("a bad ID of a frame or an animation", () => {
        const long = "x".repeat(81);
        for (const id of [
            "Hero-9",
            "-hero",
            "_hero",
            "hero 0",
            "hero.0",
            "",
            "héro",
            long,
            "hero/0",
        ]) {
            const frame = expectRefused(
                (atlas) => (atlas.frames[id] = atlas.frames["hero-0"]),
                "id",
                "frames",
            );
            expect(frame.message).toContain("an ID is 1 to 80 characters of a-z, 0-9");
            expectRefused(
                (atlas) => (atlas.animations[id] = atlas.animations.walk),
                "id",
                "animations",
            );
        }
        // A long name is cut in the message.
        expect(
            refused((atlas) => (atlas.frames["Y".repeat(10_000)] = atlas.frames["hero-0"])).message
                .length,
        ).toBeLessThan(300);
    });

    it("IDs that differ only by case", () => {
        const frame = expectRefused(
            (atlas) => (atlas.frames["Hero-0"] = atlas.frames["hero-0"]),
            "id",
            "frames",
        );
        expect(frame.message).toBe(
            '`frames` has the IDs "hero-0" and "Hero-0", which differ only by case.',
        );
        const animation = expectRefused(
            (atlas) => (atlas.animations.WALK = atlas.animations.walk),
            "id",
            "animations",
        );
        expect(animation.message).toBe(
            '`animations` has the IDs "walk" and "WALK", which differ only by case.',
        );
    });

    it("an animation that names an unknown frame", () => {
        const error = expectRefused(
            (atlas) => (atlas.animations.walk.entries[1].frame = "hero-2"),
            "frame-reference",
            'animations["walk"].entries[1].frame',
        );
        expect(error.message).toBe(
            '`animations["walk"].entries[1].frame` names "hero-2", which is no frame of the atlas.',
        );
        // Neither is a member every object inherits, nor an animation's own ID.
        for (const frame of [
            "constructor",
            "toString",
            "__proto__",
            "hasOwnProperty",
            "walk",
            "Hero-0",
            "",
        ]) {
            expectRefused(
                (atlas) => (atlas.animations.walk.entries[0].frame = frame),
                "frame-reference",
                'animations["walk"].entries[0].frame',
            );
        }
    });

    it("an ms that is not a positive integer", () => {
        for (const ms of [0, -100, 1.5, "100", null, NaN, Infinity, 65_536]) {
            const error = expectRefused(
                (atlas) => (atlas.animations.walk.entries[0].ms = ms),
                "field",
                'animations["walk"].entries[0].ms',
            );
            expect(error.message).toContain("must be an integer from 1 to 65535");
        }
    });

    it("a durationMs that is not the sum of the entries", () => {
        for (const durationMs of [299, 301, 100, 600]) {
            const error = expectRefused(
                (atlas) => (atlas.animations.walk.durationMs = durationMs),
                "duration",
                'animations["walk"].durationMs',
            );
            expect(error.message).toBe(
                `\`animations["walk"].durationMs\` is ${durationMs}, but the entries add up to 300.`,
            );
        }
        // An entry changed without the sum: 150 + 200 = 350.
        expectRefused(
            (atlas) => (atlas.animations.walk.entries[0].ms = 150),
            "duration",
            'animations["walk"].durationMs',
        );
        for (const durationMs of [0, 300.5, "300", null]) {
            expectRefused(
                (atlas) => Object.assign(atlas.animations.walk, { durationMs }),
                "field",
                'animations["walk"].durationMs',
            );
        }
    });

    it("an atlas without a frame, and an animation without an entry", () => {
        const frames = expectRefused(
            (atlas) => {
                atlas.frames = {};
                atlas.animations = {};
            },
            "field",
            "frames",
        );
        expect(frames.message).toBe("`frames` must hold at least one frame.");
        expectRefused(
            (atlas) => (atlas.animations.walk.entries = []),
            "field",
            'animations["walk"].entries',
        );
    });
});

// Atlases at the limits, and thousands of generated values: slow on a busy machine.
describe("validateAtlas, the limits of the format", { timeout: 60_000 }, () => {
    const frame = () => valid().frames["hero-0"];

    it("accepts 65 536 frames and refuses one more", () => {
        expect(MAX_ATLAS_FRAMES).toBe(65_536);
        const atlas = valid();
        const shared = frame();
        atlas.frames = Object.fromEntries(
            Array.from({ length: 65_536 }, (_, index) => [`f${index}`, shared]),
        );
        atlas.animations = {};
        expect(Object.keys(validateAtlas(atlas, SIZE).frames)).toHaveLength(65_536);

        atlas.frames.extra = shared;
        const error = errorOf(AtlasError, () => validateAtlas(atlas, SIZE));
        expect([error.code, error.path]).toEqual(["limit", "frames"]);
        expect(error.message).toBe("`frames` holds 65537 frames; at most 65536 are allowed.");
    });

    it("accepts 65 536 entries in all and refuses one more, in whichever animation it is", () => {
        expect(MAX_ATLAS_ENTRIES).toBe(65_536);
        const entry = { frame: "hero-0", ms: 2 };
        const atlas = valid();
        // 65 535 entries of 2 ms and one of 1 ms: 131 070 ms and 1 ms.
        atlas.animations = {
            long: {
                playback: "once",
                durationMs: 131_070,
                entries: new Array<Json>(65_535).fill(entry),
            },
            short: { playback: "loop", durationMs: 1, entries: [{ frame: "hero-1", ms: 1 }] },
        };
        const result = validateAtlas(atlas, SIZE);
        expect(result.animations.long.entries).toHaveLength(65_535);
        expect(result.animations.short.entries).toHaveLength(1);

        atlas.animations.short = {
            playback: "loop",
            durationMs: 2,
            entries: [
                { frame: "hero-1", ms: 1 },
                { frame: "hero-1", ms: 1 },
            ],
        };
        const error = errorOf(AtlasError, () => validateAtlas(atlas, SIZE));
        expect([error.code, error.path]).toEqual(["limit", 'animations["short"].entries']);
        expect(error.message).toContain("65536 animation entries");
    });

    it("refuses a list beyond the limit by its length, without reading it", () => {
        const atlas = valid();
        // An array of 4 294 967 295 holes: reading it entry by entry would not end.
        atlas.animations.walk.entries = new Array<Json>(2 ** 32 - 1);
        const started = performance.now();
        const error = errorOf(AtlasError, () => validateAtlas(atlas, SIZE));

        expect([error.code, error.path]).toEqual(["limit", 'animations["walk"].entries']);
        expect(performance.now() - started).toBeLessThan(10_000);
    });

    it("accepts the longest duration an atlas can state", () => {
        const atlas = valid();
        const entry = { frame: "hero-0", ms: 65_535 };
        // 65 536 × 65 535 = 4 294 901 760 ms.
        atlas.animations = {
            long: {
                playback: "once",
                durationMs: 4_294_901_760,
                entries: new Array<Json>(65_536).fill(entry),
            },
        };
        expect(validateAtlas(atlas, SIZE).animations.long.durationMs).toBe(65_536 * 65_535);
    });
});

describe("validateAtlas and untrusted input", { timeout: 60_000 }, () => {
    it("reads own members only: a prototype is not part of the JSON", () => {
        const inherited = Object.create(valid()) as unknown;
        expect(errorOf(AtlasError, () => validateAtlas(inherited, SIZE)).code).toBe("format");

        const atlas = valid();
        atlas.frames["hero-0"] = Object.create(atlas.frames["hero-0"]) as Json;
        const error = errorOf(AtlasError, () => validateAtlas(atlas, SIZE));
        expect(error.message).toBe('`frames["hero-0"]` has no member `x`.');
    });

    it("treats `__proto__` as the name of a member, in the text and in the value", () => {
        // A member called __proto__ at the top: it is not one the format names.
        const text = JSON.stringify(valid()).replace(
            "{",
            '{"__proto__":{"format":"x","polluted":true},',
        );
        const parsed = JSON.parse(text) as Json;
        expect(Object.keys(parsed)).toContain("__proto__");
        expect(validateAtlas(parsed, SIZE)).toEqual(valid());

        // As the name of a frame it is a bad ID, and nothing more.
        const frames = JSON.stringify(valid()).replace(
            '"frames":{',
            '"frames":{"__proto__":{"x":0},',
        );
        const error = errorOf(AtlasError, () => validateAtlas(JSON.parse(frames), SIZE));
        expect([error.code, error.path]).toEqual(["id", "frames"]);

        expect(({} as Json).polluted).toBeUndefined();
        expect(({} as Json).x).toBeUndefined();
    });

    it("takes IDs that are names of members of Object as IDs", () => {
        const atlas = valid();
        atlas.frames = { constructor: atlas.frames["hero-0"], valueof: atlas.frames["hero-1"] };
        atlas.animations = {
            constructor: {
                playback: "once",
                durationMs: 3,
                entries: [
                    { frame: "constructor", ms: 1 },
                    { frame: "valueof", ms: 2 },
                ],
            },
        };
        const result = validateAtlas(atlas, SIZE);

        expect(Object.keys(result.frames)).toEqual(["constructor", "valueof"]);
        expect(Object.hasOwn(result.frames, "constructor")).toBe(true);
        // Read by a name the compiler does not take for the member every object has.
        const id: string = "constructor";
        expect(result.frames[id]).toEqual(valid().frames["hero-0"]);
        expect(result.animations[id].entries[0]).toEqual({ frame: "constructor", ms: 1 });
        expect(Object.getPrototypeOf(result.frames)).toBe(Object.prototype);
        expect(typeof ({} as Json).constructor).toBe("function");
    });

    it("ignores members with other names of members of Object", () => {
        const atlas = valid();
        Object.assign(atlas, { hasOwnProperty: 5, toString: null });
        Object.assign(atlas.frames["hero-0"], { hasOwnProperty: "no", valueOf: 7 });

        expect(validateAtlas(atlas, SIZE)).toEqual(valid());
    });

    it("turns whatever a value throws when read into its own error", () => {
        const thrown = new TypeError("trap");
        const getter = valid();
        Object.defineProperty(getter.frames["hero-0"], "w", {
            enumerable: true,
            get() {
                throw thrown;
            },
        });
        const proxy = new Proxy(valid(), {
            ownKeys() {
                throw thrown;
            },
            getOwnPropertyDescriptor() {
                throw thrown;
            },
        });
        const revoked = Proxy.revocable(valid(), {});
        revoked.revoke();

        for (const value of [getter, proxy, revoked.proxy]) {
            const error = errorOf(AtlasError, () => validateAtlas(value, SIZE));
            expect([error.code, error.path, error.message]).toEqual([
                "format",
                "",
                "The atlas cannot be read.",
            ]);
            expect(error.cause).toBeInstanceOf(TypeError);
        }
    });

    it("accepts no image name that leads a reader out of the folder of the atlas", () => {
        // What a reader does with the name, on Windows and elsewhere: it joins it to the
        // folder the atlas lies in.
        const windowsFolder = "D:\\export\\bundle";
        const folder = "/export/bundle";
        // The control: names the reader must not be given.
        expect(win32.resolve(windowsFolder, "C:hero.png").startsWith(windowsFolder)).toBe(false);
        expect(win32.resolve(windowsFolder, "..")).toBe("D:\\export");
        expect(win32.resolve(windowsFolder, "..\\x.png")).toBe("D:\\export\\x.png");
        expect(posix.resolve(folder, "../x.png")).toBe("/export/x.png");

        const names = fc.oneof(
            fc.string({ unit: "binary", maxLength: 12 }),
            fc.string({
                unit: fc.constantFrom(
                    ".",
                    "/",
                    "\\",
                    ":",
                    "C",
                    "c",
                    "o",
                    "n",
                    "u",
                    "l",
                    " ",
                    "1",
                    CONTROL.nul,
                ),
                maxLength: 8,
            }),
        );
        let accepted = 0;
        fc.assert(
            fc.property(names, (image) => {
                const atlas = valid();
                atlas.image = image;
                try {
                    validateAtlas(atlas, SIZE);
                } catch (error) {
                    expect(error).toBeInstanceOf(AtlasError);
                    expect((error as AtlasError).path).toBe("image");
                    return;
                }
                accepted++;
                // Accepted: the file it names lies in the folder, under that very name.
                expect(win32.dirname(win32.resolve(windowsFolder, image))).toBe(windowsFolder);
                expect(win32.basename(win32.resolve(windowsFolder, image))).toBe(image);
                expect(posix.dirname(posix.resolve(folder, image))).toBe(folder);
                expect(posix.basename(posix.resolve(folder, image))).toBe(image);
                expect(image).not.toMatch(/^(?:con|prn|aux|nul|com\d|lpt\d) *(?:\.|$)/i);
            }),
            { numRuns: 3000 },
        );
        expect(accepted).toBeGreaterThan(300);
    });

    it("does not follow a value into itself", () => {
        expectRefused(
            (damaged) => ((damaged.frames as Json).self = damaged.frames),
            "field",
            'frames["self"]',
        );

        const entries: Json[] = [];
        entries.push(entries as unknown as Json);
        expectRefused(
            (damaged) => (damaged.animations.walk.entries = entries),
            "field",
            'animations["walk"].entries[0]',
        );
    });

    it("does not change what it is given", () => {
        const atlas = valid() as Atlas & Json;
        atlas.extra = { kept: true };
        const before = JSON.stringify(atlas);
        validateAtlas(atlas, SIZE);
        expect(JSON.stringify(atlas)).toBe(before);

        const frozen = valid();
        Object.freeze(frozen.frames["hero-0"]);
        Object.freeze(frozen.animations.walk.entries);
        Object.freeze(frozen);
        expect(validateAtlas(frozen, SIZE)).toEqual(valid());
    });

    it("throws nothing but AtlasError, whatever JSON it is given", () => {
        const check = (value: unknown, size: unknown) => {
            try {
                const result = validateAtlas(value, size as typeof SIZE);
                // What it accepts, it accepts again, unchanged.
                expect(validateAtlas(result, size as typeof SIZE)).toEqual(result);
            } catch (error) {
                expect(error).toBeInstanceOf(AtlasError);
                expect(typeof (error as AtlasError).path).toBe("string");
            }
        };
        fc.assert(fc.property(fc.jsonValue(), fc.jsonValue(), check), { numRuns: 500 });
        // A valid atlas with any value put in place of one of its members, at any depth.
        const paths: (string | number)[][] = [];
        const walk = (value: unknown, path: (string | number)[]) => {
            if (typeof value !== "object" || value === null) return;
            for (const [key, item] of Object.entries(value)) {
                const next = [...path, Array.isArray(value) ? Number(key) : key];
                paths.push(next);
                walk(item, next);
            }
        };
        walk(valid(), []);
        expect(paths.length).toBeGreaterThan(40);
        fc.assert(
            fc.property(fc.constantFrom(...paths), fc.anything(), (path, replacement) => {
                const atlas = valid() as unknown as Json;
                let owner = atlas;
                for (const key of path.slice(0, -1)) owner = owner[key] as Json;
                owner[path[path.length - 1]] = replacement;
                check(atlas, SIZE);
            }),
            { numRuns: 2000 },
        );
    });
});
