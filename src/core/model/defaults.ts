import type { DocSettings, ExportSettings } from "./types";

/** Smallest and largest document side, in pixels (SPEC §5.1). */
export const MIN_DOCUMENT_SIDE = 1;
export const MAX_DOCUMENT_SIDE = 1024;

export const MAX_REFERENCE_LAYERS = 4;
export const DEFAULT_FRAME_DURATION_MS = 100;

/** Settings of a new document of the given size; a new object on every call. */
export function defaultDocSettings(width: number, height: number): DocSettings {
    return {
        grid: { width: 16, height: 16, offsetX: 0, offsetY: 0, visible: false },
        pixelGrid: true,
        onion: {
            enabled: false,
            before: 1,
            after: 1,
            opacity: 128,
            falloff: 0.5,
            tint: false,
            placement: "behind",
            withinTag: false,
        },
        // Half-pixel units, so these are the centre lines of the canvas.
        symmetry: { mode: "none", axisX: width, axisY: height },
        tiled: "none",
    };
}

/** Export settings of a new document (SPEC §5.1, §9.1, §9.4); a new object on every call. */
export function defaultExportSettings(): ExportSettings {
    return {
        layout: "grid",
        padding: 1,
        extrude: 0,
        trim: false,
        mergeDuplicates: true,
        frames: "all",
        files: { spritesTs: true, previewConfig: true, asepriteJson: "none" },
        exportOnSave: false,
    };
}
