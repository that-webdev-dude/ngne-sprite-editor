// NGNE asset export (SPEC §9).
//
// `bundle` writes the files of an export; `atlasFor` packs and describes an atlas without
// writing files, for the preview panel; `validateAtlas` reads an atlas JSON back. The name
// functions give the names of an export before it is made, for the export dialog. The
// sprite runtime (`spriteAt`, `animationFrame`, …) is the code the generated module carries.

export { pack } from "./pack";
export type { PackLimits, PackOptions, PackResult, PackedRect } from "./pack";
export { MAX_ATLAS_EXTRUDE, MAX_ATLAS_PADDING, MAX_ATLAS_SIDE, PackError } from "./packErrors";
export type { PackErrorCode } from "./packErrors";

export { atlasFor, exportFrameIndices } from "./atlasFor";
export type { AtlasResult } from "./atlasFor";
export {
    ATLAS_FORMAT,
    ATLAS_GENERATOR,
    ATLAS_VERSION,
    MAX_ATLAS_ENTRIES,
    MAX_ATLAS_FRAMES,
    MAX_ATLAS_ID_LENGTH,
    MAX_ENTRY_MS,
} from "./atlasFormat";
export type { AtlasMeta } from "./atlasFormat";
export { bundle } from "./bundle";
export type { Bundle, BundleFile } from "./bundle";
export { AtlasError, ExportError } from "./errors";
export type { AtlasErrorCode, ExportErrorCode } from "./errors";
export {
    MAX_SLUG_LENGTH,
    animationIds,
    bundleFileNames,
    exportIdentifiers,
    exportName,
    isAtlasId,
} from "./names";
export type { ExportIdentifiers, TagAnimationId } from "./names";
export { animationDone, animationFrame, spriteAt, spriteAtTopLeft } from "./sprite-runtime";
export type {
    AtlasAnimation,
    AtlasEntry,
    AtlasFrame,
    DrawOptions,
    SheetSprite,
    SpriteAtlas,
    SpriteSink,
} from "./sprite-runtime";
export { validateAtlas } from "./validateAtlas";
