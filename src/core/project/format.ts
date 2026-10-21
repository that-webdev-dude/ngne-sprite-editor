import {
    DOCUMENT_LIMITS,
    MAX_DOCUMENT_PIXEL_BYTES,
    MAX_NAME_LENGTH as MODEL_NAME_LENGTH,
} from "../model";

// Names, version and limits of the `.ngsprite` project file, schema version 1, as specified in
// docs/FORMAT.md. A value changed here is a change of the format: it needs a new schema
// version and a migration (SPEC §10).

/** Extension of a project file, with its dot. */
export const PROJECT_FILE_EXTENSION = ".ngsprite";

/** `format` of `manifest.json`. */
export const PROJECT_FORMAT = "ngne-sprite-project";

/** The schema version written, and the newest one read. */
export const PROJECT_VERSION = 1;

/**
 * `generator` of `manifest.json`: name and version of this application, as in package.json
 * (a test compares them).
 */
export const PROJECT_GENERATOR = "ngne-sprite-editor 1.0.0";

export const MANIFEST_ENTRY = "manifest.json";
export const DOC_ENTRY = "doc.json";
export const THUMBNAIL_ENTRY = "thumb.png";

/** Name of the entry that holds the pixels of an image. */
export function imageEntry(imageId: string): string {
    return `images/${imageId}.png`;
}

/** Name of the entry that holds the original bytes of a reference image. */
export function referenceEntry(sourceId: string): string {
    return `refs/${sourceId}.png`;
}

// --- limits -------------------------------------------------------------------------------------
// `serialize` refuses what exceeds them, so a file it writes can be read; `deserialize` checks
// them before it inflates or allocates anything.
//
// The limits hold together: a document that is at every limit of a count and of a length at
// once is written inside every limit of a size. A test builds that document and saves it
// (se-040-limits.test.ts); the sums for what it does not reach are in the comments below.

/**
 * Most layers, frames, tags and cels of a document: the limits of the document model
 * (`DOCUMENT_LIMITS` of `core/model`), which the commands that add them enforce.
 */
export const MAX_PROJECT_LAYERS = DOCUMENT_LIMITS.layers;
export const MAX_PROJECT_FRAMES = DOCUMENT_LIMITS.frames;
export const MAX_PROJECT_TAGS = DOCUMENT_LIMITS.tags;
/** 128 full layers of 1024 frames. */
export const MAX_PROJECT_CELS = DOCUMENT_LIMITS.cels;

/** Most colours of the palette (SPEC §5.1). */
export const MAX_PROJECT_PALETTE_COLORS = 256;

/** Most reference layers, and so most reference sources (SPEC §5.1). */
export const MAX_PROJECT_REFERENCE_LAYERS = 4;

/**
 * Most entries of an archive. A zip directory without the zip64 extension counts to 65 535,
 * and that very number announces a zip64 record.
 */
export const MAX_PROJECT_ENTRIES = 65_534;

/**
 * Most images of a document: the entries left beside `manifest.json`, `doc.json`, `thumb.png`
 * and `MAX_PROJECT_REFERENCE_LAYERS` reference sources. Linked cels share an image, so a
 * document can have `MAX_PROJECT_CELS` cels all the same.
 */
export const MAX_PROJECT_IMAGES = DOCUMENT_LIMITS.images;

/** Longest ID, in characters. */
export const MAX_ID_LENGTH = 64;

/**
 * Longest text a file holds as one string: the name of a document, layer, tag or palette, and
 * the generator. Counted as JavaScript counts it, in UTF-16 code units.
 */
export const MAX_NAME_LENGTH = MODEL_NAME_LENGTH;

/** Farthest a reference layer's `x` or `y` lies from the canvas origin, in document pixels. */
export const MAX_REFERENCE_OFFSET = 1_000_000;

/** Smallest and largest `scale` of a reference layer: document pixels per source pixel. */
export const MIN_REFERENCE_SCALE = 0.000_001;
export const MAX_REFERENCE_SCALE = 1_000_000;

/** Largest `manifest.json`, uncompressed. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/**
 * Largest `doc.json`, uncompressed. The editor writes at most 52.5 MiB: a document at every
 * count limit with IDs and names of full length, each character of a name escaped.
 */
export const MAX_DOC_JSON_BYTES = 64 * 1024 * 1024;

/** What an image entry may hold beyond its scanlines: PNG framing and ancillary chunks. */
export const IMAGE_ENTRY_OVERHEAD_BYTES = 64 * 1024;

/**
 * Largest `images/<imageId>.png` of a document of this size, uncompressed: the scanlines of an
 * 8-bit RGBA image, not deflated, plus `IMAGE_ENTRY_OVERHEAD_BYTES`.
 */
export function maxImageEntryBytes(width: number, height: number): number {
    return height * (4 * width + 1) + IMAGE_ENTRY_OVERHEAD_BYTES;
}

/** Largest `refs/<sourceId>.png`, uncompressed. */
export const MAX_REFERENCE_SOURCE_BYTES = 64 * 1024 * 1024;

/** Most pixel data a project holds (images × width × height × 4): the 1 GB of SPEC §5.1. */
export const MAX_PROJECT_PIXEL_BYTES = MAX_DOCUMENT_PIXEL_BYTES;

/**
 * Most bytes the entries of a project hold together, uncompressed. The other limits stay
 * below it: 1 GiB of pixels is at most 1.25 GiB of scanlines (a canvas one pixel wide has a
 * filter byte for every four of pixel data) and 65 527 PNG files add a few megabytes of
 * framing; four reference sources are 256 MiB, `doc.json` 64 MiB. About 1.6 GiB in all.
 */
export const MAX_PROJECT_CONTENT_BYTES = 2 * 1024 * 1024 * 1024;

/** An ID in a project file: 1 to `MAX_ID_LENGTH` of the characters A–Z, a–z, 0–9, `_`, `-`. */
export function isProjectId(value: unknown): value is string {
    return (
        typeof value === "string" && value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)
    );
}

/** Longest side of `thumb.png`, in pixels. */
export const THUMBNAIL_MAX_SIDE = 128;
