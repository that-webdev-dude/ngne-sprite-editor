// The image exports beside the NGNE bundle (SPEC §9.6): a frame PNG scaled by a whole number,
// the sprite sheet PNG alone, the PNG sequence, and the zip of several files.

export {
    MAX_FRAME_PNG_SCALE,
    MAX_FRAME_PNG_SIDE,
    MIN_FRAME_PNG_SCALE,
    framePngFile,
    framePngName,
    maxFramePngScale,
    pngSequenceFiles,
    spriteSheetFile,
    upscaleNearest,
    zipFiles,
} from "./imageExports";
