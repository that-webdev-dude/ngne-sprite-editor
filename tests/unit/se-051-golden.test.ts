import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { bundle, validateAtlas } from "../../src/core/export";
import { decodePng, encodePng } from "../../src/core/png";
import {
    GOLDEN_GENERATOR,
    HERO_FRAMES,
    bytesOf,
    heroWalk,
    show,
    textOf,
    withGoldenGenerator,
} from "./se-051-support";

// The five files of a bundle, committed, and what they must hold. The fixture is
// `heroWalk()` of se-051-support.ts: 5 × 3 pixels, six frames, three tags, exported with
// trim, merging, padding 1 and the grid layout.
//
// Every expected value below was worked out by hand from SPEC §9.2 to §9.5 and from the
// frames as they are drawn in se-051-support.ts; the arithmetic stands next to it. The
// committed files are checked against these values, and the output of `bundle` against the
// committed files, byte for byte (the PNG pixel for pixel: its compression is not part of
// any format).
//
// The files are written by this test from the fixture:
//
//     SE051_WRITE_GOLDEN=1 npx vitest run tests/unit/se-051-golden.test.ts
//
// They are not to be written again to make a failing test pass. A failure here after a
// change to `core/export` means that an export differs from the ones made before: for
// `hero-walk.atlas.json` that is a change of the `ngne-sprite-atlas` format (SPEC §10).
// The text files carry `.golden` after their name, so that the formatter, the linter and
// the compiler of this repository leave them as `bundle` wrote them.

const DIRECTORY = new URL("./se-051-fixtures/", import.meta.url);

/** The committed file of the bundle with this ending. */
function golden(ending: string): Buffer {
    const name = ending === "png" ? "hero-walk.png" : `hero-walk.${ending}.golden`;
    return readFileSync(new URL(name, DIRECTORY));
}

if (process.env.SE051_WRITE_GOLDEN === "1") {
    mkdirSync(DIRECTORY, { recursive: true });
    for (const { name, bytes } of bundle(heroWalk()).files) {
        writeFileSync(new URL(name.endsWith(".png") ? name : `${name}.golden`, DIRECTORY), bytes);
    }
}

// --- the atlas ----------------------------------------------------------------------------------
//
// Rectangles (SPEC §9.2, §9.4), with trim: the bounds of the pixels with alpha above 0, each
// side made even by one column or row on the right or bottom.
//
//     frame   bounds (x, y, w × h)   rect w × h   offset   note
//     0, 5    0, 0, 2 × 2            2 × 2        0, 0     identical frames: one rectangle
//     1       2, 1, 3 × 2            4 × 2        2, 1     2 + 4 = 6: one column past the frame
//     2       1, 0, 1 × 3            2 × 4        1, 0     0 + 4 = 4: one row past the frame
//     3       none                   2 × 2        0, 0     a transparent frame keeps 2 × 2
//     4       0, 0, 5 × 3            6 × 4        0, 0     one column and one row past it
//
// Five rectangles on a grid of ⌈√5⌉ = 3 columns and ⌈5 / 3⌉ = 2 rows. The cell is the
// largest rectangle on each axis, 6 × 4. With padding 1 and extrude 0 the pitch is
// 6 + 1 = 7 across and 4 + 1 = 5 down:
//
//     atlas  = 3 × 7 + 1 = 22 wide, 2 × 5 + 1 = 11 high
//     starts = 1, 8, 15 across and 1, 6 down
//
// so the rectangles, in the order of their first frame, start at
// (1, 1), (8, 1), (15, 1), (1, 6) and (8, 6).

/** The atlas image, pixel for pixel. The hidden layer of frame 0 ("Z") is not in it. */
const GOLDEN_PIXELS = [
    "......................",
    // Frame 0 at x 1; frame 1 at x 8 (its fourth column is padding); frame 2 at x 15 (its
    // second column is a transparent column of the frame).
    ".AB.....EFG....K......",
    ".CD.....HIJ....L......",
    "...............M......",
    // The fourth row of frame 2's rectangle: padding.
    "......................",
    "......................",
    // Frame 3 at x 1: nothing. Frame 4 at x 8; its sixth column and fourth row are padding.
    "........NOPQR.........",
    "........STUVW.........",
    "........XYZAB.........",
    "......................",
    "......................",
];

