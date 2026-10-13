import type { PixelBuffer } from "../../src/core/model";
import {
    blitPixels,
    createPixelBuffer,
    cropPixels,
    flipPixels,
    resizeNearest,
    rotatePixels,
} from "../../src/core/pixels";

// SE-053: what an NGNE game must show of an exported sprite (SPEC §9.7, condition 3), and
// the comparison of a canvas with it. Plain TypeScript without DOM or Node APIs: the specs
// use it on what a GPU drew, a unit test on what NGNE's `Frame` holds.
//
// Where a frame must appear is worked out from the composite of the frame, the pivot of the
// document and the draw alone. That part reads no atlas: not a rectangle, not an offset. So
// the result is the same for every way of packing the frame, and an error in the packer,
// the writers or the generated module cannot move the expectation with it.
//
// The atlas itself is held against the composites further down: the image a bundle must
// hold for the rectangles its atlas states, the gutters of an extruded rectangle, and what
// an animation shows at an age.

// --- the scene ------------------------------------------------------------------------------------

/** Logical size of the consumer game's canvas, in pixels. */
export const CANVAS = { width: 128, height: 128 } as const;

/** Clear colour of the game, 0xRRGGBB: three different channels, none at an end. */
export const CLEAR = 0x2a3b4c;

/** The whole-number anchor in the middle of the canvas. */
export const ANCHOR: readonly [number, number] = [64, 64];

/**
 * Anchors near the corner of the canvas. A sum with a small anchor keeps the last bits of
 * what is added to it, so this is where a turn that is not exact moves a frame by a pixel
 * (ticket SE-053, from the SE-051 review). Part of a frame drawn here lies outside the
 * canvas; what is inside is compared.
 */
export const SMALL_ANCHORS: readonly (readonly [number, number])[] = [
    [4, 4],
    [20, 20],
    [0, 0],
    [1, 3],
    [37, 2],
    [3, 64],
];

/** One frame drawn by the consumer game with a function of the generated module. */
export interface DrawCommand {
    /** ID of the frame in the atlas. */
    frame: string;
    x: number;
    y: number;
    /** `draw<Name>TopLeft` in place of `draw<Name>`. */
    topLeft?: boolean;
    /** Quarter turns clockwise: the game passes `rotation: quarters × π / 2`. */
    quarters?: 0 | 1 | 2 | 3;
    scale?: number;
    flipX?: boolean;
    flipY?: boolean;
}

/**
 * The draws the consumer spec makes of one frame, by what they show (SPEC §9.7, condition
 * 3). A unit test makes the same draws on NGNE's `Frame` without a GPU.
 * - `anchored`: at a whole-number anchor in the middle of the canvas and near its corner, and
 *   by the corner of the source frame.
 * - `turned`: by 90°, 180° and 270°, at the same anchors.
 * - `mirrored`: `flipX`, `flipY`, both, and `flipX` with a quarter turn.
 * - `scaled`: `scale: 2`, also mirrored, turned and by the corner.
 */
export function frameDraws(
    frame: string,
): Record<"anchored" | "turned" | "mirrored" | "scaled", DrawCommand[]> {
    const anchors = [ANCHOR, ...SMALL_ANCHORS];
    const [x, y] = ANCHOR;
    return {
        anchored: [
            ...anchors.map(([ax, ay]): DrawCommand => ({ frame, x: ax, y: ay })),
            { frame, x: 7, y: 5, topLeft: true },
        ],
        turned: ([1, 2, 3] as const).flatMap((quarters) =>
            anchors.map(([ax, ay]): DrawCommand => ({ frame, x: ax, y: ay, quarters })),
        ),
        mirrored: [
            { frame, x, y, flipX: true },
            { frame, x: 20, y: 20, flipX: true },
            { frame, x, y, flipY: true },
            { frame, x, y, flipX: true, flipY: true },
            { frame, x, y, flipX: true, quarters: 1 },
        ],
        scaled: [
            { frame, x, y, scale: 2 },
            { frame, x, y, scale: 2, flipX: true },
            { frame, x, y, scale: 2, quarters: 1 },
            { frame, x: 9, y: 11, scale: 2, topLeft: true },
        ],
    };
}

// --- where a frame must appear ----------------------------------------------------------------------

/** An image and where its top-left corner lies on the canvas; it may reach outside it. */
export interface Placed {
    image: PixelBuffer;
    left: number;
    top: number;
}

