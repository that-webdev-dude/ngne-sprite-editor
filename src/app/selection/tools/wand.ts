import { compositeFrame } from "../../../core/composite";
import { celAt } from "../../../core/model";
import type { BitMask, DocSession, PixelBuffer } from "../../../core/model";
import { createPixelBuffer } from "../../../core/pixels";
import { FLOOD_MAX_TOLERANCE, floodMask } from "../../../core/raster";
import { createMask } from "../../../core/selection";
import type { SelectionMode } from "../../../core/selection";
import type { ActiveComposites } from "../../state/composites";
import { CONTIGUOUS, FILL_SAMPLE, TOLERANCE } from "../../tools/bucket/bucket";
import type { ToolContext, ToolSpec } from "../../tools/types";
import type { PendingStore } from "./pendingShape";
import { applySelection, SELECTION_HINT, SELECTION_MODE, selectionModeOf } from "./selectionMode";

// The magic wand (SPEC §7.1, §7.2; SE-031): the press picks the area of the pixel under the
// pointer — the flood mask of `core/raster` (SE-017): the pixels matching its colour within the
// tolerance, joined to it by their edges when Contiguous is on — in the active layer's pixels
// or the frame's composite (Sample), and the release combines it with the selection by the
// mode of the press, as one history step. Escape before the release takes it back. A press
// outside the document picks nothing, which with Replace deselects.
//
// The area is found in the whole image: the wand passes no `within` mask to `floodMask`, so
// the selection limits neither branch, contiguous or global (the SE-017 review's question), as
// in Aseprite, whose selection inks fill with no mask.
// The mode decides what the selection does with the area — Shift+Alt (intersect) keeps the part
// of it inside the selection. The pending area shows on the overlay until the release.

export interface WandSources {
    /** The composites of the active document's frames, for Sample: Composite. */
    composites: Pick<ActiveComposites, "cacheOf">;
}

/** The tolerance the option values set: a whole number from 0 to 255. */
function toleranceOf(values: ToolContext["options"]): number {
    const value = values[TOLERANCE.key];
    const number = typeof value === "number" && Number.isFinite(value) ? value : TOLERANCE.default;
    return Math.min(FLOOD_MAX_TOLERANCE, Math.max(0, Math.round(number)));
}

/**
 * The pixels the wand samples at the active frame of `session`: the composite (as the cache
 * holds it), or the active layer's cel as stored, an empty cel being transparent. Null when
 * the active layer is a reference layer, which has no pixels of the document.
 */
export function wandSource(
    session: DocSession,
    sample: unknown,
    composites: WandSources["composites"],
): PixelBuffer | null {
    const { doc, activeFrameId, activeLayerId } = session;
    if (sample === "composite") {
        return (
            composites.cacheOf(session)?.get(activeFrameId) ?? compositeFrame(doc, activeFrameId)
        );
    }
    const layer = doc.layers.find((candidate) => candidate.id === activeLayerId);
    if (layer?.kind !== "pixel") return null;
    const cel = celAt(doc, layer.id, activeFrameId);
    const image = cel ? doc.images.get(cel.imageId) : undefined;
    return image ?? createPixelBuffer(doc.width, doc.height, 0);
}

interface WandPick {
    readonly mask: BitMask;
    readonly mode: SelectionMode;
}

/** The magic wand on `sources`, showing its pick in `pending`. */
export function createWand(sources: WandSources, pending: PendingStore): ToolSpec {
    const picks = new WeakMap<ToolContext, WandPick>();
    return {
        id: "wand",
        label: "Magic wand",
        hint: SELECTION_HINT,
        // DESIGN §5.2: mode toggles · tolerance.
        options: [SELECTION_MODE, CONTIGUOUS, FILL_SAMPLE, TOLERANCE],
        cursor: "crosshair",
        onDown(context, pointer) {
            const { session, options: values } = context;
            const source = wandSource(session, values[FILL_SAMPLE.key], sources.composites);
            if (!source) return;
            const mask = pointer.inside
                ? floodMask(source, pointer.pixel, {
                      tolerance: toleranceOf(values),
                      contiguous: values[CONTIGUOUS.key] !== false,
                  })
                : createMask(session.doc.width, session.doc.height);
            picks.set(context, { mask, mode: selectionModeOf(values, pointer.modifiers) });
            pending.set(session, { kind: "mask", mask });
        },
        onUp(context) {
            const pick = picks.get(context);
            picks.delete(context);
            pending.clear();
            if (pick) applySelection(context, pick.mask, pick.mode, "Magic wand");
        },
        onCancel(context) {
            picks.delete(context);
            pending.clear();
        },
    };
}