/** A frame of the atlas: its rectangle and offset; the size of the canvas and the pivot. */
function frame(x: number, y: number, w: number, h: number, offsetX: number, offsetY: number) {
    return { x, y, w, h, sourceW: 5, sourceH: 3, offsetX, offsetY, pivot: [0.5, 1] };
}

/** `hero-walk.atlas.json`, member for member and in the order of docs/FORMAT.md §2. */
const GOLDEN_ATLAS = {
    format: "ngne-sprite-atlas",
    version: 1,
    generator: GOLDEN_GENERATOR,
    image: "hero-walk.png",
    width: 22,
    height: 11,
    frames: {
        "hero-walk-0": frame(1, 1, 2, 2, 0, 0),
        "hero-walk-1": frame(8, 1, 4, 2, 2, 1),
        "hero-walk-2": frame(15, 1, 2, 4, 1, 0),
        "hero-walk-3": frame(1, 6, 2, 2, 0, 0),
        "hero-walk-4": frame(8, 6, 6, 4, 0, 0),
        // Merged with frame 0: the same rectangle under its own ID.
        "hero-walk-5": frame(1, 1, 2, 2, 0, 0),
    },
    // Durations of the frames 0 to 5: 100, 80, 120, 1, 65535, 100 ms.
    animations: {
        // "Walk": frames 1 to 2 forward, repeat 0. 80 + 120 = 200.
        walk: {
            playback: "loop",
            durationMs: 200,
            entries: [
                { frame: "hero-walk-1", ms: 80 },
                { frame: "hero-walk-2", ms: 120 },
            ],
        },
        // "Turn Around": frames 2 to 4 ping-pong, repeat 0: 2 3 4 3 (SPEC §7.4).
        // 120 + 1 + 65535 + 1 = 65657.
        "turn-around": {
            playback: "loop",
            durationMs: 65657,
            entries: [
                { frame: "hero-walk-2", ms: 120 },
                { frame: "hero-walk-3", ms: 1 },
                { frame: "hero-walk-4", ms: 65535 },
                { frame: "hero-walk-3", ms: 1 },
            ],
        },
        // "WALK": the slug `walk` is taken, so `walk-2`. Frames 3 to 4 in reverse, twice:
        // 4 3 4 3. (65535 + 1) × 2 = 131072.
        "walk-2": {
            playback: "once",
            durationMs: 131072,
            entries: [
                { frame: "hero-walk-4", ms: 65535 },
                { frame: "hero-walk-3", ms: 1 },
                { frame: "hero-walk-4", ms: 65535 },
                { frame: "hero-walk-3", ms: 1 },
            ],
        },
    },
};

const GOLDEN_ATLAS_TEXT = `${JSON.stringify(GOLDEN_ATLAS, null, 4)}\n`;

// --- the module ---------------------------------------------------------------------------------

