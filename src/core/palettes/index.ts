export {
    MAX_PALETTE_COLORS,
    SPRITE_PALETTE_COLORS,
    addColourCommand,
    editColourCommand,
    loadPresetCommand,
    moveColourCommand,
    movedColours,
    paletteFromSprite,
    paletteFromSpriteCommand,
    removeColourCommand,
    setPaletteCommand,
} from "./commands";
export type { CompositeSource } from "./commands";
export { PRESET_PALETTES, paletteFromPreset, presetPalette } from "./presets";
export type { PresetPalette, PresetPaletteId } from "./presets";
