import { compositeFrame } from "../../core/composite";
import type { Command } from "../../core/history";
import type { PixelBuffer } from "../../core/model";
import {
    MAX_PALETTE_COLORS,
    PRESET_PALETTES,
    addColourCommand,
    editColourCommand,
    loadPresetCommand,
    moveColourCommand,
    paletteFromSpriteCommand,
    removeColourCommand,
} from "../../core/palettes";
import type { CompositeSource, PresetPalette } from "../../core/palettes";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { activeComposites } from "../state/composites";
import { createEditorStore, editorStore } from "../state/editor";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import {
    ADD_COLOUR,
    APPLY_EDIT,
    EDIT_COLOUR,
    MOVE_COLOUR,
    PALETTE_FROM_SPRITE,
    PALETTE_MENU,
    PRESET_MENU,
    REMOVE_COLOUR,
    presetCommandId,
} from "./paletteCommandIds";
import { currentSwatch, paletteStore, setCurrentSwatch } from "./paletteState";

// The commands of the palette panel (DESIGN §5.4, SE-060). Each changes the active document's
// palette in one undo step (`core/palettes`); one that would change nothing records nothing.
// Remove, Edit and Move act on the current swatch (`paletteState.ts`); Apply Colour Edit ends
// the swatch edit Edit Colour… opened. The panel's overflow menu is the context menu
// `PALETTE_MENU` and its preset menu `PRESET_MENU`, both generated from the commands that list
// them, so a later ticket adds its items (import, export, sort, replace colour: SE-066) from
// its own module. While a transaction is open (a stroke) the history takes no command, so the
// commands are disabled then, as undo and redo are.
//
// The registry loads this module (appCommands.ts); everything else takes the ids from
// `paletteCommandIds.ts`, so this module never loads before the registry.

// `enabled` reads the palette state too: an open menu follows its changes.
paletteStore.subscribe(() => appCommands.refresh());

/** The active document when its history can take a command now. */
function idleDocument(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    return document && !document.history.transaction ? document : null;
}

function execute(document: OpenDocument, command: Command | null): boolean {
    if (!command) return false;
    document.history.execute(command);
    return true;
}

/** The current swatch of the active document's palette, when a command may change it. */
function currentOfIdle(): { document: OpenDocument; index: number } | null {
    const document = idleDocument();
    if (!document) return null;
    const index = currentSwatch(document.session.doc.palette.colors.length);
    return index < 0 ? null : { document, index };
}

/** Add Current Colour: the foreground, at the end, unless the palette has it or is full. */
function canAdd(): boolean {
    const colors = idleDocument()?.session.doc.palette.colors;
    if (!colors) return false;
    return (
        colors.length < MAX_PALETTE_COLORS && !colors.includes(editorStore.getState().foreground)
    );
}

function addColour(): void {
    const document = idleDocument();
    if (!document) return;
    const added = addColourCommand(
        document.session,
        editorStore.getState().foreground,
        "Add Current Colour",
    );
    if (execute(document, added)) {
        setCurrentSwatch(document.session.doc.palette.colors.length - 1);
    }
}

function removeColour(): void {
    const current = currentOfIdle();
    if (!current) return;
    execute(current.document, removeColourCommand(current.document.session, current.index));
}

/** Moves the current swatch to the target a drag or a Ctrl+arrow key set; it stays current. */
function moveTarget(): { document: OpenDocument; from: number; to: number } | null {
    const current = currentOfIdle();
    const { target } = paletteStore.getState();
    if (!current || target === null) return null;
    const count = current.document.session.doc.palette.colors.length;
    if (!Number.isInteger(target) || target < 0 || target >= count) return null;
    return target === current.index
        ? null
        : { document: current.document, from: current.index, to: target };
}

function moveColour(): void {
    const move = moveTarget();
    paletteStore.setState({ target: null });
    if (!move) return;
    execute(move.document, moveColourCommand(move.document.session, move.from, move.to));
    setCurrentSwatch(move.to);
}

/**
 * Edit Colour…: opens the picker popover on the current swatch. The palette changes once,
 * when the popover closes (`finishSwatchEdit`).
 */
