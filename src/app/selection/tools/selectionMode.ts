import type { BitMask } from "../../../core/model";
import { selectCommand, selectionOf, setSelectionCommand } from "../../../core/selection";
import type { SelectionMode } from "../../../core/selection";
import type {
    ChoiceToolOption,
    ToolContext,
    ToolModifiers,
    ToolOptionValue,
} from "../../tools/types";

// How a selection tool's shape combines with the selection (SPEC §7.1, §7.2; SE-031): the
// context bar's Mode, unless Shift (add), Alt (subtract) or both (intersect) are held at the
// press that begins the gesture. A completed gesture is one command of the document's history,
// labelled with the tool's name; one that would leave the same pixels selected records nothing.

/** Replace, add, subtract or intersect: the mode toggles of the context bar (DESIGN §5.2). */
export const SELECTION_MODE: ChoiceToolOption = {
    kind: "choice",
    key: "mode",
    label: "Mode",
    choices: [
        { value: "replace", label: "Replace" },
        { value: "add", label: "Add" },
        { value: "subtract", label: "Subtract" },
        { value: "intersect", label: "Intersect" },
    ],
    default: "replace",
};

/** The status-bar hint of the selection tools' modifiers (DESIGN §5.7). */
export const SELECTION_HINT = "Shift: add · Alt: subtract · Shift+Alt: intersect";

const MODES: readonly SelectionMode[] = ["replace", "add", "subtract", "intersect"];

/**
 * The mode of a gesture: from the modifiers held at its first press, or else the tool's Mode
 * option.
 */
export function selectionModeOf(
    values: Readonly<Record<string, ToolOptionValue>>,
    modifiers: Readonly<ToolModifiers>,
): SelectionMode {
    if (modifiers.shift && modifiers.alt) return "intersect";
    if (modifiers.shift) return "add";
    if (modifiers.alt) return "subtract";
    const chosen = values[SELECTION_MODE.key];
    return MODES.find((mode) => mode === chosen) ?? "replace";
}

/**
 * Combines `shape` (a mask of the document's size) with the selection of the stroke's
 * document by `mode`, as one history step labelled `label`. Returns whether it recorded one.
 */
export function applySelection(
    context: ToolContext,
    shape: BitMask,
    mode: SelectionMode,
    label: string,
): boolean {
    // Replace keeps the shape's very mask (nothing changes it afterwards), so the ants find the
    // boundary its preview worked out (`boundaryCache.ts`).
    const command =
        mode === "replace"
            ? setSelectionCommand(context.session, selectionOf(shape), label)
            : selectCommand(context.session, shape, mode, label);
    if (!command) return false;
    context.history.execute(command);
    return true;
}
