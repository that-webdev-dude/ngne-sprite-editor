import { PRESET_PALETTES } from "../../core/palettes";
import type { PresetPalette } from "../../core/palettes";

// The ids and menu names of the palette commands (`palette.commands.ts`, SE-060), for the
// interface and the tests. They live apart from the commands: that module subscribes the
// registry (`appCommands`) to the palette state, and the registry loads it, so nothing else
// imports it and the two are never loaded in the wrong order.

export const ADD_COLOUR = "palette.addColour";
export const REMOVE_COLOUR = "palette.removeColour";
export const EDIT_COLOUR = "palette.editColour";
export const APPLY_EDIT = "palette.applyEdit";
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
