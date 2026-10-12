// The JSON entries of a project file, schema version 1, as types. docs/FORMAT.md specifies
// every field; these types say the same to the compiler. They are written out instead of
// derived from the document model, so a change of the model cannot change the format
// unnoticed: `docToJson` and `docFromJson` then stop compiling.

/** `manifest.json`. */
export interface ProjectManifest {
    format: "ngne-sprite-project";
    version: number;
    /** Name and version of the program that wrote the file. Informative. */
    generator: string;
}

/** `doc.json`: the document of SPEC §5.1 without its pixels. */
export interface DocJson {
    id: string;
    name: string;
    width: number;
    height: number;
    colorMode: "rgba";
    /** Bottom to top. */
    layers: LayerJson[];
    /** In playback order. */
    frames: FrameJson[];
    /** By layer, bottom to top, then by frame. An absent cel is an empty one. */
    cels: CelJson[];
    /** In creation order. */
    tags: TagJson[];
    palette: PaletteJson;
    pivot: { x: number; y: number };
    settings: DocSettingsJson;
    exportSettings: ExportSettingsJson;
}

export type LayerJson = PixelLayerJson | ReferenceLayerJson;

export interface PixelLayerJson {
    id: string;
    kind: "pixel";
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    blend: BlendModeJson;
}

export interface ReferenceLayerJson {
    id: string;
    kind: "reference";
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    /** Names the entry `refs/<sourceId>.png`. */
    sourceId: string;
    x: number;
    y: number;
    scale: number;
    placement: "behind" | "front";
}

export type BlendModeJson =
    | "normal"
    | "multiply"
    | "screen"
    | "overlay"
    | "darken"
    | "lighten"
    | "color-dodge"
    | "color-burn"
    | "hard-light"
    | "soft-light"
    | "difference"
    | "exclusion"
    | "hue"
    | "saturation"
    | "color"
    | "luminosity"
    | "addition"
    | "subtract"
    | "divide";

export interface FrameJson {
    id: string;
    durationMs: number;
}

export interface CelJson {
    layerId: string;
    frameId: string;
    /** Names the entry `images/<imageId>.png`. Linked cels have the same `imageId`. */
    imageId: string;
    opacity: number;
}

export interface TagJson {
    id: string;
    name: string;
    /** `#rrggbbaa`. */
    color: string;
    fromFrameId: string;
    toFrameId: string;
    direction: "forward" | "reverse" | "pingpong";
    repeat: number;
}

export interface PaletteJson {
    name: string;
    /** `#rrggbbaa` each. */
    colors: string[];
}

export interface DocSettingsJson {
    grid: { width: number; height: number; offsetX: number; offsetY: number; visible: boolean };
    pixelGrid: boolean;
    onion: {
        enabled: boolean;
        before: number;
        after: number;
        opacity: number;
        falloff: number;
        tint: boolean;
        placement: "behind" | "front";
        withinTag: boolean;
    };
    symmetry: { mode: "none" | "x" | "y" | "both"; axisX: number; axisY: number };
    tiled: "none" | "x" | "y" | "both";
}

export interface ExportSettingsJson {
    layout: "grid" | "row" | "column";
    padding: number;
    extrude: number;
    trim: boolean;
    mergeDuplicates: boolean;
    frames: "all" | { tagId: string };
    files: { spritesTs: boolean; previewConfig: boolean; asepriteJson: "none" | "array" | "hash" };
    exportOnSave: boolean;
}
