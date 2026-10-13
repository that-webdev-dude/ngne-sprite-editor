/**
 * Largest `Tag.repeat`; 0 repeats without end (SPEC §5.1). The bound keeps an expanded tag
 * small: `expandTag` and the exported atlas (SPEC §9.3) write every pass out.
 */
export const MAX_TAG_REPEAT = 255;

/** Whether the value is a repeat count a tag can have: an integer in 0..255. */
export function isTagRepeat(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= MAX_TAG_REPEAT;
}

/**
 * Thrown when a tag is given a range that is not a run of the document's frames: an endpoint
 * that is not a frame of the document, or a `from` frame after the `to` frame.
 */
export class TagRangeError extends Error {
    override readonly name = "TagRangeError";
    readonly fromFrameId: string;
    readonly toFrameId: string;
    /** What is wrong with the range. */
    readonly reason: "unknown-frame" | "from-after-to";

    constructor(fromFrameId: string, toFrameId: string, reason: TagRangeError["reason"]) {
        super(
            `A tag cannot run from frame "${fromFrameId}" to frame "${toFrameId}": ` +
                (reason === "unknown-frame"
                    ? "both must be frames of the document."
                    : "the first comes after the second."),
        );
        this.fromFrameId = fromFrameId;
        this.toFrameId = toFrameId;
        this.reason = reason;
    }
}

/** Thrown when a tag's repeat count is not an integer in 0..255. */
export class TagRepeatError extends Error {
    override readonly name = "TagRepeatError";
    readonly repeat: number;

    constructor(repeat: number) {
        super(
            `Tag repeat ${repeat} is not allowed: it must be an integer from 0 to ` +
                `${MAX_TAG_REPEAT}.`,
        );
        this.repeat = repeat;
    }
}
