// The `.ngsprite` project file of SPEC §10, specified in docs/FORMAT.md. `serialize` and
// `deserialize` convert between a document with its reference images and the bytes of a
// file. `docToJson` and `docFromJson` are the `doc.json` part alone, for a store that keeps
// pixels elsewhere (autosave); `projectThumbnail` is the picture a file carries. Every
// problem is reported as a `ProjectError`. The constants are the limits of the format that
// code outside this module has to respect for a document to be saved.

export { deserialize } from "./deserialize";
export type { ProjectContents } from "./deserialize";
export { docFromJson } from "./docFromJson";
export { docToJson } from "./docToJson";
export { ProjectError } from "./errors";
export type { ProjectErrorCode, ProjectErrorOptions } from "./errors";
export {
    MAX_ID_LENGTH,
    MAX_PROJECT_FRAMES,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_PIXEL_BYTES,
    MAX_PROJECT_TAGS,
    MAX_REFERENCE_SOURCE_BYTES,
    PROJECT_FILE_EXTENSION,
    PROJECT_FORMAT,
    PROJECT_GENERATOR,
    PROJECT_VERSION,
    THUMBNAIL_MAX_SIDE,
    isProjectId,
} from "./format";
export type {
    BlendModeJson,
    CelJson,
    DocJson,
    DocSettingsJson,
    ExportSettingsJson,
    FrameJson,
    LayerJson,
    PaletteJson,
    PixelLayerJson,
    ProjectManifest,
    ReferenceLayerJson,
    TagJson,
} from "./schema";
export { serialize } from "./serialize";
export { projectThumbnail } from "./thumbnail";