/**
 * Where the composite of a frame must appear for one draw, under NGNE's default camera
 * (`pixelSnap` on). `pivot` is the document's, normalized; P = pivot · size is the point of
 * the frame that lies on the anchor A = (x, y).
 *
 * Without a turn (SPEC §9.2): with a whole-number scale s the frame is moved to whole
 * pixels, so its top-left corner is at A + round(−s·P), halves upwards; a mirrored frame is
 * the mirror image of that about the line through A. Top-left placement has P = (0, 0).
 *
 * After q quarter turns: the frame is drawn from a rectangle of even size, the composite
 * with a transparent column or row where a side is odd; the middle C of that rectangle
 * lies at A + R(C − P), where one quarter turn R takes (x, y) to (−y, x); and NGNE's `Frame`
 * rounds the centre of a quad to whole pixels with `Math.round`. The runtime does not round
 * a turned frame itself. A frame of odd size with its pivot in the middle has C − P on half
 * pixels, and it is this rounding that puts it on whole ones.
 */
export function expectedSprite(
    composite: PixelBuffer,
    pivot: { x: number; y: number },
    draw: DrawCommand,
): Placed {
    const scale = draw.scale ?? 1;
    const quarters = draw.quarters ?? 0;
    const pivotX = draw.topLeft ? 0 : pivot.x * composite.width;
    const pivotY = draw.topLeft ? 0 : pivot.y * composite.height;

    if (quarters === 0) {
        let image = resizeNearest(composite, composite.width * scale, composite.height * scale);
        let left = draw.x + Math.round(-scale * pivotX);
        let top = draw.y + Math.round(-scale * pivotY);
        if (draw.flipX) {
            image = flipPixels(image, "horizontal");
            left = 2 * draw.x - (left + image.width);
        }
        if (draw.flipY) {
            image = flipPixels(image, "vertical");
            top = 2 * draw.y - (top + image.height);
        }
        return { image, left, top };
    }

    const evenW = composite.width + (composite.width % 2);
    const evenH = composite.height + (composite.height % 2);
    const rectangle = cropPixels(composite, { x: 0, y: 0, width: evenW, height: evenH });
    let image = resizeNearest(rectangle, evenW * scale, evenH * scale);
    // From the pivot to the middle of the rectangle; a mirror turns it about the pivot.
    let x = scale * (evenW / 2 - pivotX);
    let y = scale * (evenH / 2 - pivotY);
    if (draw.flipX) {
        image = flipPixels(image, "horizontal");
        x = -x;
    }
    if (draw.flipY) {
        image = flipPixels(image, "vertical");
        y = -y;
    }
    const [turnedX, turnedY] = [
        [x, y],
        [-y, x],
        [-x, -y],
        [y, -x],
    ][quarters];
    const centreX = Math.round(draw.x + turnedX);
    const centreY = Math.round(draw.y + turnedY);
    image = rotatePixels(image, (quarters * 90) as 90 | 180 | 270);
    return { image, left: centreX - image.width / 2, top: centreY - image.height / 2 };
}

/**
 * A transparent `width` × `height` canvas with the images on it, each cut to the canvas.
 * Throws when two images share a pixel: the expectation of a scene is the images side by
 * side, and an overlap would need the blending this function does not do.
 */
export function canvasOf(
    sprites: readonly Placed[],
    width: number = CANVAS.width,
    height: number = CANVAS.height,
): PixelBuffer {
    const canvas = createPixelBuffer(width, height);
    sprites.forEach((sprite, index) => {
        for (const other of sprites.slice(0, index)) {
            const apart =
                sprite.left >= other.left + other.image.width ||
                other.left >= sprite.left + sprite.image.width ||
                sprite.top >= other.top + other.image.height ||
                other.top >= sprite.top + sprite.image.height;
            if (!apart) throw new Error("canvasOf: two images of the scene overlap.");
        }
        blitPixels(canvas, sprite.image, sprite.left, sprite.top);
    });
    return canvas;
}

/** The canvas for one draw of one frame. */
export function expectedCanvas(
    composite: PixelBuffer,
    pivot: { x: number; y: number },
    draw: DrawCommand,
): PixelBuffer {
    return canvasOf([expectedSprite(composite, pivot, draw)]);
}

/**
 * Anchors for `count` frames of `width` × `height` drawn in one scene with `pivot`: a grid of
 * cells with a gap of 3 pixels between the frames, filled row by row from the top-left of
 * the canvas. Throws when the frames do not fit the canvas.
 */
