import type { ReferenceLayer } from "../../core/model";
import { setReferenceCommand } from "../../core/references";
import type { ReferenceChange, ReferencePlacement } from "../../core/references";
import type { OpenDocument } from "../state/sessions";
import { hitBox } from "../selection/transform/handles";
import { PAINT_REFUSED } from "../tools/paintTarget";
import type { ToolContext, ToolPointer } from "../tools/types";
import type { Point } from "../view/coordinates";
import { createReferencePreview } from "./referencePreview";
import type { ReferencePreviewStore } from "./referencePreview";
import type { ReferenceChangeResult } from "./references";
import {
    hitReferenceCorner,
    moveReferenceBy,
    referenceBox,
    scaleReferenceFrom,
} from "./referenceTransform";
import type { ReferenceCorner, SourceSize } from "./referenceTransform";

// The Move tool on a reference layer (SE-046; SPEC §7.6). With an unlocked, visible reference
// layer active, a press on a corner of its box scales it uniformly about the opposite corner,
// and a press anywhere else drags it by whole document pixels; its fraction stays. The drag
// is shown through `ReferencePreview` while it lasts and recorded at the release as one undo
// step ("Move Reference" or "Scale Reference"); a drag that ends where it began records
// nothing, and Escape or a pointer cancel puts the layer back as it was shown before. A locked
// or hidden reference layer does not move, and the status bar says why, with the paint tools'
// messages ("Layer is locked", "Layer is hidden"); so is one locked or hidden during the
// drag, at the release. Another layer made active during the drag cancels it.

/** The labels of the steps a drag records. */
export const MOVE_REFERENCE_LABEL = "Move Reference";
export const SCALE_REFERENCE_LABEL = "Scale Reference";

/** What the Move tool needs for reference layers. */
export interface ReferenceMoveSources {
    /** Where the drag is shown while it lasts; the default is a store of the tool's own. */
    preview?: ReferencePreviewStore;
    /**
     * Size of the layer's decoded source, or null while it is not decoded: then a press only
     * moves the layer, as its box is not known. The default knows no size.
     */
    sourceSize?(document: OpenDocument, layer: ReferenceLayer): SourceSize | null;
    /**
     * Records the change of a drag as one undo step of the stroke's document: the app passes
     * `changeReference` (SPEC §7.6). The default executes `setReferenceCommand` in the
     * stroke's history, refusing a locked layer with `PAINT_REFUSED.locked` as that does.
     */
    change?(
        context: ToolContext,
        layerId: string,
        change: ReferenceChange,
        label: string,
    ): ReferenceChangeResult;
}

/** The default `change`: one step in the stroke's history, a locked layer refused. */
export function changeInStroke(
    context: ToolContext,
    layerId: string,
    change: ReferenceChange,
    label: string,
): ReferenceChangeResult {
    const layer = context.session.doc.layers.find((candidate) => candidate.id === layerId);
    if (layer?.kind !== "reference" || context.history.transaction) return { changed: false };
    if (layer.locked) return { changed: false, refused: PAINT_REFUSED.locked };
    const command = setReferenceCommand(context.session, layerId, change, label);
    if (!command) return { changed: false };
    context.history.execute(command);
    return { changed: true };
}

interface ReferenceDrag {
    readonly layerId: string;
    /** The layer's placement at the press. */
    readonly start: ReferencePlacement;
    /** The corner pressed, with the source's size; null for a move. */
    readonly corner: ReferenceCorner | null;
    readonly size: SourceSize | null;
    /** Where the press was: the pixel for a move, the position for a scale. */
    readonly from: Point;
    /** The placement the drag gives now. */
    now: ReferencePlacement;
}

/** The part of the Move tool that acts on reference layers. */
export interface ReferenceMove {
    /**
     * A press of the Move tool with no float in the way. Returns false when the active layer
     * is not a reference layer (the tool goes on as for pixels); otherwise the press is taken:
     * a drag begins, or the status bar says why the layer cannot move.
     */
    press(context: ToolContext, pointer: ToolPointer, ratio: number): boolean;
    /**
     * Whether a press at `pointer` would be on the active reference layer's box: inside it or
     * on a corner, while the layer can move and its box is known (`ToolSpec.claims`, SE-062).
     */
    claims(document: OpenDocument, pointer: ToolPointer, ratio: number): boolean;
    /** The pointer moved during a drag of `context` (nothing without one). */
    follow(context: ToolContext, pointer: ToolPointer): void;
    /** The release: the drag's change becomes one undo step. */
    release(context: ToolContext, pointer: ToolPointer): void;
    /** Escape, a pointer cancel, the document left: the layer is shown as before the drag. */
    cancel(context: ToolContext): void;
}

