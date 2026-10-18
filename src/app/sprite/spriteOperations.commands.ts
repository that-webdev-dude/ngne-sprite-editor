import type { Command } from "../../core/history";
import type { DocSession } from "../../core/model";
import {
    canvasSizeCommand,
    cropToSelectionCommand,
    flipCanvasCommand,
    rotateCanvasCommand,
    spriteSizeCommand,
    trimCommand,
} from "../../core/sprite";
import type { CommandSpec } from "../commands/types";
import { applyFloating } from "../selection/floating";
import { settleableDocument } from "../selection/settled";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { spriteDialogs } from "./dialogs";

// Sprite operations of SPEC §7.7 (SE-034): canvas size, sprite size, crop to selection, trim,
// rotate canvas and flip canvas. Each is one undoable step over every image of the active
// document; it applies a floating selection first and clears the selection (SPEC §5.2), which
// undo restores. They take the Sprite menu items planned for their ids
// (commands/planned.commands.ts). A refusal of the core (a size outside 1..1024, the 1 GB of
// pixel memory) throws, and the interface reports it as the command's failure.

/** The active document when its history can take a command now: not during a stroke. */
function editableDocument(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    return document && !document.history.transaction ? document : null;
}

/** The document `id` when it is still open and its history can take a command. */
function editableById(id: string): OpenDocument | null {
    const document = sessionsStore.getState().documents.find((entry) => entry.id === id);
    return document && !document.history.transaction ? document : null;
}

function execute(document: OpenDocument, make: (session: DocSession) => Command | null): void {
    const command = make(document.session);
    if (command) document.history.execute(command);
}

/** Runs an operation without a dialog on the active document. */
function runOnActive(make: (session: DocSession) => Command | null): void {
    applyFloating();
    const document = editableDocument();
    if (document) execute(document, make);
}

/** Canvas Size: asks for the size and the anchor, the old canvas centred to begin with. */
async function canvasSize(): Promise<void> {
    applyFloating();
    const opened = editableDocument();
    if (!opened) return;
    const { width, height } = opened.session.doc;
    const values = await spriteDialogs.canvasSize({
        initial: { width, height, anchor: { x: 0.5, y: 0.5 } },
    });
    const document = values && editableById(opened.id);
    if (document) execute(document, (session) => canvasSizeCommand(session, values));
}

/** Sprite Size: asks for the size and the resampling, nearest neighbour to begin with. */
async function spriteSize(): Promise<void> {
    applyFloating();
    const opened = editableDocument();
    if (!opened) return;
    const { width, height } = opened.session.doc;
    const values = await spriteDialogs.spriteSize({
        initial: { width, height, method: "nearest" },
    });
    const document = values && editableById(opened.id);
    if (document) execute(document, (session) => spriteSizeCommand(session, values));
}

/** Enabled while a selection floats too: each applies it first (SE-032 review). */
const hasDocument = () => settleableDocument() !== null;

export const commands: CommandSpec[] = [
    {
        id: "sprite.canvasSize",
        title: "Canvas Size…",
        enabled: hasDocument,
        run: canvasSize,
    },
    {
        id: "sprite.spriteSize",
        title: "Sprite Size…",
        enabled: hasDocument,
        run: spriteSize,
    },
    {
        id: "sprite.crop",
        title: "Crop to Selection",
        enabled: () => (settleableDocument()?.session.selection ?? null) !== null,
        run: () => runOnActive((session) => cropToSelectionCommand(session)),
    },
    {
        id: "sprite.trim",
        title: "Trim",
        enabled: hasDocument,
        run: () => runOnActive((session) => trimCommand(session)),
    },
    {
        id: "sprite.rotate90",
        title: "Rotate Canvas 90°",
        enabled: hasDocument,
        run: () => runOnActive((session) => rotateCanvasCommand(session, 90)),
    },
    {
        id: "sprite.rotate180",
        title: "Rotate Canvas 180°",
        enabled: hasDocument,
        run: () => runOnActive((session) => rotateCanvasCommand(session, 180)),
    },
    {
        id: "sprite.flipHorizontal",
        title: "Flip Canvas Horizontal",
        enabled: hasDocument,
        run: () => runOnActive((session) => flipCanvasCommand(session, "horizontal")),
    },
    {
        id: "sprite.flipVertical",
        title: "Flip Canvas Vertical",
        enabled: hasDocument,
        run: () => runOnActive((session) => flipCanvasCommand(session, "vertical")),
    },
];