export function sceneAnchors(
    count: number,
    width: number,
    height: number,
    pivot: { x: number; y: number },
): [number, number][] {
    const gap = 3;
    const columns = Math.floor((CANVAS.width - gap) / (width + gap));
    const rows = Math.floor((CANVAS.height - gap) / (height + gap));
    if (columns < 1 || count > columns * rows) {
        throw new Error(`sceneAnchors: ${count} frames of ${width}×${height} do not fit.`);
    }
    return Array.from({ length: count }, (_, index) => {
        const left = gap + (index % columns) * (width + gap);
        const top = gap + Math.floor(index / columns) * (height + gap);
        // The corner is at anchor + round(−P): the anchor that puts it at (left, top).
        return [left - Math.round(-pivot.x * width), top - Math.round(-pivot.y * height)];
    });
}

// --- the comparison -------------------------------------------------------------------------------

/** A canvas as it was read back: RGBA8, row by row. */
export interface CanvasImage {
    width: number;
    height: number;
    data: ArrayLike<number>;
}

/**
 * Compares a canvas with what it must show (ticket SE-053, tolerance): `expected` in
 * straight alpha, drawn over the opaque clear colour `clear` (0xRRGGBB).
 * - Where `expected` is opaque, the canvas has exactly its colour.
 * - Where it is transparent, the canvas has exactly the clear colour: NGNE adds nothing for a
 *   texel of alpha 0. This is stricter than the ticket, which allows ±1 for every pixel
 *   that is not opaque.
 * - Elsewhere each channel is within 1 of `colour·α + clear·(1 − α)` rounded to 8 bits. A
 *   GPU need not round a blend to the nearest value: SwiftShader does; an Intel UHD and an
 *   RTX 4060 were seen one value away from it.
 * - Every pixel of the canvas is opaque: the clear colour is.
 *
 * Returns one line per pixel at fault, the first `limit` of them, and a last line with their
 * number when there are more; nothing when the canvas is right.
 */
export function compareCanvas(
    actual: CanvasImage,
    expected: PixelBuffer,
    clear: number = CLEAR,
    limit = 8,
): string[] {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        return [
            `the canvas is ${actual.width}×${actual.height}, ` +
                `expected ${expected.width}×${expected.height}`,
        ];
    }
    if (actual.data.length !== expected.data.length) {
        return [`the canvas has ${actual.data.length} bytes, expected ${expected.data.length}`];
    }
    const background = [(clear >>> 16) & 255, (clear >>> 8) & 255, clear & 255];
    const faults: string[] = [];
    let count = 0;
    for (let at = 0; at < expected.data.length; at += 4) {
        const alpha = expected.data[at + 3];
        const wanted = [0, 1, 2].map((channel) =>
            alpha === 255
                ? expected.data[at + channel]
                : alpha === 0
                  ? background[channel]
                  : Math.round(
                        (expected.data[at + channel] * alpha +
                            background[channel] * (255 - alpha)) /
                            255,
                    ),
        );
        const found = [actual.data[at], actual.data[at + 1], actual.data[at + 2]];
        const tolerance = alpha === 255 || alpha === 0 ? 0 : 1;
        const right =
            actual.data[at + 3] === 255 &&
            found.every((value, channel) => Math.abs(value - wanted[channel]) <= tolerance);
        if (right) continue;
        count++;
        if (faults.length < limit) {
            const index = at / 4;
            const x = index % expected.width;
            const kind = alpha === 255 ? "opaque" : alpha === 0 ? "clear" : `alpha ${alpha}`;
            faults.push(
                `pixel (${x}, ${(index - x) / expected.width}) is ${found.join()} with alpha ` +
                    `${actual.data[at + 3]}, expected ${wanted.join()} (${kind}, ±${tolerance})`,
            );
        }
    }
    if (count > faults.length) faults.push(`${count} pixels differ in all`);
    return faults;
}

/** How many pixels of an image are opaque, partly transparent and transparent. */
export function alphaCounts(image: PixelBuffer): {
    opaque: number;
    partial: number;
    transparent: number;
} {
    const counts = { opaque: 0, partial: 0, transparent: 0 };
    for (let at = 3; at < image.data.length; at += 4) {
        const alpha = image.data[at];
        if (alpha === 255) counts.opaque++;
        else if (alpha === 0) counts.transparent++;
        else counts.partial++;
    }
    return counts;
}

// --- the atlas image ------------------------------------------------------------------------------

/** What the functions below read of a frame of an atlas. */
interface FrameRect {
    x: number;
    y: number;
    w: number;
    h: number;
    offsetX: number;
    offsetY: number;
}

/**
 * The atlas image a bundle must hold, pixel for pixel, worked out from the composites and
 * the rectangles its atlas states (SPEC §9.2, §9.4):
 * - a rectangle holds the part of the frame's composite it covers, from (offsetX, offsetY);
 *   where it reaches past the frame, to make its size even, it is transparent;
 * - with `extrude`, the pixels of its edge are repeated that many pixels outwards, the
 *   corner pixel into the corner. A side that is the transparent column or row of an even
 *   size has nothing to repeat: its gutter is transparent, the side is not extruded;
 * - every other pixel, the padding between the gutters and at the border, is transparent.
 * Frames merged into one rectangle are written once; they have the same composite.
 */
