/** Shortest and longest duration of a frame, in milliseconds (SPEC §5.1). */
export const MIN_FRAME_DURATION_MS = 1;
export const MAX_FRAME_DURATION_MS = 65535;

/** Whether the value is a duration a frame can have: an integer in 1..65535. */
export function isFrameDuration(value: number): boolean {
    return (
        Number.isInteger(value) && value >= MIN_FRAME_DURATION_MS && value <= MAX_FRAME_DURATION_MS
    );
}

/** Thrown when a frame duration is not an integer in 1..65535 (SPEC §5.1). */
export class FrameDurationError extends Error {
    override readonly name = "FrameDurationError";
    readonly durationMs: number;

    constructor(durationMs: number) {
        super(
            `Frame duration ${durationMs} ms is not allowed: it must be an integer from ` +
                `${MIN_FRAME_DURATION_MS} to ${MAX_FRAME_DURATION_MS}.`,
        );
        this.durationMs = durationMs;
    }
}

/** Thrown when a command would delete every frame: a document keeps at least one (SPEC §5.1). */
export class LastFrameError extends Error {
    override readonly name = "LastFrameError";

    constructor() {
        super("The last frame of a document cannot be deleted.");
    }
}
