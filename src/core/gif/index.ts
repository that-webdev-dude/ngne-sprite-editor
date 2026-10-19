// The animated GIF export of SPEC §9.6 (SE-063): every frame or one tag, per-frame palettes,
// one-bit transparency, delays in steps of 10 ms and the tag's loop count.

export {
    GIF_ALPHA_THRESHOLD,
    MAX_GIF_COLORS,
    MAX_GIF_SCALE,
    MIN_GIF_DELAY_MS,
    MIN_GIF_SCALE,
    gifDelayMs,
    gifFile,
    gifFileName,
    gifFrameImage,
    gifLoopCount,
    gifSequence,
} from "./gifExport";
export type { GifFrameImage, GifFrames, GifOptions, GifResult, GifSequence } from "./gifExport";