export function expectedAtlas(
    meta: { width: number; height: number; frames: Readonly<Record<string, FrameRect>> },
    composites: ReadonlyMap<string, PixelBuffer>,
    extrude: number,
): PixelBuffer {
    const atlas = createPixelBuffer(meta.width, meta.height);
    const written = new Set<string>();
    for (const [id, { x, y, w, h, offsetX, offsetY }] of Object.entries(meta.frames)) {
        const composite = composites.get(id);
        if (!composite) throw new Error(`expectedAtlas: no composite of frame ${id}.`);
        if (written.has(`${x},${y}`)) continue;
        written.add(`${x},${y}`);
        const piece = cropPixels(composite, { x: offsetX, y: offsetY, width: w, height: h });
        const ring = createPixelBuffer(w + 2 * extrude, h + 2 * extrude);
        for (let row = 0; row < ring.height; row++) {
            for (let column = 0; column < ring.width; column++) {
                // The nearest pixel of the rectangle: itself inside, its edge in the gutter.
                const fromX = Math.min(Math.max(column - extrude, 0), w - 1);
                const fromY = Math.min(Math.max(row - extrude, 0), h - 1);
                const from = (fromY * w + fromX) * 4;
                ring.data.set(piece.data.subarray(from, from + 4), (row * ring.width + column) * 4);
            }
        }
        blitPixels(atlas, ring, x - extrude, y - extrude);
    }
    return atlas;
}

/** Describes the first pixel in which two images differ, or null when they are byte-equal. */
export function imageDifference(actual: PixelBuffer, expected: PixelBuffer): string | null {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        return `${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`;
    }
    for (let at = 0; at < expected.data.length; at += 4) {
        const found = actual.data.subarray(at, at + 4).join();
        const wanted = expected.data.subarray(at, at + 4).join();
        if (found !== wanted) {
            const index = at / 4;
            const x = index % expected.width;
            return `pixel (${x}, ${(index - x) / expected.width}) is ${found}, expected ${wanted}`;
        }
    }
    return null;
}

/** The pixels beside one side of a rectangle, and the pixels of the rectangle they lie against. */
export interface Gutter {
    /** The pixels one step outside the rectangle, each as `r,g,b,a`. */
    outside: string[];
    /** The pixel of the rectangle's edge next to each of them. */
    edge: string[];
    /** How many of the edge pixels show (alpha above 0). */
    lit: number;
}

/**
 * The gutter of a rectangle of an atlas image extruded by one pixel: its four sides, and
 * its four corners (top-left, top-right, bottom-left, bottom-right) against the corner
 * pixels of the rectangle. Read from the image alone; extrusion is right when `outside`
 * equals `edge` on every side.
 */
export function guttersOf(
    image: PixelBuffer,
    rect: { x: number; y: number; w: number; h: number },
): Record<"left" | "right" | "top" | "bottom" | "corners", Gutter> {
    const { x, y, w, h } = rect;
    const pixel = (px: number, py: number): string => {
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) {
            throw new Error(`guttersOf: (${px}, ${py}) lies outside the image.`);
        }
        return image.data
            .subarray((py * image.width + px) * 4, (py * image.width + px) * 4 + 4)
            .join();
    };
    const side = (pairs: [number, number, number, number][]): Gutter => {
        const edge = pairs.map(([, , ex, ey]) => pixel(ex, ey));
        return {
            outside: pairs.map(([ox, oy]) => pixel(ox, oy)),
            edge,
            lit: edge.filter((value) => !value.endsWith(",0")).length,
        };
    };
    const rows = Array.from({ length: h }, (_, index) => y + index);
    const columns = Array.from({ length: w }, (_, index) => x + index);
    return {
        left: side(rows.map((py) => [x - 1, py, x, py])),
        right: side(rows.map((py) => [x + w, py, x + w - 1, py])),
        top: side(columns.map((px) => [px, y - 1, px, y])),
        bottom: side(columns.map((px) => [px, y + h, px, y + h - 1])),
        corners: side([
            [x - 1, y - 1, x, y],
            [x + w, y - 1, x + w - 1, y],
            [x - 1, y + h, x, y + h - 1],
            [x + w, y + h, x + w - 1, y + h - 1],
        ]),
    };
}

// --- animations -----------------------------------------------------------------------------------

