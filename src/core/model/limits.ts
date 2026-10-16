import { pixelMemoryBytes } from "./queries";
import type { SpriteDoc } from "./types";

// The limits of a document (SPEC §5.1, FORMAT.md §1.8): the pixel memory of SPEC §5.1 and the
// counts and text length of the project format. `core/project` takes its count limits from
// here, so a document the commands let grow can always be saved. Every command that adds a
// layer, frame, tag, cel or image refuses to pass a limit with a `DocumentLimitError`, thrown
// while the command is made: nothing reaches the history and the session is unchanged.

/** The limits a command checks. A test lowers them through the command's `limits` option. */
export interface DocumentLimits {
    /** Pixel memory of the cel images, in bytes: images × width × height × 4. */
    pixelBytes: number;
    layers: number;
    frames: number;
    tags: number;
    cels: number;
    /** Distinct images; cels beyond them are linked. */
    images: number;
}

/** What a limit is about: one of the fields of `DocumentLimits`. */
export type DocumentLimitName = keyof DocumentLimits;

/** 1 GiB of pixel memory (SPEC §5.1; FORMAT.md §1.8, "Pixel data"). */
export const MAX_DOCUMENT_PIXEL_BYTES = 1024 * 1024 * 1024;

/** The app warns when a document's pixel memory passes this many bytes: 512 MiB (SPEC §5.1). */
export const PIXEL_MEMORY_WARNING_BYTES = 512 * 1024 * 1024;

/** Longest name of a document, layer, tag or palette, in UTF-16 code units (FORMAT.md §1.2). */
export const MAX_NAME_LENGTH = 255;

/** The limits of the project format (FORMAT.md §1.8). */
export const DOCUMENT_LIMITS: Readonly<DocumentLimits> = Object.freeze({
    pixelBytes: MAX_DOCUMENT_PIXEL_BYTES,
    layers: 1024,
    frames: 65_535,
    tags: 1024,
    /** 128 full layers of 1024 frames. */
    cels: 131_072,
    /** The entries of an archive left beside the manifest, doc.json, thumbnail and 4 sources. */
    images: 65_527,
});

const WHAT: Record<DocumentLimitName, string> = {
    pixelBytes: "bytes of pixel memory",
    layers: "layers",
    frames: "frames",
    tags: "tags",
    cels: "cels",
    images: "images",
};

/**
 * Thrown when a command would take a document past one of its limits, or set a name longer
 * than `MAX_NAME_LENGTH`. The command is not made, so the session is unchanged.
 */
export class DocumentLimitError extends Error {
    override readonly name = "DocumentLimitError";
    /** The limit, or "nameLength" for a name. */
    readonly limit: DocumentLimitName | "nameLength";
    /** What the command would leave. */
    readonly requested: number;
    /** The most the limit allows. */
    readonly max: number;

    constructor(limit: DocumentLimitName | "nameLength", requested: number, max: number) {
        super(
            limit === "nameLength"
                ? `A name of ${requested} characters is too long: at most ${max} are allowed.`
                : `The document would have ${requested} ${WHAT[limit]}; at most ${max} are allowed.`,
        );
        this.limit = limit;
        this.requested = requested;
        this.max = max;
    }
}

/** How much of each limit a document uses. */
export type DocumentCounts = DocumentLimits;

/** The counts of a document as it is now. */
export function documentCounts(doc: SpriteDoc): DocumentCounts {
    return {
        pixelBytes: pixelMemoryBytes(doc),
        layers: doc.layers.length,
        frames: doc.frames.length,
        tags: doc.tags.length,
        cels: doc.cels.size,
        images: doc.images.size,
    };
}

/**
 * Throws `DocumentLimitError` for the first count that grows from `before` to `after` and
 * ends above its limit. A count that does not grow is not checked, so a command that takes
 * nothing away from an over-full document (a lowered limit in a test) is not refused.
 */
export function assertWithinLimits(
    before: DocumentCounts,
    after: Partial<DocumentCounts>,
    limits: Readonly<DocumentLimits> = DOCUMENT_LIMITS,
): void {
    for (const name of Object.keys(WHAT) as DocumentLimitName[]) {
        const value = after[name];
        if (value === undefined || value <= before[name]) continue;
        if (value > limits[name]) throw new DocumentLimitError(name, value, limits[name]);
    }
}

/**
 * Checks that the document can take what a command adds: `added` holds the growth of each
 * count. Throws `DocumentLimitError`.
 */
export function assertCanAdd(
    doc: SpriteDoc,
    added: Partial<DocumentCounts>,
    limits: Readonly<DocumentLimits> = DOCUMENT_LIMITS,
): void {
    const before = documentCounts(doc);
    const after: Partial<DocumentCounts> = {};
    for (const [name, value] of Object.entries(added) as [DocumentLimitName, number][]) {
        after[name] = before[name] + value;
    }
    assertWithinLimits(before, after, limits);
}

/** Throws `DocumentLimitError` for a name longer than `MAX_NAME_LENGTH` UTF-16 code units. */
export function assertNameLength(name: string): void {
    if (name.length > MAX_NAME_LENGTH) {
        throw new DocumentLimitError("nameLength", name.length, MAX_NAME_LENGTH);
    }
}

/**
 * The name cut to `MAX_NAME_LENGTH` code units, without leaving half of a surrogate pair at
 * its end. A name that fits is returned as it is.
 */
export function truncateName(name: string): string {
    if (name.length <= MAX_NAME_LENGTH) return name;
    const cut = name.slice(0, MAX_NAME_LENGTH);
    const last = cut.charCodeAt(cut.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
