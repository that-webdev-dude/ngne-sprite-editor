// The runtime of an exported sprite sheet (SPEC §9.2, §9.5): where a frame of an
// `ngne-sprite-atlas` is drawn, and which frame an animation shows at a given age.
//
// This file is the only source of that code. The editor imports it as code (the preview
// panel, tests). The generator of `<name>.sprites.ts` (`spritesModule.ts`) reads it as text
// and copies the lines between the two marker lines below, byte for byte, into every module
// it writes. So, between the markers:
// - there is no `import` and no `export`: the generated module has its own, and this file
//   exports the same names below the end marker;
// - nothing is used but ECMAScript 2022 and the types declared there: no engine type and no
//   DOM global. The sink is structural, so `src/core` stays free of the engine (SPEC §5);
// - the code compiles under `strict`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`,
//   `noUnusedLocals` and `noUnusedParameters`, and the generated module uses every
//   declaration;
// - no top-level name has the form of a generated one (`<name>Image`, `draw<Name>` and the
//   others of `exportIdentifiers`, names.ts): it would clash in the module of a document
//   with the matching name;
// - the text is ASCII, comments included, as every text file of a bundle is.
// The comments between the markers are read by the users of an exported module.

// sprite-runtime:begin
/** One sprite as it is handed to the engine: the fields of NGNE's `Sprite` a sheet sets. */
interface SheetSprite {
    /** Centre of the quad. */
    x: number;
    y: number;
    /** Size of the quad before rotation. A negative size mirrors it. */
    width: number;
    height: number;
    /** ID of the atlas image. */
    texture: string;
    /** The rectangle of the frame in the atlas, as fractions of the atlas size. */
    u: number;
    v: number;
    uw: number;
    vh: number;
    /** Radians. */
    rotation: number;
    color?: number;
    alpha?: number;
    layer?: number;
    depth?: number;
    screen?: boolean;
}

/**
 * What frames are drawn into: NGNE's `Frame`, or anything else with its `sprite` method.
 * A property, not a method: the compiler then checks a `Frame` against it strictly, so that
 * a `SheetSprite` has to be a sprite that `Frame.sprite` accepts.
 */
interface SpriteSink {
    sprite: (sprite: SheetSprite) => void;
}

/** One frame of an atlas (`ngne-sprite-atlas` version 1). Integers, in pixels. */
interface AtlasFrame {
    /** The rectangle of the frame in the atlas image. `w` and `h` are even. */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    /** Size of the frame as it was drawn, before trimming. */
    readonly sourceW: number;
    readonly sourceH: number;
    /** Where the top-left corner of the rectangle lies in that frame. */
    readonly offsetX: number;
    readonly offsetY: number;
    /** The point drawn on the anchor: 0, 0 is the top-left corner of the source frame. */
    readonly pivot: readonly [number, number];
}

/** One step of an animation: a frame and how long it shows, in milliseconds. */
interface AtlasEntry<FrameId extends string = string> {
    readonly frame: FrameId;
    readonly ms: number;
}

interface AtlasAnimation<FrameId extends string = string> {
    /** "loop" starts over after the last entry; "once" stays on it. */
    readonly playback: "loop" | "once";
    /** Sum of the `ms` of the entries. */
    readonly durationMs: number;
    readonly entries: readonly AtlasEntry<FrameId>[];
}

/** What the functions below read of an atlas: its size, frames and animations. */
interface SpriteAtlas<FrameId extends string = string, AnimationId extends string = string> {
    /** Size of the atlas image in pixels. */
    readonly width: number;
    readonly height: number;
    readonly frames: Readonly<Record<FrameId, AtlasFrame>>;
    readonly animations: Readonly<Record<AnimationId, AtlasAnimation<FrameId>>>;
}

/** How a frame is drawn. An option left out keeps the default of the engine. */
interface DrawOptions {
    /** Radians, clockwise on screen, about the anchor. Default 0. */
    readonly rotation?: number;
    /** Uniform scale about the anchor. Default 1. */
    readonly scale?: number;
    /** Mirror about the vertical axis through the anchor. */
    readonly flipX?: boolean;
    /** Mirror about the horizontal axis through the anchor. */
    readonly flipY?: boolean;
    readonly layer?: number;
    readonly depth?: number;
    readonly alpha?: number;
    /** Tint, 0xRRGGBB: multiplied with the pixels. */
    readonly color?: number;
    /** Draw in screen space: the camera does not move the sprite. */
    readonly screen?: boolean;
}

/** The pivot of top-left placement: the top-left corner of the source frame. */
const TOP_LEFT: readonly [number, number] = [0, 0];

function frameOf<FrameId extends string>(atlas: SpriteAtlas<FrameId>, id: FrameId): AtlasFrame {
    if (!Object.hasOwn(atlas.frames, id)) throw new RangeError(`The atlas has no frame "${id}".`);
    return atlas.frames[id];
}

