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
export const PROJECT_GENERATOR = "ngne-sprite-editor 0.0.0";

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

/** Largest `manifest.json`, uncompressed. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/** Largest `doc.json`, uncompressed. */
export const MAX_DOC_JSON_BYTES = 16 * 1024 * 1024;

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
export const MAX_PROJECT_PIXEL_BYTES = 1024 * 1024 * 1024;

/** Most bytes the entries of a project hold together, uncompressed. */
export const MAX_PROJECT_CONTENT_BYTES = 2 * 1024 * 1024 * 1024;

/** Most entries of an archive: what a zip directory counts without the zip64 extension. */
export const MAX_PROJECT_ENTRIES = 65_535;

/** Most layers, frames and tags of a document in a project file. */
export const MAX_PROJECT_LAYERS = 1024;
export const MAX_PROJECT_FRAMES = 65_535;
export const MAX_PROJECT_TAGS = 1024;

/** Longest ID, in characters. */
export const MAX_ID_LENGTH = 64;

/** An ID in a project file: 1 to `MAX_ID_LENGTH` of the characters A–Z, a–z, 0–9, `_`, `-`. */
export function isProjectId(value: unknown): value is string {
    return (
        typeof value === "string" && value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)
    );
}

/** Longest side of `thumb.png`, in pixels. */
export const THUMBNAIL_MAX_SIDE = 128;
