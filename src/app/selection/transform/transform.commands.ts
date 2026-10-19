import type { FlipAxis } from "../../../core/floating";
import { celAt } from "../../../core/model";
import type { CommandSpec } from "../../commands/types";
import { activeDocument, sessionsStore } from "../../state/sessions";
import type { OpenDocument } from "../../state/sessions";
import { toolState } from "../../tools/activeTool";
import { toolPipeline } from "../../tools/appPipeline";
import { selectionFeedback } from "../feedback";
import { floatingState } from "../floatingState";
import { floatRefusal } from "../move/floatTarget";
import { MOVE_TOOL_ID } from "../move/moveTool";
import { takeTransformDraft } from "./transformDraft";

// The transforms of the selection (SPEC §7.2, SE-033): Flip Horizontal, Flip Vertical, Rotate
// 90° CW, Rotate 90° CCW and Rotate 180°, in the Edit menu items planned for them, and Set
// Transform, the command the context bar's fields run.
//
//   pixels float          → the float is transformed in place, still floating
//   a selection, no float → its pixels are lifted, the Move tool selected, and the float
//                           transformed: it floats on, as Aseprite's Flip and Rotate with a
//                           selection start its selection transformation (checked in its source:
//                           `FlipCommand`, `RotateCommand` → `startFlipTransformation`,
//                           `startSelectionTransformation`); Enter applies it as one step
//   no selection          → the whole cel is transformed about the canvas's centre and applied
//                           at once, one step labelled with the command (clipped to the canvas)
//
// Each needs an idle history or the float's transaction (not a stroke's), and a cel that can
// take paint (the messages of SPEC §7.1); an empty cel with no selection has nothing to turn.

/** The ids of the commands of this module. */
export const TRANSFORM_COMMANDS = {
    flipHorizontal: "edit.flipHorizontal",
    flipVertical: "edit.flipVertical",
    rotate90cw: "edit.rotate90cw",
    rotate90ccw: "edit.rotate90ccw",
    rotate180: "edit.rotate180",
    /** Sets the transform typed in the context bar (`transformDraft.ts`). */
    set: "floating.transform.set",
} as const;

/** One transform of the selection's pixels. */
type Change = { flip: FlipAxis } | { turns: number };

/** The active document while a transform command can act on it. */
function target(): OpenDocument | null {
    // Refused during a stroke, a drag of the floating pixels included: a flip in the middle of
    // a handle drag would mix the drag's angle with the flipped source (SE-033 review F).
    if (toolPipeline.stroking) return null;
    const document = activeDocument(sessionsStore.getState());
    if (!document) return null;
    if (floatingState.floats(document)) return document;
    return document.history.transaction ? null : document;
}

function change(make: Change): void {
    if ("flip" in make) floatingState.flip(make.flip);
    else floatingState.rotate(make.turns);
}

function transformSelection(title: string, make: Change): void {
    const document = target();
    if (!document) return;
    if (floatingState.floats(document)) {
        change(make);
        return;
    }
    const refused = floatRefusal(document);
    if (refused) {
        selectionFeedback(refused);
        return;
    }
    const { session } = document;
    if (session.selection) {
        // The float is the Move tool's, as Paste's and the arrows' are (SPEC §7.2).
        toolState.select(MOVE_TOOL_ID);
        const now = target();
        if (!now || floatingState.floats(now) || !now.session.selection) return;
        floatingState.lift(now);
        change(make);
        return;
    }
    // No selection: the whole cel, applied at once.
    if (!celAt(session.doc, session.activeLayerId, session.activeFrameId)) return;
    floatingState.lift(document, { whole: true, label: title });
    change(make);
    floatingState.apply();
}

function transformCommand(id: string, title: string, make: Change): CommandSpec {
    return {
        id,
        title,
        enabled: () => target() !== null,
        run: () => transformSelection(title, make),
    };
}

export const commands: CommandSpec[] = [
    transformCommand(TRANSFORM_COMMANDS.flipHorizontal, "Flip Horizontal", {
        flip: "horizontal",
    }),
    transformCommand(TRANSFORM_COMMANDS.flipVertical, "Flip Vertical", { flip: "vertical" }),
    transformCommand(TRANSFORM_COMMANDS.rotate90cw, "Rotate 90° CW", { turns: 1 }),
    transformCommand(TRANSFORM_COMMANDS.rotate90ccw, "Rotate 90° CCW", { turns: -1 }),
    transformCommand(TRANSFORM_COMMANDS.rotate180, "Rotate 180°", { turns: 2 }),
    {
        id: TRANSFORM_COMMANDS.set,
        title: "Set Floating Selection Transform",
        enabled: () => !toolPipeline.stroking && floatingState.float?.selects === true,
        run() {
            const draft = takeTransformDraft();
            if (!draft || toolPipeline.stroking || floatingState.float?.selects !== true) return;
            floatingState.setTransform(draft);
        },
    },
];
