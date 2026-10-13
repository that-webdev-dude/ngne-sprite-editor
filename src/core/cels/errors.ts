/** Lowest and highest opacity of a cel (SPEC §5.1). */
export const MIN_CEL_OPACITY = 0;
export const MAX_CEL_OPACITY = 255;

/** Whether the value is an opacity a cel can have: an integer in 0..255. */
export function isCelOpacity(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_CEL_OPACITY && value <= MAX_CEL_OPACITY;
}

/** Thrown when a cel opacity is not an integer in 0..255 (SPEC §5.1). */
export class CelOpacityError extends Error {
    override readonly name = "CelOpacityError";
    readonly opacity: number;

    constructor(opacity: number) {
        super(
            `Cel opacity ${opacity} is not allowed: it must be an integer from ` +
                `${MIN_CEL_OPACITY} to ${MAX_CEL_OPACITY}.`,
        );
        this.opacity = opacity;
    }
}

/**
 * Thrown when cels are moved or copied to a place that is no cell of the grid: past the first
 * or last frame, or below the bottom or above the top pixel layer.
 */
export class CelTargetError extends Error {
    override readonly name = "CelTargetError";
    /** Pixel layers up the stack, as in `CelOffset`. */
    readonly layers: number;
    /** Frames later, as in `CelOffset`. */
    readonly frames: number;
    /** Where the shifted cels would land. */
    readonly reason: "outside-frames" | "outside-layers";

    constructor(layers: number, frames: number, reason: CelTargetError["reason"]) {
        const where = {
            "outside-frames": "they would leave the frames of the document",
            "outside-layers": "they would leave the pixel layers of the document",
        }[reason];
        super(`Cels cannot be shifted by ${layers} layers and ${frames} frames: ${where}.`);
        this.layers = layers;
        this.frames = frames;
        this.reason = reason;
    }
}