/** `hero-walk.sprites.ts` up to the sprite runtime. `Hero Walk` gives `heroWalk`, `HeroWalk`. */
const GOLDEN_MODULE_HEAD = `// Generated by ${GOLDEN_GENERATOR}. Do not edit: export the sprite again instead.
//
// The sprite sheet hero-walk.png for NGNE (@ngne/core): its image asset, the content of
// hero-walk.atlas.json, and the functions that draw its frames and resolve its animations.

import { imageAsset } from "@ngne/core";
import type { Frame, ImageAsset } from "@ngne/core";

/**
 * The atlas image, hero-walk.png beside this module. List it in the \`assets\` of every scene
 * that draws these frames: its ID is the texture they are drawn from.
 */
export const heroWalkImage: ImageAsset = imageAsset(
    "hero-walk",
    new URL("./hero-walk.png", import.meta.url).href,
);

/** The content of hero-walk.atlas.json (format \`ngne-sprite-atlas\`, version 1). */
export const heroWalkAtlas = ${JSON.stringify(GOLDEN_ATLAS, null, 4)} as const;

/** The ID of a frame of the sheet. */
export type HeroWalkFrameId = keyof typeof heroWalkAtlas.frames;

/** The ID of an animation of the sheet. */
export type HeroWalkAnimationId = keyof typeof heroWalkAtlas.animations;

/**
 * Draws a frame with its pivot on (\`x\`, \`y\`). The options rotate (radians), scale and
 * mirror it about that point, and pass \`layer\`, \`depth\`, \`alpha\`, \`color\` and \`screen\` on
 * to the engine. Without rotation and with a whole-number scale, a frame at whole-number
 * coordinates covers whole pixels.
 */
export function drawHeroWalk(
    frame: Frame,
    id: HeroWalkFrameId,
    x: number,
    y: number,
    options?: DrawOptions,
): void {
    spriteAt<HeroWalkFrameId>(frame, heroWalkAtlas, "hero-walk", id, x, y, options);
}

/**
 * Draws a frame with the top-left corner of its source frame on (\`x\`, \`y\`), whatever its
 * pivot and however it was trimmed. The options work about that corner.
 */
export function drawHeroWalkTopLeft(
    frame: Frame,
    id: HeroWalkFrameId,
    x: number,
    y: number,
    options?: DrawOptions,
): void {
    spriteAtTopLeft<HeroWalkFrameId>(frame, heroWalkAtlas, "hero-walk", id, x, y, options);
}

/**
 * The frame an animation shows \`ageMs\` milliseconds after its start. An entry shows from its
 * start up to, not including, its end. A "loop" animation starts over after its last entry;
 * a "once" animation stays on it.
 */
export function heroWalkAnimationFrame(animation: HeroWalkAnimationId, ageMs: number): HeroWalkFrameId {
    return animationFrame<HeroWalkFrameId, HeroWalkAnimationId>(heroWalkAtlas, animation, ageMs);
}

/** True when a "once" animation has reached its end. Never true for a "loop" animation. */
export function heroWalkAnimationDone(animation: HeroWalkAnimationId, ageMs: number): boolean {
    return animationDone<HeroWalkFrameId, HeroWalkAnimationId>(heroWalkAtlas, animation, ageMs);
}

// What follows is the same in every module that ngne-sprite-editor exports.

`;

/** The lines of sprite-runtime.ts between its marker lines, read here from the file. */
function runtimeLines(): string {
    const source = readFileSync(
        new URL("../../src/core/export/sprite-runtime.ts", import.meta.url),
        "utf8",
    );
    const begin = "// sprite-runtime:begin\n";
    const start = source.indexOf(begin) + begin.length;
    return source.slice(start, source.indexOf("// sprite-runtime:end\n"));
}

// --- the preview adapter ------------------------------------------------------------------------

/**
 * `hero-walk.preview.config.mjs`: the frames and animations of the atlas as the lists of
 * NGNE's adapter. A frame's `width` and `height`, and its destination size, are the even
 * `w` and `h` of its rectangle.
 */
const GOLDEN_PREVIEW = `// Generated by ${GOLDEN_GENERATOR}. Do not edit: export the sprite again instead.
//
// The sprite sheet hero-walk.png for NGNE's preview: npx ngne-preview ./hero-walk.preview.config.mjs

export default {
    images: [{ id: "hero-walk", src: new URL("./hero-walk.png", import.meta.url) }],
    frames: [
        { id: "hero-walk-0", image: "hero-walk", x: 1, y: 1, width: 2, height: 2, destinationWidth: 2, destinationHeight: 2 },
        { id: "hero-walk-1", image: "hero-walk", x: 8, y: 1, width: 4, height: 2, destinationWidth: 4, destinationHeight: 2 },
        { id: "hero-walk-2", image: "hero-walk", x: 15, y: 1, width: 2, height: 4, destinationWidth: 2, destinationHeight: 4 },
        { id: "hero-walk-3", image: "hero-walk", x: 1, y: 6, width: 2, height: 2, destinationWidth: 2, destinationHeight: 2 },
        { id: "hero-walk-4", image: "hero-walk", x: 8, y: 6, width: 6, height: 4, destinationWidth: 6, destinationHeight: 4 },
        { id: "hero-walk-5", image: "hero-walk", x: 1, y: 1, width: 2, height: 2, destinationWidth: 2, destinationHeight: 2 },
    ],
    animations: [
        {
            id: "walk",
            playback: "loop",
            entries: [
                { frame: "hero-walk-1", ms: 80 },
                { frame: "hero-walk-2", ms: 120 },
            ],
        },
        {
            id: "turn-around",
            playback: "loop",
            entries: [
                { frame: "hero-walk-2", ms: 120 },
                { frame: "hero-walk-3", ms: 1 },
                { frame: "hero-walk-4", ms: 65535 },
                { frame: "hero-walk-3", ms: 1 },
            ],
        },
        {
            id: "walk-2",
            playback: "once",
            entries: [
                { frame: "hero-walk-4", ms: 65535 },
                { frame: "hero-walk-3", ms: 1 },
                { frame: "hero-walk-4", ms: 65535 },
                { frame: "hero-walk-3", ms: 1 },
            ],
        },
    ],
    display: { density: 1, scale: 1, pixelSnap: true },
};
`;