/** What the functions below read of an animation of an atlas. */
interface AnimationData {
    playback: "loop" | "once";
    durationMs: number;
    entries: readonly { frame: string; ms: number }[];
}

/**
 * What an animation shows at an age, from its entries alone (SPEC §9.5): an entry shows
 * from its start up to, not including, its end; a `"loop"` starts over at `durationMs`; a
 * `"once"` stays on its last entry and is done from `durationMs` on; an age below 0 counts
 * as 0. The specs hold the functions of a generated module against this.
 */
export function expectedAnimationState(
    animation: AnimationData,
    ageMs: number,
): { frame: string; done: boolean } {
    const { playback, durationMs, entries } = animation;
    const age = Math.max(ageMs, 0);
    const done = playback === "once" && age >= durationMs;
    const time = playback === "loop" ? age % durationMs : age;
    let start = 0;
    for (const entry of entries) {
        if (time >= start && time < start + entry.ms) return { frame: entry.frame, done };
        start += entry.ms;
    }
    // Past the last entry: only a "once" animation gets here, and it stays on that entry.
    return { frame: entries[entries.length - 1].frame, done };
}

/**
 * Ages at which an animation is asked for its frame, around every place where the answer
 * changes: for the start of each entry and for `durationMs`, one millisecond and a
 * thousandth of one before, the boundary itself, and a thousandth and one millisecond
 * after; the same one, two and seven lengths later; and ages below 0. An error of less
 * than a tick of a game at a boundary shows here.
 */
export function boundaryAges(animation: AnimationData): number[] {
    const { durationMs, entries } = animation;
    const boundaries = [0];
    for (const entry of entries) boundaries.push(boundaries[boundaries.length - 1] + entry.ms);
    const ages = new Set<number>([-1000, -1, -0.001]);
    for (const laps of [0, 1, 2, 7]) {
        for (const boundary of boundaries) {
            for (const offset of [-1, -0.001, 0, 0.001, 1]) {
                ages.add(laps * durationMs + boundary + offset);
            }
        }
    }
    return [...ages].sort((a, b) => a - b);
}

// --- the consumer page ----------------------------------------------------------------------------

/** A canvas read back in the page, as the page hands it to a spec. */
export interface CanvasReadback {
    width: number;
    height: number;
    /** RGBA8, row by row, in base64. */
    data: string;
}

/** A frame of the game while it plays an animation. */
export interface AnimationReadback extends CanvasReadback {
    /** Age of the animation in milliseconds, as the game's system counted it. */
    ageMs: number;
    /** What `<name>AnimationFrame` returned for that age: the frame the game drew. */
    frame: string;
    /** What `<name>AnimationDone` returned for that age. */
    done: boolean;
}

/**
 * What tests/e2e/harness/se-053-consumer.ts puts on `window.__se053`. Under the manual
 * scheduler the game renders only when one of these is called, and the canvas is read back
 * in `afterFrame` of that render.
 */
export interface ConsumerHarness {
    /** Draws the commands in one frame of the game and returns the canvas. */
    draw(commands: DrawCommand[]): CanvasReadback;
    /** Starts an animation at age 0, drawn at (`x`, `y`), and returns the frame at age 0. */
    play(animation: string, x: number, y: number): AnimationReadback;
    /** Lets `ms` milliseconds pass on the game's clock and returns the frame after them. */
    advance(ms: number): AnimationReadback;
    /**
     * `<name>AnimationFrame` and `<name>AnimationDone` of the generated module, called with
     * each age: what they return, without the game.
     */
    resolve(animation: string, ages: number[]): { frame: string; done: boolean }[];
    /**
     * `<name>Atlas` of the generated module: the atlas the module carries, and draws from.
     */
    atlas: unknown;
    /**
     * Under `requestAnimationFrame`: puts the commands on the stage for the frames to come
     * and returns the number of frames rendered so far.
     */
    show(commands: DrawCommand[]): number;
    /** Frames rendered so far, and the last one as it was read back. */
    frames(): number;
    last(): CanvasReadback | null;
    /** What NGNE reported through `diagnostic`, as text, without its dropped-tick notices. */
    diagnostics(): string[];
    /** Milliseconds of game time per tick under the manual scheduler, and ticks run so far. */
    tickMs: number;
    ticks(): number;
    /** The WebGPU adapter the page got: vendor and architecture. */
    adapter: string;
    /** `camera.pixelSnap` of the scene as the game found it: NGNE's default. */
    pixelSnap: boolean | null;
    /** Lifecycle of the game: "Running" while it is well. */
    lifecycle(): string;
}

declare global {
    interface Window {
        __se053?: ConsumerHarness;
    }
}
