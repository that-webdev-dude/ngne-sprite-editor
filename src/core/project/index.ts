// The `.ngsprite` project file of SPEC §10, specified in docs/FORMAT.md. `serialize` and
// `deserialize` convert between a document with its reference images and the bytes of a
// file. `docToJson` and `docFromJson` are the `doc.json` part alone, for a store that keeps
// pixels elsewhere (autosave); `projectThumbnail` is the picture a file carries. Every
// problem is reported as a `ProjectError`. The `MAX_…` and `MIN_…` constants are every limit
// of docs/FORMAT.md §1.8. A document has to stay inside them to be saved; the commands that
// make a document grow have them here to refuse in time.

export { deserialize } from "./deserialize";
export type { ProjectContents } from "./deserialize";
export { docFromJson } from "./docFromJson";
export { docToJson } from "./docToJson";
export { ProjectError } from "./errors";
export type { ProjectErrorCode, ProjectErrorOptions } from "./errors";
export {
    IMAGE_ENTRY_OVERHEAD_BYTES,
    MAX_DOC_JSON_BYTES,
    MAX_ID_LENGTH,
    MAX_MANIFEST_BYTES,
    MAX_NAME_LENGTH,
    MAX_PROJECT_CELS,
    MAX_PROJECT_CONTENT_BYTES,
    MAX_PROJECT_ENTRIES,
    MAX_PROJECT_FRAMES,
    MAX_PROJECT_IMAGES,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_PALETTE_COLORS,
    MAX_PROJECT_PIXEL_BYTES,
    MAX_PROJECT_REFERENCE_LAYERS,
    MAX_PROJECT_TAGS,
    MAX_REFERENCE_OFFSET,
    MAX_REFERENCE_SCALE,
    MAX_REFERENCE_SOURCE_BYTES,
    MIN_REFERENCE_SCALE,
    PROJECT_FILE_EXTENSION,
    PROJECT_FORMAT,
    PROJECT_GENERATOR,
    PROJECT_VERSION,
    THUMBNAIL_MAX_SIDE,
    isProjectId,
    maxImageEntryBytes,
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