// --- the Aseprite data --------------------------------------------------------------------------

/**
 * One frame of `hero-walk.aseprite.json`: its place in the atlas, where its content lies
 * in the source frame, the content size (the same in both), and its duration. The source
 * frame is 5 × 3 throughout.
 */
function sheetFrame(
    filename: string,
    [x, y]: [number, number],
    [offsetX, offsetY]: [number, number],
    [w, h]: [number, number],
    trimmed: boolean,
    duration: number,
) {
    return {
        filename,
        frame: { x, y, w, h },
        rotated: false,
        trimmed,
        spriteSourceSize: { x: offsetX, y: offsetY, w, h },
        sourceSize: { w: 5, h: 3 },
        duration,
    };
}

/**
 * `hero-walk.aseprite.json`, in the array form. The content size of a frame is
 * `min(w, sourceW − offsetX)` by `min(h, sourceH − offsetY)` (SPEC §9.2).
 */
const GOLDEN_ASEPRITE = {
    frames: [
        // min(2, 5 − 0) = 2, min(2, 3 − 0) = 2.
        sheetFrame("hero-walk-0", [1, 1], [0, 0], [2, 2], true, 100),
        // min(4, 5 − 2) = 3: the fourth column lies past the frame. min(2, 3 − 1) = 2.
        sheetFrame("hero-walk-1", [8, 1], [2, 1], [3, 2], true, 80),
        // min(2, 5 − 1) = 2: both columns lie in the frame, so the even width stays.
        // min(4, 3 − 0) = 3: the fourth row lies past it.
        sheetFrame("hero-walk-2", [15, 1], [1, 0], [2, 3], true, 120),
        // The transparent frame: min(2, 5) = 2, min(2, 3) = 2.
        sheetFrame("hero-walk-3", [1, 6], [0, 0], [2, 2], true, 1),
        // min(6, 5) = 5, min(4, 3) = 3: the whole source frame, so it is not trimmed.
        sheetFrame("hero-walk-4", [8, 6], [0, 0], [5, 3], false, 65535),
        sheetFrame("hero-walk-5", [1, 1], [0, 0], [2, 2], true, 100),
    ],
    meta: {
        app: "ngne-sprite-editor",
        version: "0.0.0",
        image: "hero-walk.png",
        format: "RGBA8888",
        size: { w: 22, h: 11 },
        scale: "1",
        frameTags: [
            // A tag that plays without end has no `repeat`. Colours 0x3cb371ff, 0xff000080.
            { name: "walk", from: 1, to: 2, direction: "forward", color: "#3cb371ff" },
            { name: "turn-around", from: 2, to: 4, direction: "pingpong", color: "#ff000080" },
            // `repeat` is a string; the colour 0x12345600 has alpha 0 and is left out.
            { name: "walk-2", from: 3, to: 4, direction: "reverse", repeat: "2" },
        ],
    },
};

