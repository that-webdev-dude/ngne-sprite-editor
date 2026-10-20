import { compositeFrame } from "../../../core/composite";
import type { PixelBuffer } from "../../../core/model";
import {
    FLOOD_MAX_TOLERANCE,
    paintInk,
    paintMask,
    symmetricFloodMask,
    symmetricPoints,
} from "../../../core/raster";
import type { ActiveComposites } from "../../state/composites";
import { INK, inkOf, OPACITY, opacityOf } from "../brush/brushOptions";
import { strokeSymmetryOf } from "../brush/strokeOptions";
import type {
    ChoiceToolOption,
    NumberToolOption,
    ToggleToolOption,
    ToolContext,
    ToolPointer,
    ToolSpec,
} from "../types";

// The paint bucket (SPEC §7.1, SE-017): the press fills the area of the pixel under the
// pointer — the pixels the flood fill of `core/raster` takes from it — with the colour of the
// button (left foreground, right background), in the chosen ink and opacity. The area is
// found in the active layer's pixels or in the frame's composite (Sample), with a tolerance,
// contiguous or not; with a selection it stays inside it, and the transaction's clip keeps
// every other pixel. A fill is one undo step; a fill that changes nothing records nothing.
// The drag that follows the press does nothing more.
//
// With symmetry (SE-062) the press's pixel and its mirror images are seeds: every seed's area
// is found before any pixel is painted, and their union is painted once, so a later seed does
// not read what an earlier one wrote. In tiled mode a press on a copy of the canvas fills from
// the pixel it shows; the area itself does not wrap around the edges.
//
// It paints, so it is refused below 1× like the brush tools. It has no brush: its cursor is a
// crosshair, whose centre names the pixel the fill starts from.

export const TOLERANCE: NumberToolOption = {
    kind: "number",
    key: "tolerance",
    label: "Tolerance",
    min: 0,
    max: FLOOD_MAX_TOLERANCE,
    default: 0,
};

export const CONTIGUOUS: ToggleToolOption = {
    kind: "toggle",
    key: "contiguous",
    label: "Contiguous",
    default: true,
};

/** Where the fill finds its area: the active layer's pixels, or the frame as composited. */
export const FILL_SAMPLE: ChoiceToolOption = {
    kind: "choice",
    key: "sample",
    label: "Sample",
    choices: [
        { value: "layer", label: "Active layer" },
        { value: "composite", label: "Composite" },
    ],
    default: "layer",
};

export interface BucketSources {
    /** The composites of the active document's frames, for Sample: Composite. */
    composites: Pick<ActiveComposites, "cacheOf">;
}

/** The tolerance the option values set: a whole number from 0 to 255. */
function toleranceOf(values: ToolContext["options"]): number {
    const value = values[TOLERANCE.key];
    const number = typeof value === "number" && Number.isFinite(value) ? value : TOLERANCE.default;
    return Math.min(TOLERANCE.max, Math.max(TOLERANCE.min, Math.round(number)));
}

/** The paint bucket, sampling composites from `sources.composites`. */
export function createBucket(sources: BucketSources): ToolSpec {
    /** The pixels the fill samples: the layer's image as the stroke found it, or the frame's composite. */
    const sampled = (context: ToolContext, image: PixelBuffer, frameId: string): PixelBuffer => {
        if (context.options[FILL_SAMPLE.key] !== "composite") return image;
        // At the press the cache holds the stroke's live composite, which nothing has
        // changed yet: the frame as it was before the fill.
        return (
            sources.composites.cacheOf(context.session)?.get(frameId) ??
            compositeFrame(context.session.doc, frameId)
        );
    };

    return {
        id: "bucket",
        label: "Paint bucket",
        paints: true,
        options: [CONTIGUOUS, FILL_SAMPLE, TOLERANCE, INK, OPACITY],
        cursor: "crosshair",
        onDown(context: ToolContext, pointer: ToolPointer) {
            const { paint, options: values } = context;
            if (!paint) return;
            // Off the canvas no seed is named, unless tiled mode wraps the press onto it: then
            // nothing is sampled either (SE-062 review H).
            const symmetry = strokeSymmetryOf(context);
            const { width, height } = paint.image;
            if (symmetricPoints(symmetry, width, height, pointer.pixel).length === 0) return;
            const mask = symmetricFloodMask(
                sampled(context, paint.image, paint.frameId),
                pointer.pixel,
                {
                    tolerance: toleranceOf(values),
                    contiguous: values[CONTIGUOUS.key] !== false,
                    within: context.session.selection?.mask ?? null,
                },
                symmetry,
            );
            const ink = paintInk(inkOf(values), context.colour, opacityOf(values));
            // Each pixel is inked from its own value before it is written: no copy is needed.
            const changed = paintMask(paint.image, paint.image, mask, ink);
            if (changed) paint.markDirty(changed);
        },
    };
}
