import { compositeCommand } from "../../core/history";
import type { Command } from "../../core/history";
import { createDocument } from "../../core/model";
import {
    normalizeSpriteName,
    renameSpriteCommand,
    setGrid,
    setPivotCommand,
} from "../../core/sprite";
import type { CommandSpec } from "../commands/types";
import { fileWorkflows } from "../file/workflows";
import { preferences } from "../preferences/preferences";
import { applyFloating } from "../selection/floating";
import { settleableDocument } from "../selection/settled";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { spriteDialogs } from "./dialogs";
import type { NewSpriteValues, SpritePropertiesValues } from "./dialogs";

/** What the New sprite dialog opens with. */
export const NEW_SPRITE_DEFAULTS: Readonly<NewSpriteValues> = {
    name: "Sprite",
    width: 32,
    height: 32,
};

/**
 * New Sprite (SE-008): asks for name and size, then opens the new document in a tab of its
 * own, the active one (SE-047). The open documents stay as they are, so the dialog has nothing
 * to discard. The grid of a new document is the default grid of the preference store.
 */
async function newSprite(): Promise<void> {
    // The active document stops being the active one: its floating selection is applied
    // first (SE-032).
    applyFloating();
    const values = await spriteDialogs.newSprite({
        initial: { ...NEW_SPRITE_DEFAULTS },
        discards: null,
    });
    if (!values) return;
    const { width, height } = preferences.get("grid");
    const session = createDocument({
        name: normalizeSpriteName(values.name),
        width: values.width,
        height: values.height,
        grid: { width, height },
    });
    sessionsStore.getState().open(session);
}

/** The active document while a command may change it: not while a transaction is open. */
function editableDocument(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    return document && !document.history.transaction ? document : null;
}

/**
 * Applies the answer of the Sprite properties dialog. Name and pivot are one undo step, made
 * only when one of them changed; the grid is a `DocSettings` setter: no history entry and the
 * document does not become dirty (SPEC §5.2).
 */
function applySpriteProperties(id: string, values: SpritePropertiesValues): void {
    const document = sessionsStore.getState().documents.find((entry) => entry.id === id);
    if (!document) return;
    const { doc } = document.session;

    // Each of these throws for a value it does not accept, before anything has changed.
    const edits: Command[] = [];
    if (normalizeSpriteName(values.name) !== doc.name) edits.push(renameSpriteCommand(values.name));
    if (values.pivot.x !== doc.pivot.x || values.pivot.y !== doc.pivot.y) {
        edits.push(setPivotCommand(values.pivot));
    }
    const { grid } = doc.settings;
    const gridChanged =
        values.grid.width !== grid.width ||
        values.grid.height !== grid.height ||
        values.grid.offsetX !== grid.offsetX ||
        values.grid.offsetY !== grid.offsetY;
    if (gridChanged) {
        sessionsStore
            .getState()
            .updateDocSettings(id, (settings) => setGrid(settings, values.grid));
    }

    const [first] = edits;
    if (!first) return;
    document.history.execute(
        edits.length === 1 ? first : compositeCommand("Sprite Properties", edits),
    );
}

/** Sprite Properties (SPEC §7.7): name, pivot and grid of the active document in one dialog. */
async function spriteProperties(): Promise<void> {
    applyFloating();
    const document = editableDocument();
    if (!document) return;
    const { doc } = document.session;
    const { width, height, offsetX, offsetY } = doc.settings.grid;
    const values = await spriteDialogs.spriteProperties({
        initial: {
            name: doc.name,
            pivot: { ...doc.pivot },
            grid: { width, height, offsetX, offsetY },
        },
    });
    if (values) applySpriteProperties(document.id, values);
}

// SPEC §7.8: Ctrl+Alt+N †, also while a text field has focus. Both commands take the menu items
// planned for their ids (commands/planned.commands.ts).
export const commands: CommandSpec[] = [
    {
        id: "file.new",
        title: "New Sprite…",
        shortcut: "Ctrl+Alt+N",
        context: ["global", "text"],
        // It changes the active document: not while a file operation (SE-041) runs.
        enabled: () => !fileWorkflows.busy,
        run: newSprite,
    },
    {
        id: "sprite.properties",
        title: "Properties…",
        // While a selection floats too: it is applied first (SE-032 review).
        enabled: () => settleableDocument() !== null,
        run: spriteProperties,
    },
];