describe("the golden files of a bundle", () => {
    it("are committed", () => {
        for (const ending of [
            "png",
            "atlas.json",
            "sprites.ts",
            "preview.config.mjs",
            "aseprite.json",
        ]) {
            const name = ending === "png" ? "hero-walk.png" : `hero-walk.${ending}.golden`;
            expect(existsSync(new URL(name, DIRECTORY)), name).toBe(true);
        }
    });

    it("hero-walk.png holds the atlas worked out by hand", async () => {
        const image = await decodePng(golden("png"));

        expect([image.width, image.height]).toEqual([22, 11]);
        expect(show(image)).toEqual(GOLDEN_PIXELS);
    });

    it("hero-walk.png is an 8-bit RGBA image with no chunk besides IHDR, IDAT and IEND", () => {
        const file = golden("png");
        const chunks: string[] = [];
        for (let at = 8; at < file.length; at += 12 + file.readUInt32BE(at)) {
            chunks.push(file.toString("latin1", at + 4, at + 8));
        }

        expect(chunks).toEqual(["IHDR", "IDAT", "IEND"]);
        // IHDR data starts at byte 16: width, height, bit depth, colour type, …, interlace.
        expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([22, 11]);
        expect([file[24], file[25], file[28]]).toEqual([8, 6, 0]);
    });

    it("hero-walk.atlas.json holds the frames and animations worked out by hand", () => {
        const text = golden("atlas.json").toString("utf8");

        expect(JSON.parse(text)).toEqual(GOLDEN_ATLAS);
        // Member for member in the order written above, four spaces, a line feed at the end.
        expect(text).toBe(GOLDEN_ATLAS_TEXT);
    });

    it("hero-walk.atlas.json is an atlas of the image", async () => {
        const image = await decodePng(golden("png"));
        const json: unknown = JSON.parse(golden("atlas.json").toString("utf8"));

        expect(validateAtlas(json, image)).toEqual(GOLDEN_ATLAS);
    });

    it("hero-walk.sprites.ts is the head written out above and the sprite runtime", () => {
        expect(golden("sprites.ts").toString("utf8")).toBe(GOLDEN_MODULE_HEAD + runtimeLines());
    });

    it("hero-walk.preview.config.mjs is the adapter written out above", () => {
        expect(golden("preview.config.mjs").toString("utf8")).toBe(GOLDEN_PREVIEW);
    });

    it("hero-walk.aseprite.json holds the sheet worked out by hand", () => {
        const text = golden("aseprite.json").toString("utf8");

        expect(JSON.parse(text)).toEqual(GOLDEN_ASEPRITE);
        expect(text).toBe(`${JSON.stringify(GOLDEN_ASEPRITE, null, 4)}\n`);
    });
});

describe("bundle against the golden files", () => {
    const made = bundle(heroWalk());

    it("writes the five files under their names, in the order of SPEC §9.1", () => {
        expect(made.files.map((file) => file.name)).toEqual([
            "hero-walk.png",
            "hero-walk.atlas.json",
            "hero-walk.sprites.ts",
            "hero-walk.preview.config.mjs",
            "hero-walk.aseprite.json",
        ]);
    });

    it.each(["atlas.json", "sprites.ts", "preview.config.mjs", "aseprite.json"])(
        "writes hero-walk.%s byte for byte, apart from the generator",
        (ending) => {
            const written = Buffer.from(withGoldenGenerator(textOf(made, ending)), "utf8");

            expect(written.toString("utf8")).toBe(golden(ending).toString("utf8"));
            expect(Buffer.compare(written, golden(ending))).toBe(0);
        },
    );

    it("writes the pixels of hero-walk.png", async () => {
        const expected = await decodePng(golden("png"));
        const written = await decodePng(bytesOf(made, "png"));

        expect(show(made.atlas)).toEqual(GOLDEN_PIXELS);
        expect([written.width, written.height]).toEqual([expected.width, expected.height]);
        expect(Array.from(written.data)).toEqual(Array.from(expected.data));
        // The file is the atlas as `encodePng` writes it.
        expect(
            Buffer.compare(Buffer.from(bytesOf(made, "png")), Buffer.from(encodePng(made.atlas))),
        ).toBe(0);
    });

    it("returns the content of the atlas JSON as `meta`", () => {
        expect(JSON.parse(withGoldenGenerator(JSON.stringify(made.meta)))).toEqual(GOLDEN_ATLAS);
        expect(Object.keys(made.meta)).toEqual(Object.keys(GOLDEN_ATLAS));
    });

    it("packs the composites of the frames: the visible layers only", () => {
        const doc = heroWalk();
        // Frame 0 has a cel on the hidden layer, full of "Z"; the composite is the drawing.
        expect(show(compositeFrame(doc, "frame-0"))).toEqual(show(HERO_FRAMES[0]!));
        expect(GOLDEN_PIXELS.join("")).not.toContain("ZZ");
    });
});
