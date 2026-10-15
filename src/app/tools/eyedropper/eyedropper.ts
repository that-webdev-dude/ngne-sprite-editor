import type { StoreApi } from "zustand/vanilla";
import { celAt } from "../../../core/model";
import type { DocSession } from "../../../core/model";
import type { ActiveComposites } from "../../state/composites";
import type { EditorState } from "../../state/editor";
import type { Point } from "../../view/coordinates";
import type { ChoiceToolOption, ToolContext, ToolPointer, ToolSpec } from "../types";

// The eyedropper (SPEC §7.1, SE-016): a press, and every sample of the drag that follows, takes
// the colour of the document pixel under the pointer into the foreground (left button) or the
// background (right button). It samples the composite of the active frame — every visible
// pixel layer blended, as the composite cache holds it (SPEC §5.3) — or the active layer's own
// pixels. Holding Alt makes it the active tool while a paint tool is selected (SPEC §7.8).
//
// It writes no pixels, so it works at every zoom step (SPEC §7.1). Below 1× a device pixel
// shows one of several texels, picked by NGNE's sampling; the eyedropper then takes the texel
// the pointer names (`ToolPointer.pixel`: the first texel of the device pixel), which may be
// a neighbour of the one on screen, never a blend of them.

/** Where the eyedropper samples: the frame as composited, or the active layer alone. */
export const SAMPLE_OPTION: ChoiceToolOption = {
    kind: "choice",
    key: "sample",
    label: "Sample",
    choices: [
        { value: "composite", label: "Composite" },
        { value: "layer", label: "Active layer" },
    ],
    default: "composite",
};

export interface EyedropperSources {
    /** Where the picked colour goes. */
    editor: StoreApi<EditorState>;
    /** The composite of the active document's frames. */
    composites: Pick<ActiveComposites, "cacheOf">;
}

function rgbaAt(data: Uint8Array | Uint8ClampedArray, width: number, pixel: Point): number {
    const at = (pixel.y * width + pixel.x) * 4;
    return (
        (((data[at] ?? 0) << 24) |
            ((data[at + 1] ?? 0) << 16) |
            ((data[at + 2] ?? 0) << 8) |
            (data[at + 3] ?? 0)) >>>
        0
    );
}

/**
 * The colour 0xRRGGBBAA of document pixel `pixel` (inside the document) at the active frame of
 * `session`: of its composite, or with `sample` "layer" of the active layer's cel, as stored
 * (an empty cel is transparent, 0x00000000). Null when there is nothing to sample: no
 * composite for the session, or a reference layer as the active layer.
 */
export function sampleColour(
    session: DocSession,
    sample: string,
    pixel: Point,
    composites: EyedropperSources["composites"],
): number | null {
    const { doc, activeFrameId, activeLayerId } = session;
    if (sample === "layer") {
        const layer = doc.layers.find((candidate) => candidate.id === activeLayerId);
        if (layer?.kind !== "pixel") return null;
        const cel = celAt(doc, layer.id, activeFrameId);
        const image = cel ? doc.images.get(cel.imageId) : undefined;
        return image ? rgbaAt(image.data, image.width, pixel) : 0;
    }
    const composite = composites.cacheOf(session)?.get(activeFrameId);
    return composite ? rgbaAt(composite.data, composite.width, pixel) : null;
}

/** The eyedropper tool, picking from `sources.composites` into `sources.editor`. */
export function createEyedropper(sources: EyedropperSources): ToolSpec {
    const pick = (context: ToolContext, pointer: ToolPointer) => {
        if (!pointer.inside) return;
        const colour = sampleColour(
            context.session,
            String(context.options[SAMPLE_OPTION.key]),
            pointer.pixel,
            sources.composites,
        );
        if (colour === null) return;
        const slot = context.button === "primary" ? "foreground" : "background";
        const editor = sources.editor.getState();
        if (editor[slot] !== colour) editor.setColour(slot, colour);
    };
    return {
        id: "eyedropper",
        label: "Eyedropper",
        options: [SAMPLE_OPTION],
        // Alt takes it from a paint tool only: from the zoom tool Alt zooms out (SPEC §7.1).
        hold: { key: "Alt", when: (selected) => selected?.paints === true },
        cursor: "crosshair",
        onDown: pick,
        onMove: pick,
    };
}
