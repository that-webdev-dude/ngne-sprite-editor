import { documentRect } from "../../engine/viewport/geometry";
import type { CommandSpec } from "../commands/types";
import { notices } from "../notices/notices";
import { browserClipboard } from "../platform/clipboard";
import { editorStore } from "../state/editor";
import { sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { toolState } from "../tools/activeTool";
import type { Point } from "../view/coordinates";
import { viewportLink } from "../viewport/viewportLink";
import { createEditorClipboard } from "./clipboard";
import type { EditorClipboard } from "./clipboard";
import { selectionFeedback } from "./feedback";
import { floatingState } from "./floatingState";
import { MOVE_TOOL_ID } from "./move/moveTool";

// Cut, Copy, Paste, Delete and Fill (SPEC §7.2, §7.8; SE-032): Ctrl+X, Ctrl+C, Ctrl+V and
// Delete in the `global` context (not in a text field, which cuts, copies and pastes its own
// text), Fill with no key. They take the Edit menu items planned for them
// (commands/planned.commands.ts). `clipboard.ts` holds what they do.

/**
 * The document position at the centre of the viewport showing `document`: its centre in
 * device pixels mapped through the view, or the document's centre while no viewport is
 * measured.
 */
function viewportCentre(document: OpenDocument): Point {
    const { width, height } = viewportLink.deviceSize;
    const { doc } = document.session;
    if (width <= 0 || height <= 0) return { x: doc.width / 2, y: doc.height / 2 };
    const rect = documentRect(document.view, doc.width, doc.height);
    return {
        x: ((width / 2 - rect.x) * doc.width) / rect.width,
        y: ((height / 2 - rect.y) * doc.height) / rect.height,
    };
}

/** The clipboard of the app. */
export const editorClipboard: EditorClipboard = createEditorClipboard({
    sessions: sessionsStore,
    floating: floatingState,
    system: browserClipboard(),
    feedback: selectionFeedback,
    notices,
    foreground: () => editorStore.getState().foreground,
    selectMove: () => void toolState.select(MOVE_TOOL_ID),
    centre: viewportCentre,
});

export const commands: CommandSpec[] = [
    {
        id: "edit.cut",
        title: "Cut",
        shortcut: "Ctrl+X",
        enabled: () => editorClipboard.canCopy(),
        run: () => editorClipboard.cut(),
    },
    {
        id: "edit.copy",
        title: "Copy",
        shortcut: "Ctrl+C",
        enabled: () => editorClipboard.canCopy(),
        run: () => editorClipboard.copy(),
    },
    {
        id: "edit.paste",
        title: "Paste",
        shortcut: "Ctrl+V",
        enabled: () => editorClipboard.canPaste(),
        run: () => editorClipboard.paste(),
    },
    {
        id: "edit.delete",
        title: "Delete",
        shortcut: "Delete",
        enabled: () => editorClipboard.canEdit(),
        run: () => editorClipboard.deleteSelected(),
    },
    {
        id: "edit.fill",
        title: "Fill",
        enabled: () => editorClipboard.canEdit(),
        run: () => editorClipboard.fill(),
    },
];
