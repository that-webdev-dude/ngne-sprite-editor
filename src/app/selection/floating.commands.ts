import type { CommandSpec } from "../commands/types";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { toolState } from "../tools/activeTool";
import { toolPipeline } from "../tools/appPipeline";
import { selectionFeedback } from "./feedback";
import { floatingState } from "./floatingState";
import { floatRefusal } from "./move/floatTarget";
import { MOVE_TOOL_ID } from "./move/moveTool";

// The keys of the floating selection (SPEC §7.8, SE-032). In the `floating` context, which is
// on exactly while pixels float: Enter applies them, Escape cancels them, the arrows nudge
// them by 1 px and Shift+arrows by 8 px. In the `canvas` context (the arrows act there only
// while the viewport itself has the focus), the arrows with a selection lift its pixels and
// nudge them: enabled only with a selection, while SE-022's canvas ← → change the frame only
// without one, so the two never share a key.
//
// A floating selection belongs to the Move tool (SPEC §5.2: a change to another tool applies
// it): a lift by the arrows selects the Move tool, as Paste does (`clipboard.ts`), and when
// another tool is selected the float is applied. A tool held for a while (Space → hand)
// does not change the selected tool, so the float stays while the view is panned.

interface Direction {
    key: string;
    name: string;
    dx: number;
    dy: number;
}

const DIRECTIONS: readonly Direction[] = [
    { key: "ArrowLeft", name: "Left", dx: -1, dy: 0 },
    { key: "ArrowRight", name: "Right", dx: 1, dy: 0 },
    { key: "ArrowUp", name: "Up", dx: 0, dy: -1 },
    { key: "ArrowDown", name: "Down", dx: 0, dy: 1 },
];

/** Shift+arrows nudge by this many pixels (SPEC §7.8). */
export const LONG_NUDGE = 8;

/** The ids of the commands of this module. */
export const FLOATING_COMMANDS = {
    apply: "floating.apply",
    cancel: "floating.cancel",
    /** `floating.nudge.left`, `floating.nudge.left.8`, … */
    nudge: (direction: string, by: number) =>
        `floating.nudge.${direction.toLowerCase()}${by === 1 ? "" : `.${by}`}`,
    /** `selection.liftNudge.left`, `selection.liftNudge.left.8`, … */
    liftNudge: (direction: string, by: number) =>
        `selection.liftNudge.${direction.toLowerCase()}${by === 1 ? "" : `.${by}`}`,
} as const;

const floats = () => floatingState.floats();

/** The active document while its selection can be lifted: idle, with a selection, no float. */
function liftable(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    if (!document || document.history.transaction || !document.session.selection) return null;
    return document;
}

/** Lifts the selection of the active document and nudges it (the canvas arrows). */
function liftAndNudge(dx: number, dy: number): void {
    const before = liftable();
    if (!before) return;
    const refused = floatRefusal(before);
    if (refused) {
        selectionFeedback(refused);
        return;
    }
    // The float is the Move tool's. Selecting it ends a selection tool's open gesture.
    toolState.select(MOVE_TOOL_ID);
    const document = liftable();
    if (!document) return;
    floatingState.lift(document);
    floatingState.moveBy(dx, dy);
}

function nudgeCommands(): CommandSpec[] {
    return DIRECTIONS.flatMap((direction) =>
        [1, LONG_NUDGE].flatMap((by): CommandSpec[] => {
            const shortcut = by === 1 ? direction.key : `Shift+${direction.key}`;
            const dx = direction.dx * by;
            const dy = direction.dy * by;
            const suffix = by === 1 ? "" : ` by ${by}`;
            return [
                {
                    id: FLOATING_COMMANDS.nudge(direction.name, by),
                    title: `Nudge Floating Selection ${direction.name}${suffix}`,
                    shortcut,
                    context: "floating",
                    enabled: floats,
                    run: () => floatingState.moveBy(dx, dy),
                },
                {
                    id: FLOATING_COMMANDS.liftNudge(direction.name, by),
                    title: `Lift and Nudge Selection ${direction.name}${suffix}`,
                    shortcut,
                    context: "canvas",
                    enabled: () => liftable() !== null,
                    run: () => liftAndNudge(dx, dy),
                },
            ];
        }),
    );
}

export const commands: CommandSpec[] = [
    {
        id: FLOATING_COMMANDS.apply,
        title: "Apply Floating Selection",
        shortcut: "Enter",
        context: "floating",
        enabled: floats,
        run() {
            floatingState.apply();
            // A drag of the float in progress ends with it; it has nothing left to move.
            toolPipeline.cancel();
        },
    },
    {
        id: FLOATING_COMMANDS.cancel,
        title: "Cancel Floating Selection",
        shortcut: "Escape",
        context: "floating",
        enabled: floats,
        run() {
            // During a drag of the Move tool, Escape takes back that drag only (SPEC §7.2): its
            // cancel cancels the float when the drag lifted it, and moves it back otherwise.
            if (toolPipeline.strokeTool?.id === MOVE_TOOL_ID) {
                toolPipeline.cancel();
                return;
            }
            // Escape cancels another tool's stroke in progress too, as it does without a float.
            toolPipeline.cancel();
            floatingState.cancel();
        },
    },
    ...nudgeCommands(),
];

// A change to a tool other than the Move tool applies the float (SPEC §5.2).
toolState.subscribe(() => {
    if (floatingState.float && toolState.selectedId() !== MOVE_TOOL_ID) floatingState.apply();
});
