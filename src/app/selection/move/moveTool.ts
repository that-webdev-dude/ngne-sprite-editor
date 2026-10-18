import type { FloatingSelection } from "../../../core/floating";
import { celAt } from "../../../core/model";
import type { Point } from "../../view/coordinates";
import type { ToolContext, ToolPointer, ToolSpec } from "../../tools/types";
import type { FloatingState } from "../floatingState";
import { floatRefusal } from "./floatTarget";

// The Move tool (SPEC §7.1, §7.2; SE-032), in the rail's planned Move slot (V). A press lifts
// the selected pixels of the active cel into a floating selection and the drag moves them by
// whole pixels, wherever on the canvas the press is; they float on after the release, until
// Enter or a press outside them applies them or Escape cancels them. With no selection the
// drag moves the whole cel, which is applied at the release: one undo step per drag. While
// pixels float, a press on one of them drags them again, and a press anywhere else applies
// them and does nothing more. Either button moves.

/** The id of the Move tool, which holds a floating selection (SPEC §5.2). */
export const MOVE_TOOL_ID = "move";

/** The status-bar hint of the Move tool (DESIGN §5.7). */
export const MOVE_HINT = "Drag to move · Arrows: nudge · Enter: apply · Escape: cancel";

/** One drag of the Move tool. */
interface Drag {
    /** The float the drag moves. */
    readonly float: FloatingSelection;
    /** The pixel pressed. */
    readonly start: Point;
    /** The float's top-left pixel at the press. */
    readonly origin: Point;
    /** The press lifted the float: a cancel of the drag cancels the float. */
    readonly lifted: boolean;
    /** The whole cel was lifted (no selection): applied at the release. */
    readonly applyAtRelease: boolean;
}

export interface MoveToolSources {
    floating: Pick<FloatingState, "float" | "floats" | "lift" | "moveTo" | "apply" | "cancel">;
}

/** The Move tool on `sources`. */
export function createMoveTool(sources: MoveToolSources): ToolSpec {
    const { floating } = sources;
    const drags = new WeakMap<ToolContext, Drag>();

    /** The drag of `context`, while its float is still the one floating. */
    const dragOf = (context: ToolContext): Drag | null => {
        const drag = drags.get(context);
        return drag && floating.float === drag.float ? drag : null;
    };

    const follow = (context: ToolContext, pointer: ToolPointer) => {
        const drag = dragOf(context);
        if (!drag) return;
        floating.moveTo(
            drag.origin.x + pointer.pixel.x - drag.start.x,
            drag.origin.y + pointer.pixel.y - drag.start.y,
        );
    };

    return {
        id: MOVE_TOOL_ID,
        label: "Move",
        hint: MOVE_HINT,
        cursor: "move",
        onDown(context, pointer) {
            const start = { x: pointer.pixel.x, y: pointer.pixel.y };
            const floated = floating.floats(context.document) ? floating.float : null;
            if (floated) {
                // A press outside the float applies it (SPEC §7.2), and that is all it does.
                if (!floated.contains(start.x, start.y)) {
                    floating.apply();
                    return;
                }
                drags.set(context, {
                    float: floated,
                    start,
                    origin: { x: floated.x, y: floated.y },
                    lifted: false,
                    applyAtRelease: false,
                });
                return;
            }
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
                float,
                start,
                origin: { x: float.x, y: float.y },
                lifted: true,
                applyAtRelease: whole,
            });
        },
        onMove: follow,
        onUp(context, pointer) {
            follow(context, pointer);
            const drag = dragOf(context);
            drags.delete(context);
            if (drag?.applyAtRelease) floating.apply();
        },
        onCancel(context) {
            const drag = dragOf(context);
            drags.delete(context);
            if (!drag) return;
            // Escape, a pointer cancel, the document left: what the drag did is taken back.
            if (drag.lifted) floating.cancel();
            else floating.moveTo(drag.origin.x, drag.origin.y);
        },
    };
}
