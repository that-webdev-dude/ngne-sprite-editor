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
import type { PresetPalette } from "../../core/palettes";
import type { CommandSpec } from "../commands/types";
import { activeComposites } from "../state/composites";
import { createEditorStore, editorStore } from "../state/editor";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { currentSwatch, paletteStore, setCurrentSwatch } from "./paletteState";

// The commands of the palette panel (DESIGN §5.4, SE-060). Each changes the active document's
// palette in one undo step (`core/palettes`); one that would change nothing records nothing.
// Remove, Edit and Move act on the current swatch (`paletteState.ts`). The panel's overflow
// menu is the context menu `PALETTE_MENU` and its preset menu `PRESET_MENU`, both generated
// from the commands that list them, so a later ticket adds its items (import, export, sort,
// replace colour: SE-066) from its own module. While a transaction is open (a stroke) the
// history takes no command, so the commands are disabled then, as undo and redo are.

export const ADD_COLOUR = "palette.addColour";
export const REMOVE_COLOUR = "palette.removeColour";
export const EDIT_COLOUR = "palette.editColour";
export const MOVE_COLOUR = "palette.moveColour";
export const PALETTE_FROM_SPRITE = "palette.fromSprite";

/** The overflow menu of the palette header (DESIGN §5.4). */
export const PALETTE_MENU = "palette";
/** The menu of the palette name in the header: the presets of `core/palettes`. */
export const PRESET_MENU = "palette-presets";

/** The command that loads a preset palette. */
export function presetCommandId(preset: Pick<PresetPalette, "id">): string {
    return `palette.preset.${preset.id}`;
}

/** The preset a preset command loads; undefined for any other command. */
export function presetOfCommand(commandId: string): PresetPalette | undefined {
    return PRESET_PALETTES.find((preset) => presetCommandId(preset) === commandId);
}

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

/**
 * Ends the swatch edit: the swatch takes the picker's colour in one undo step, or nothing is
 * recorded when the colour did not change. The interface calls it as the popover closes, and
 * before a press outside the popover does anything else, so a stroke that press begins comes
 * after the edit.
 */
export function finishSwatchEdit(): void {
    const { edit } = paletteStore.getState();
    if (!edit) return;
    paletteStore.setState({ edit: null });
    const document = sessionsStore
        .getState()
        .documents.find((entry) => entry.id === edit.documentId);
    if (!document || document.history.transaction) return;
    const colour = edit.draft.getState().foreground;
    execute(document, editColourCommand(document.session, edit.index, colour));
}

/** The composite of every frame of the active document, one at a time (SPEC §5.3). */
function* frameComposites(document: OpenDocument): Generator<PixelBuffer> {
    const { doc } = document.session;
    for (const frame of doc.frames) {
        yield activeComposites.cacheOf(document.session)?.get(frame.id) ??
            compositeFrame(doc, frame.id);
    }
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