function editColour(): void {
    const current = currentOfIdle();
    if (!current || paletteStore.getState().edit) return;
    const { document, index } = current;
    const colour = document.session.doc.palette.colors[index] ?? 0;
    const draft = createEditorStore();
    draft.getState().setColour("foreground", colour);
    setCurrentSwatch(index);
    paletteStore.setState({ edit: { documentId: document.id, index, colour, draft } });
}

/** The document of the open swatch edit, when its history can take the edit now. */
function editedDocument(): OpenDocument | null {
    const { edit } = paletteStore.getState();
    if (!edit) return null;
    const document = sessionsStore
        .getState()
        .documents.find((entry) => entry.id === edit.documentId);
    return document && !document.history.transaction ? document : null;
}

/**
 * Apply Colour Edit, the run of `APPLY_EDIT`: ends the swatch edit, and the swatch takes the
 * picker's colour in one undo step of its own document (active or not), or nothing is
 * recorded when the colour did not change. The interface runs the command as the popover
 * closes, before a press outside the popover does anything else (so a stroke that press
 * begins comes after the edit), and when the edit's document stops being the active one.
 */
export function finishSwatchEdit(): void {
    const { edit } = paletteStore.getState();
    const document = editedDocument();
    if (!edit) return;
    paletteStore.setState({ edit: null });
    if (!document) return;
    const colour = edit.draft.getState().foreground;
    execute(document, editColourCommand(document.session, edit.index, colour));
}

/**
 * The composite of every frame of the active document, one at a time, read anew at each call
 * (SPEC §5.3). A frame the composite cache holds is read from it; any other is composited
 * without being put there, so reading the whole sprite does not push out the composites the
 * viewport and the preview use.
 */
function frameComposites(document: OpenDocument): CompositeSource {
    return function* (): Generator<PixelBuffer> {
        const { doc } = document.session;
        const cache = activeComposites.cacheOf(document.session);
        for (const frame of doc.frames) {
            yield cache?.has(frame.id) ? cache.get(frame.id) : compositeFrame(doc, frame.id);
        }
    };
}

function paletteFromSprite(): void {
    const document = idleDocument();
    if (!document) return;
    execute(document, paletteFromSpriteCommand(document.session, frameComposites(document)));
}

function loadPreset(preset: PresetPalette): void {
    const document = idleDocument();
    if (document) execute(document, loadPresetCommand(document.session, preset));
}

const hasIdleDocument = () => idleDocument() !== null;
const hasCurrent = () => currentOfIdle() !== null;

export const commands: CommandSpec[] = [
    {
        id: ADD_COLOUR,
        title: "Add Current Colour",
        enabled: canAdd,
        run: addColour,
    },
    {
        id: REMOVE_COLOUR,
        title: "Remove Colour",
        enabled: hasCurrent,
        run: removeColour,
        contextMenus: [{ menu: PALETTE_MENU, order: 100 }],
    },
    {
        id: EDIT_COLOUR,
        title: "Edit Colour…",
        enabled: () => hasCurrent() && paletteStore.getState().edit === null,
        run: editColour,
        contextMenus: [{ menu: PALETTE_MENU, order: 110 }],
    },
    {
        id: APPLY_EDIT,
        title: "Apply Colour Edit",
        enabled: () => editedDocument() !== null,
        run: finishSwatchEdit,
    },
    {
        id: MOVE_COLOUR,
        title: "Move Colour",
        enabled: () => moveTarget() !== null,
        run: moveColour,
    },
    // DESIGN §5.4 orders the overflow menu remove, edit, import, export, from sprite, sort,
    // replace colour: the 200s are left to import and export, the 400s to sort and replace.
    {
        id: PALETTE_FROM_SPRITE,
        title: "Palette from Sprite",
        enabled: hasIdleDocument,
        run: paletteFromSprite,
        contextMenus: [{ menu: PALETTE_MENU, order: 300 }],
    },
    ...PRESET_PALETTES.map((preset, index): CommandSpec => ({
        id: presetCommandId(preset),
        title: `Load ${preset.name} Palette`,
        enabled: hasIdleDocument,
        run: () => loadPreset(preset),
        contextMenus: [{ menu: PRESET_MENU, order: 100 + 10 * index }],
    })),
];