export function createReferenceMove(sources: ReferenceMoveSources = {}): ReferenceMove {
    const preview = sources.preview ?? createReferencePreview();
    const sourceSize = sources.sourceSize ?? (() => null);
    const change = sources.change ?? changeInStroke;
    const drags = new WeakMap<ToolContext, ReferenceDrag>();

    const show = (context: ToolContext, drag: ReferenceDrag) =>
        preview.setState({ session: context.session, layerId: drag.layerId, ...drag.now }, true);

    /** Takes the preview away when it is this drag's. */
    const hide = (context: ToolContext, drag: ReferenceDrag) => {
        const shown = preview.getState();
        if (shown?.session === context.session && shown.layerId === drag.layerId) {
            preview.setState(null, true);
        }
    };

    /**
     * The drag of `context`, while the layer it drags is still the active one. Another layer
     * made active meanwhile cancels it: the layer is shown as before and nothing is recorded
     * (SE-046 review E).
     */
    const dragOf = (context: ToolContext): ReferenceDrag | null => {
        const drag = drags.get(context);
        if (!drag) return null;
        if (context.session.activeLayerId === drag.layerId) return drag;
        drags.delete(context);
        hide(context, drag);
        return null;
    };

    const follow = (context: ToolContext, pointer: ToolPointer) => {
        const drag = dragOf(context);
        if (!drag) return;
        const next =
            drag.corner && drag.size
                ? scaleReferenceFrom(
                      drag.start,
                      drag.size,
                      drag.corner,
                      pointer.position.x - drag.from.x,
                      pointer.position.y - drag.from.y,
                  )
                : moveReferenceBy(
                      drag.start,
                      pointer.pixel.x - drag.from.x,
                      pointer.pixel.y - drag.from.y,
                  );
        const { now } = drag;
        if (next.x === now.x && next.y === now.y && next.scale === now.scale) return;
        drag.now = next;
        show(context, drag);
    };

    return {
        claims(document, pointer, ratio) {
            const { session } = document;
            const layer = session.doc.layers.find((entry) => entry.id === session.activeLayerId);
            if (layer?.kind !== "reference" || !layer.visible || layer.locked) return false;
            const size = sourceSize(document, layer);
            if (!size) return false;
            const box = referenceBox({ x: layer.x, y: layer.y, scale: layer.scale }, size);
            const scale = document.view.scale;
            if (hitReferenceCorner(box, pointer.position, scale, ratio)) return true;
            return hitBox(box, pointer.position, scale, ratio).kind === "inside";
        },
        press(context, pointer, ratio) {
            const { session, document } = context;
            const layer = session.doc.layers.find((entry) => entry.id === session.activeLayerId);
            if (layer?.kind !== "reference") return false;
            if (!layer.visible) {
                context.feedback(PAINT_REFUSED.hidden);
                return true;
            }
            if (layer.locked) {
                context.feedback(PAINT_REFUSED.locked);
                return true;
            }
            const start = { x: layer.x, y: layer.y, scale: layer.scale };
            const size = sourceSize(document, layer);
            const corner = size
                ? hitReferenceCorner(
                      referenceBox(start, size),
                      pointer.position,
                      document.view.scale,
                      ratio,
                  )
                : null;
            const drag: ReferenceDrag = {
                layerId: layer.id,
                start,
                corner,
                size,
                from: corner
                    ? { x: pointer.position.x, y: pointer.position.y }
                    : { x: pointer.pixel.x, y: pointer.pixel.y },
                now: start,
            };
            drags.set(context, drag);
            show(context, drag);
            return true;
        },
        follow,
        release(context, pointer) {
            follow(context, pointer);
            const drag = dragOf(context);
            if (!drag) return;
            drags.delete(context);
            const { start, now } = drag;
            const moved = now.x !== start.x || now.y !== start.y || now.scale !== start.scale;
            let result: ReferenceChangeResult = { changed: false };
            try {
                const layer = context.session.doc.layers.find((entry) => entry.id === drag.layerId);
                if (!moved) {
                    // Nothing to record.
                } else if (layer?.kind === "reference" && !layer.visible) {
                    // Hidden during the drag: refused as a press on a hidden layer is (review E).
                    result = { changed: false, refused: PAINT_REFUSED.hidden };
                } else {
                    // The placement shown is the one recorded, all of it: an undo during the
                    // drag may have changed the layer since the press. The step first, then the
                    // preview goes, so the layer is shown where it was dropped throughout.
                    result = change(
                        context,
                        drag.layerId,
                        { x: now.x, y: now.y, scale: now.scale },
                        drag.corner ? SCALE_REFERENCE_LABEL : MOVE_REFERENCE_LABEL,
                    );
                }
            } finally {
                // Also when the change throws: the preview never outlives its drag (review C).
                hide(context, drag);
            }
            if (result.refused) context.feedback(result.refused);
        },
        cancel(context) {
            // `dragOf` hides a drag whose layer is no longer active itself.
            const drag = dragOf(context);
            if (!drag) return;
            drags.delete(context);
            hide(context, drag);
        },
    };
}