/**
 * Hands the engine the quad of `frame` with the point `pivot` of its source frame on the
 * anchor (`x`, `y`).
 *
 *     d      = (offsetX + w/2 - pivot[0]*sourceW, offsetY + h/2 - pivot[1]*sourceH)
 *     centre = anchor + R(rotation) * (flipX*scale*d.x, flipY*scale*d.y)
 *     size   = (flipX*scale*w, flipY*scale*h)
 *     uv     = (x/width, y/height, w/width, h/height)
 *
 * `d` leads from the pivot to the centre of the rectangle. Without rotation and with a
 * whole-number scale, `scale*d` is rounded to whole pixels before it is mirrored: `w` and
 * `h` are even, so a frame at a whole-number anchor then has its edges on pixel boundaries,
 * whether or not the camera snaps sprite centres. A rotated frame is not rounded.
 */
function place(
    sink: SpriteSink,
    atlas: { readonly width: number; readonly height: number },
    texture: string,
    frame: AtlasFrame,
    pivot: readonly [number, number],
    x: number,
    y: number,
    options: DrawOptions,
): void {
    const rotation = options.rotation ?? 0;
    const scale = options.scale ?? 1;
    const flipX = options.flipX ? -1 : 1;
    const flipY = options.flipY ? -1 : 1;
    let dx = scale * (frame.offsetX + frame.w / 2 - pivot[0] * frame.sourceW);
    let dy = scale * (frame.offsetY + frame.h / 2 - pivot[1] * frame.sourceH);
    if (rotation === 0 && Number.isInteger(scale)) {
        dx = Math.round(dx);
        dy = Math.round(dy);
    }
    dx *= flipX;
    dy *= flipY;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const sprite: SheetSprite = {
        x: x + dx * cos - dy * sin,
        y: y + dx * sin + dy * cos,
        width: flipX * scale * frame.w,
        height: flipY * scale * frame.h,
        texture,
        u: frame.x / atlas.width,
        v: frame.y / atlas.height,
        uw: frame.w / atlas.width,
        vh: frame.h / atlas.height,
        rotation,
    };
    if (options.color !== undefined) sprite.color = options.color;
    if (options.alpha !== undefined) sprite.alpha = options.alpha;
    if (options.layer !== undefined) sprite.layer = options.layer;
    if (options.depth !== undefined) sprite.depth = options.depth;
    if (options.screen !== undefined) sprite.screen = options.screen;
    sink.sprite(sprite);
}

/**
 * Draws the frame `id` from the image `texture` with its pivot on (`x`, `y`). The options
 * rotate, scale and mirror it about that point. Throws `RangeError` for an unknown frame.
 */
function spriteAt<FrameId extends string>(
    sink: SpriteSink,
    atlas: SpriteAtlas<FrameId>,
    texture: string,
    id: FrameId,
    x: number,
    y: number,
    options: DrawOptions = {},
): void {
    const frame = frameOf(atlas, id);
    place(sink, atlas, texture, frame, frame.pivot, x, y, options);
}

/**
 * Draws the frame `id` with the top-left corner of its source frame on (`x`, `y`), whatever
 * its pivot and however it was trimmed. The options work about that corner.
 */
function spriteAtTopLeft<FrameId extends string>(
    sink: SpriteSink,
    atlas: SpriteAtlas<FrameId>,
    texture: string,
    id: FrameId,
    x: number,
    y: number,
    options: DrawOptions = {},
): void {
    place(sink, atlas, texture, frameOf(atlas, id), TOP_LEFT, x, y, options);
}

function animationOf<FrameId extends string, AnimationId extends string>(
    atlas: SpriteAtlas<FrameId, AnimationId>,
    id: AnimationId,
): AtlasAnimation<FrameId> {
    if (!Object.hasOwn(atlas.animations, id)) {
        throw new RangeError(`The atlas has no animation "${id}".`);
    }
    return atlas.animations[id];
}

/**
 * The frame an animation shows `ageMs` milliseconds after its start. An entry shows from
 * its start up to, not including, its end. A "loop" animation starts over at `durationMs`;
 * a "once" animation stays on its last entry. An age below 0 counts as 0. Throws
 * `RangeError` for an unknown animation.
 */
function animationFrame<FrameId extends string, AnimationId extends string>(
    atlas: SpriteAtlas<FrameId, AnimationId>,
    animation: AnimationId,
    ageMs: number,
): FrameId {
    const { playback, durationMs, entries } = animationOf(atlas, animation);
    let age = ageMs > 0 ? ageMs : 0;
    if (playback === "loop") age %= durationMs;
    let end = 0;
    let frame: FrameId | undefined;
    for (const entry of entries) {
        end += entry.ms;
        frame = entry.frame;
        if (age < end) break;
    }
    if (frame === undefined) throw new RangeError(`Animation "${animation}" has no entry.`);
    return frame;
}

/**
 * True when a "once" animation has reached its end: at `durationMs` and after. Never true
 * for a "loop" animation.
 */
function animationDone<FrameId extends string, AnimationId extends string>(
    atlas: SpriteAtlas<FrameId, AnimationId>,
    animation: AnimationId,
    ageMs: number,
): boolean {
    const { playback, durationMs } = animationOf(atlas, animation);
    return playback === "once" && ageMs >= durationMs;
}
// sprite-runtime:end

export { animationDone, animationFrame, spriteAt, spriteAtTopLeft };
export type {
    AtlasAnimation,
    AtlasEntry,
    AtlasFrame,
    DrawOptions,
    SheetSprite,
    SpriteAtlas,
    SpriteSink,
};
