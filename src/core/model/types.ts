// Document model of SPEC §5.1 and the session types of SPEC §5.2. Types only.

export interface SpriteDoc {
    id: string;
    /** Also the export base name. */
    name: string;
    /** Integer 1..1024. */
    width: number;
    /** Integer 1..1024. */
    height: number;
    colorMode: "rgba";
    /** Bottom to top. */
    layers: Layer[];
    /** In playback order. */
    frames: FrameInfo[];
    /** Keyed by `celKey(layerId, frameId)`; an absent key is an empty cel. */
    cels: Map<string, Cel>;
    images: Map<string, PixelBuffer>;
    /** In creation order: a new tag is appended (`activeTagAt` breaks ties with it). */
    tags: Tag[];
    palette: Palette;
    /** Normalized 0..1; the default is the centre. */
    pivot: { x: number; y: number };
    settings: DocSettings;
    exportSettings: ExportSettings;
}

/** Colours are 0xRRGGBBAA; at most 256. */
export interface Palette {
    name: string;
    colors: number[];
}

export type Layer = PixelLayer | ReferenceLayer;

export interface LayerBase {
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    /** 0..255. */
    opacity: number;
}

export interface PixelLayer extends LayerBase {
    kind: "pixel";
    blend: BlendMode;
}

export interface ReferenceLayer extends LayerBase {
    kind: "reference";
    /** Original image bytes, stored in the project. */
    sourceId: string;
    /** Top-left in document pixels; fractional values are allowed. */
    x: number;
    y: number;
    /** Document pixels per source pixel, above 0. */
    scale: number;
    placement: "behind" | "front";
}

export type BlendMode =
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

export interface FrameInfo {
    id: string;
    /** Integer 1..65535; the default is 100. */
    durationMs: number;
}

export interface Cel {
    /** Linked cels share one image ID. */
    imageId: string;
    /** 0..255; the default is 255. */
    opacity: number;
}

/** Straight (not premultiplied) RGBA8, row-major, `width * height * 4` bytes. */
export interface PixelBuffer {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

export interface Tag {
    id: string;
    name: string;
    color: number;
    fromFrameId: string;
    toFrameId: string;
    direction: "forward" | "reverse" | "pingpong";
    /** Integer 0..255; 0 = infinite. */
    repeat: number;
}

export interface GridSettings {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    visible: boolean;
}

export interface OnionSettings {
    enabled: boolean;
    /** 0..3. */
    before: number;
    /** 0..3. */
    after: number;
    /** 0..255. */
    opacity: number;
    /** 0..1. */
    falloff: number;
    tint: boolean;
    placement: "behind" | "front";
    withinTag: boolean;
}

export interface SymmetrySettings {
    mode: "none" | "x" | "y" | "both";
    /** Half-pixel units: `width` is the vertical centre line of the canvas. */
    axisX: number;
    /** Half-pixel units: `height` is the horizontal centre line of the canvas. */
    axisY: number;
}

/** The axes tiled mode repeats the canvas on (SE-062). */
export type TiledMode = "none" | "x" | "y" | "both";

export interface DocSettings {
    grid: GridSettings;
    pixelGrid: boolean;
    onion: OnionSettings;
    symmetry: SymmetrySettings;
    tiled: TiledMode;
}

export interface ExportSettings {
    layout: "grid" | "row" | "column";
    /** 0..8; the default is 1. */
    padding: number;
    /** 0..2; the default is 0. */
    extrude: number;
    trim: boolean;
    mergeDuplicates: boolean;
    frames: "all" | { tagId: string };
    files: { spritesTs: boolean; previewConfig: boolean; asepriteJson: "none" | "array" | "hash" };
    exportOnSave: boolean;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * One bit per pixel, row-major: pixel (x, y) is bit `i = y * width + x`, stored in
 * `data[i >> 3]` at `1 << (i & 7)`. `data` holds `Math.ceil((width * height) / 8)` bytes
 * and the unused bits of the last byte are 0.
 */
export interface BitMask {
    width: number;
    height: number;
    data: Uint8Array;
}

/**
 * Selected pixels of a session; "no selection" is `null`, not an empty mask. The mask has
 * the document's dimensions and `bounds` is the bounding rectangle of its set bits, in
 * document pixels.
 */
export interface Selection {
    mask: BitMask;
    bounds: Rect;
}

/** One per open document. Only `doc` is persisted. */
export interface DocSession {
    doc: SpriteDoc;
    selection: Selection | null;
    activeLayerId: string;
    activeFrameId: string;
}

/**
 * What a change affected: the shape of `Command.touched` (SPEC §5.2), which drives
 * compositor cache invalidation and viewport refresh.
 */
export interface Touched {
    frameIds: string[];
    layerIds: string[];
    structure: boolean;
}
