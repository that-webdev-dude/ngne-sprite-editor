import { MAX_TRANSFORM_SIDE } from "../../../core/floating";
import type { FloatingSelection, FreeTransform } from "../../../core/floating";
import { celAt } from "../../../core/model";
import { createReferenceMove } from "../../references/referenceMove";
import type { ReferenceMoveSources } from "../../references/referenceMove";
import type { Point } from "../../view/coordinates";
import type { ToolContext, ToolPointer, ToolSpec } from "../../tools/types";
import type { FloatingState } from "../floatingState";
import { hitBox, rotateBoxTo, scaleBox } from "../transform/handles";
import type { HandleId } from "../transform/handles";
import { floatRefusal } from "./floatTarget";

// The Move tool (SPEC §7.1, §7.2; SE-032), in the rail's planned Move slot (V). A press lifts
// the selected pixels of the active cel into a floating selection and the drag moves them by
// whole pixels, wherever on the canvas the press is; they float on after the release, until
// Enter or a press outside them applies them or Escape cancels them. With no selection the
// drag moves the whole cel, which is applied at the release: one undo step per drag. While
// pixels float, a press on one of them drags them again, and a press anywhere else applies
// them and does nothing more. Either button moves.
//
// Free transform (SE-033): while a selection floats, a press off its pixels on one of the
// eight handles of its box scales it (Shift keeps the aspect ratio), and a press outside the
// box, within reach of it, turns it about its centre (Shift snaps to 15°); a press farther out
// applies it as before. Each drag sets the float's transform from where it began, so Escape
// takes back exactly that drag.
//
// Reference layers (SE-046): with no float, a press with a reference layer active drags that
// layer, or scales it by a corner of its box (`references/referenceMove.ts`), one undo step
// per drag; a locked or hidden one does not move, and the status bar says why.

/** The id of the Move tool, which holds a floating selection (SPEC §5.2). */
export const MOVE_TOOL_ID = "move";

/** The status-bar hint of the Move tool (DESIGN §5.7). */
export const MOVE_HINT = "Drag to move · Arrows: nudge · Enter: apply · Escape: cancel";

interface DragBase {
    /** The float the drag acts on. */
    readonly float: FloatingSelection;
}

/** A drag that moves the float. */
interface MoveDrag extends DragBase {
    readonly kind: "move";
    /** The pixel pressed. */
    readonly start: Point;
    /** The float's top-left pixel at the press. */
    readonly origin: Point;
    /** The press lifted the float: a cancel of the drag cancels the float. */
    readonly lifted: boolean;
    /** The whole cel was lifted (no selection): applied at the release. */
    readonly applyAtRelease: boolean;
}

/** A drag that scales the float by a handle, or turns it (SE-033). */
interface TransformDrag extends DragBase {
    readonly kind: "scale" | "rotate";
    readonly handle: HandleId | null;
    /** The document position pressed, with its fraction. */
    readonly start: Point;
    /** The float's transform and label at the press: a cancel puts them back. */
    readonly origin: FreeTransform;
    readonly label: string;
    /** The longest side the box may take (`FloatingSelection.setTransform`). */
    readonly limit: number;
    /** The last pointer of the drag, for a Shift pressed or released while it lasts. */
    last: ToolPointer;
}

type Drag = MoveDrag | TransformDrag;

export interface MoveToolSources {
    floating: Pick<
        FloatingState,
        "float" | "floats" | "lift" | "moveTo" | "setTransform" | "apply" | "cancel"
    >;
    /** Device pixels per CSS pixel, for the size of the handles; the default is 1. */
    ratio?(): number;
    /** What a drag of a reference layer works with (SE-046); see `ReferenceMoveSources`. */
    references?: ReferenceMoveSources;
}

