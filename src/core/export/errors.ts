// The errors of the bundle writers and of the atlas reader. `pack` has its own, `PackError`.

/**
 * Why a document cannot be exported:
 * - `settings`: the export settings cannot be applied: `frames` names a tag the document
 *   does not have, or `files.asepriteJson` is not one of its three values.
 * - `frames`: `atlasFor` was not given one composite per exported frame.
 * - `too-many-frames`: more frames are exported than `MAX_ATLAS_FRAMES`.
 * - `too-many-entries`: the animations, written out, hold more entries than
 *   `MAX_ATLAS_ENTRIES`. Reported before any entry is written out.
 * - `document`: the document breaks a rule the atlas depends on (a tag whose range is not a
 *   run of frames, a duration or a pivot outside its range). `cause` is the `AtlasError` of
 *   the check that failed, when a check of the finished atlas found it.
 *
 * With the two `too-many` codes, `count` is what the document needs and `limit` what the
 * format allows.
 */
export type ExportErrorCode =
    "settings" | "frames" | "too-many-frames" | "too-many-entries" | "document";

/** The error of `bundle`, `atlasFor` and `exportFrameIndices`, beside `PackError`. */
export class ExportError extends Error {
    override readonly name = "ExportError";
    readonly code: ExportErrorCode;
    /** With a `too-many` code: how many the document needs. Otherwise undefined. */
    readonly count: number | undefined;
    /** With a `too-many` code: how many the format allows. Otherwise undefined. */
    readonly limit: number | undefined;

    constructor(
        code: ExportErrorCode,
        message: string,
        detail: { count?: number; limit?: number; cause?: unknown } = {},
    ) {
        super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
        this.code = code;
        this.count = detail.count;
        this.limit = detail.limit;
    }
}

/**
 * What is wrong with an atlas:
 * - `format`: the value is not an object, its `format` is not `"ngne-sprite-atlas"`, or it
 *   cannot be read at all: it is not an atlas.
 * - `newer-version`: `version` is above `ATLAS_VERSION`.
 * - `field`: a member is missing, has the wrong type or lies outside its range: among them
 *   a rectangle coordinate that is not an integer, an odd `w` or `h`, an `ms` that is not a
 *   positive integer.
 * - `id`: the ID of a frame or an animation does not have the form of an ID, or two IDs
 *   differ only by case.
 * - `image-size`: `width` and `height` are not the size of the image.
 * - `bounds`: a rectangle reaches outside the image, or more than one pixel past its source
 *   frame.
 * - `frame-reference`: an animation entry names a frame the atlas does not have.
 * - `duration`: `durationMs` of an animation is not the sum of its entries.
 * - `limit`: there are more frames, or more animation entries, than the format allows.
 */
export type AtlasErrorCode =
    | "format"
    | "newer-version"
    | "field"
    | "id"
    | "image-size"
    | "bounds"
    | "frame-reference"
    | "duration"
    | "limit";

/** The one error type thrown by `validateAtlas`. */
export class AtlasError extends Error {
    override readonly name = "AtlasError";
    readonly code: AtlasErrorCode;
    /** The member at fault, as a path from the top (`frames["hero-0"].w`); "" for the whole. */
    readonly path: string;

    constructor(code: AtlasErrorCode, path: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.code = code;
        this.path = path;
    }
}
