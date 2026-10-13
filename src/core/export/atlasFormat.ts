import type { SpriteAtlas } from "./sprite-runtime";

// Name, version and limits of the `ngne-sprite-atlas` format, version 1, as specified in
// docs/FORMAT.md §2. A value changed here is a change of the format: from the 1.0.0 release
// on it needs a new version (SPEC §10).

/** `format` of `<name>.atlas.json`. */
export const ATLAS_FORMAT = "ngne-sprite-atlas";

/** The version written, and the newest one read. */
export const ATLAS_VERSION = 1;

/**
 * `generator` of `<name>.atlas.json`, also named in the head of the generated modules: name
 * and version of this application, as in package.json (a test compares them).
 */
export const ATLAS_GENERATOR = "ngne-sprite-editor 0.0.0";

/** Most frames of an atlas. Frames that share a rectangle count one each. */
export const MAX_ATLAS_FRAMES = 65_536;

/**
 * Most entries the animations of an atlas hold together. NGNE's animation data is a plain
 * list of entries that either loops or plays once, so a tag that repeats is written out pass
 * by pass (SPEC §9.3); the bound keeps the three files that carry the list small enough to
 * load, and the generated module small enough to compile.
 */
export const MAX_ATLAS_ENTRIES = 65_536;

/** Longest ID of a frame or an animation, in characters. */
export const MAX_ATLAS_ID_LENGTH = 80;

/** Longest duration of one entry, in milliseconds: the longest duration of a frame. */
export const MAX_ENTRY_MS = 65_535;

/**
 * The content of `<name>.atlas.json`: what the sprite runtime reads of it (`SpriteAtlas`:
 * size, frames, animations) and the members that identify the file. Its members are in the
 * order in which they are written.
 */
export interface AtlasMeta extends SpriteAtlas {
    readonly format: typeof ATLAS_FORMAT;
    readonly version: typeof ATLAS_VERSION;
    /** Name and version of the program that wrote the file. Informative only. */
    readonly generator: string;
    /** File name of the atlas image, which lies beside the JSON file. */
    readonly image: string;
}