/** The Move tool on `sources`. */
export function createMoveTool(sources: MoveToolSources): ToolSpec {
    const { floating } = sources;
    const ratio = sources.ratio ?? (() => 1);
    const drags = new WeakMap<ToolContext, Drag>();
    const references = createReferenceMove(sources.references);

    /** The drag of `context`, while its float is still the one floating. */
    const dragOf = (context: ToolContext): Drag | null => {
        const drag = drags.get(context);
        return drag && floating.float === drag.float ? drag : null;
    };

    const follow = (context: ToolContext, pointer: ToolPointer) => {
        const drag = dragOf(context);
        if (!drag) return;
        if (drag.kind === "move") {
            floating.moveTo(
                drag.origin.x + pointer.pixel.x - drag.start.x,
                drag.origin.y + pointer.pixel.y - drag.start.y,
            );
            return;
        }
        drag.last = pointer;
        const shift = pointer.modifiers.shift;
        floating.setTransform(
            drag.kind === "scale" && drag.handle
                ? scaleBox(drag.origin, drag.handle, pointer.position, shift, drag.limit)
                : rotateBoxTo(drag.origin, drag.start, pointer.position, shift),
        );
    };

    /**
     * A press on the float's box off its pixels (SE-033): a handle scales it, the ring outside
     * the box turns it. Returns whether a drag began.
     */
    const pressBox = (context: ToolContext, pointer: ToolPointer, float: FloatingSelection) => {
        if (!float.selects) return false;
        const transform = float.transform;
        const hit = hitBox(transform, pointer.position, context.document.view.scale, ratio());
        if (hit.kind !== "handle" && hit.kind !== "rotate") return false;
        drags.set(context, {
            kind: hit.kind === "handle" ? "scale" : "rotate",
            handle: hit.kind === "handle" ? hit.handle : null,
            float,
            start: { x: pointer.position.x, y: pointer.position.y },
            origin: transform,
            label: float.label,
            limit: Math.max(
                MAX_TRANSFORM_SIDE,
                float.source.pixels.width,
                float.source.pixels.height,
            ),
            last: pointer,
        });
        return true;
    };

    return {
        id: MOVE_TOOL_ID,
        label: "Move",
        hint: MOVE_HINT,
        cursor: "move",
        // Only where the pointer is matters: each sample would rewrite the float's two
        // rectangles and make a new selection (a transform also renders the float anew).
        latestSample: true,
        // Its float's pixels and box, or the active reference layer's box, keep a press there
        // from other chrome over the viewport (SE-062: a symmetry axis's handle).
        claims(document, pointer) {
            const floated = floating.floats(document) ? floating.float : null;
            if (floated) {
                if (floated.contains(pointer.pixel.x, pointer.pixel.y)) return true;
                if (!floated.selects) return false;
                const hit = hitBox(
                    floated.transform,
                    pointer.position,
                    document.view.scale,
                    ratio(),
                );
                return hit.kind !== "outside";
            }
            return references.claims(document, pointer, ratio());
        },
        onDown(context, pointer) {
            const start = { x: pointer.pixel.x, y: pointer.pixel.y };
            const floated = floating.floats(context.document) ? floating.float : null;
            if (floated) {
                if (!floated.contains(start.x, start.y)) {
                    if (pressBox(context, pointer, floated)) return;
                    // A press outside the float applies it (SPEC §7.2), and that is all it does.
                    floating.apply();
                    return;
                }
                drags.set(context, {
                    kind: "move",
                    float: floated,
                    start,
                    origin: { x: floated.x, y: floated.y },
                    lifted: false,
                    applyAtRelease: false,
                });
                return;
            }
            // The active layer is a reference layer: its drag, or why it cannot move.
            if (references.press(context, pointer, ratio())) return;
            const refused = floatRefusal(context.document);
            if (refused) {
                context.feedback(refused);
                return;
            }
            const { session } = context;
            const whole = session.selection === null;
            // An empty cel with no selection has nothing to move.
            if (whole && !celAt(session.doc, session.activeLayerId, session.activeFrameId)) {
                return;
            }
            const float = floating.lift(context.document, { whole });
            drags.set(context, {
                kind: "move",
                float,
                start,
                origin: { x: float.x, y: float.y },
                lifted: true,
                applyAtRelease: whole,
            });
        },
        onMove(context, pointer) {
            follow(context, pointer);
            references.follow(context, pointer);
        },
        onUp(context, pointer) {
            references.release(context, pointer);
            follow(context, pointer);
            const drag = dragOf(context);
            drags.delete(context);
            if (drag?.kind === "move" && drag.applyAtRelease) floating.apply();
        },
        onKey(context, key) {
            // Shift held or released during a scale or a turn takes effect where the pointer is.
            const drag = dragOf(context);
            if (!drag || drag.kind === "move" || key.key !== "Shift") return false;
            follow(context, { ...drag.last, modifiers: key.modifiers });
            return true;
        },
        onCancel(context) {
            references.cancel(context);
            const drag = dragOf(context);
            drags.delete(context);
            // When the document is left the float is no longer the one floating (`dragOf`):
            // it is applied as the drag left it, or goes with a closed document
            // (`floatingState.ts`), so there is nothing to take back here.
            if (!drag) return;
            // Escape, a pointer cancel, a lost capture: what the drag did is taken back.
            if (drag.kind !== "move") {
                floating.setTransform(drag.origin);
                drag.float.label = drag.label;
            } else if (drag.lifted) floating.cancel();
            else floating.moveTo(drag.origin.x, drag.origin.y);
        },
    };
}
