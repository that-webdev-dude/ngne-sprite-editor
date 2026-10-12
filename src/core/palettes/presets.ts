import { DAWNBRINGER_32, DEFAULT_PALETTE_NAME } from "../model";
import type { Palette } from "../model";

// Preset palettes as data (SPEC §2.3 Colour, §8 step 7). Every list holds the published values
// in the published order, checked on 2026-10-12 against the Lospec palette list
// (https://lospec.com/palette-list), whose address for each palette is its `source`.

export type PresetPaletteId =
    | "dawnbringer-16"
    | "dawnbringer-32"
    | "pico-8"
    | "sweetie-16"
    | "endesga-32"
    | "aap-64"
    | "game-boy"
    | "1-bit";

export interface PresetPalette {
    /** Stable key, for settings and menus. */
    id: PresetPaletteId;
    name: string;
    /** Who made the palette. */
    author: string;
    /** Where its colour values are published. */
    source: string;
    /** Opaque 0xRRGGBBAA, in the published order. */
    colors: readonly number[];
}

/** 0xRRGGBB values as opaque 0xRRGGBBAA. */
function opaque(rgb: number[]): readonly number[] {
    return rgb.map((color) => ((color << 8) | 0xff) >>> 0);
}

/** The preset palettes, in menu order. */
export const PRESET_PALETTES: readonly PresetPalette[] = [
    {
        id: "dawnbringer-16",
        name: "DawnBringer 16",
        author: "DawnBringer",
        source: "https://lospec.com/palette-list/dawnbringer-16",
        colors: opaque([
            0x140c1c, 0x442434, 0x30346d, 0x4e4a4e, 0x854c30, 0x346524, 0xd04648, 0x757161,
            0x597dce, 0xd27d2c, 0x8595a1, 0x6daa2c, 0xd2aa99, 0x6dc2ca, 0xdad45e, 0xdeeed6,
        ]),
    },
    {
        id: "dawnbringer-32",
        name: DEFAULT_PALETTE_NAME,
        author: "DawnBringer",
        source: "https://lospec.com/palette-list/dawnbringer-32",
        // The document default (`core/model`), so the values exist once.
        colors: DAWNBRINGER_32,
    },
    {
        id: "pico-8",
        name: "PICO-8",
        author: "Lexaloffle Games (the PICO-8 fantasy console)",
        source: "https://lospec.com/palette-list/pico-8",
        colors: opaque([
            0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
            0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
        ]),
    },
    {
        id: "sweetie-16",
        name: "Sweetie 16",
        author: "GrafxKid",
        source: "https://lospec.com/palette-list/sweetie-16",
        colors: opaque([
            0x1a1c2c, 0x5d275d, 0xb13e53, 0xef7d57, 0xffcd75, 0xa7f070, 0x38b764, 0x257179,
            0x29366f, 0x3b5dc9, 0x41a6f6, 0x73eff7, 0xf4f4f4, 0x94b0c2, 0x566c86, 0x333c57,
        ]),
    },
    {
        id: "endesga-32",
        name: "Endesga 32",
        author: "ENDESGA (created for NYKRA)",
        source: "https://lospec.com/palette-list/endesga-32",
        colors: opaque([
            0xbe4a2f, 0xd77643, 0xead4aa, 0xe4a672, 0xb86f50, 0x733e39, 0x3e2731, 0xa22633,
            0xe43b44, 0xf77622, 0xfeae34, 0xfee761, 0x63c74d, 0x3e8948, 0x265c42, 0x193c3e,
            0x124e89, 0x0099db, 0x2ce8f5, 0xffffff, 0xc0cbdc, 0x8b9bb4, 0x5a6988, 0x3a4466,
            0x262b44, 0x181425, 0xff0044, 0x68386c, 0xb55088, 0xf6757a, 0xe8b796, 0xc28569,
        ]),
    },
    {
        id: "aap-64",
        name: "AAP-64",
        author: "Adigun A. Polack",
        source: "https://lospec.com/palette-list/aap-64",
        colors: opaque([
            0x060608, 0x141013, 0x3b1725, 0x73172d, 0xb4202a, 0xdf3e23, 0xfa6a0a, 0xf9a31b,
            0xffd541, 0xfffc40, 0xd6f264, 0x9cdb43, 0x59c135, 0x14a02e, 0x1a7a3e, 0x24523b,
            0x122020, 0x143464, 0x285cc4, 0x249fde, 0x20d6c7, 0xa6fcdb, 0xffffff, 0xfef3c0,
            0xfad6b8, 0xf5a097, 0xe86a73, 0xbc4a9b, 0x793a80, 0x403353, 0x242234, 0x221c1a,
            0x322b28, 0x71413b, 0xbb7547, 0xdba463, 0xf4d29c, 0xdae0ea, 0xb3b9d1, 0x8b93af,
            0x6d758d, 0x4a5462, 0x333941, 0x422433, 0x5b3138, 0x8e5252, 0xba756a, 0xe9b5a3,
            0xe3e6ff, 0xb9bffb, 0x849be4, 0x588dbe, 0x477d85, 0x23674e, 0x328464, 0x5daf8d,
            0x92dcba, 0xcdf7e2, 0xe4d2aa, 0xc7b08b, 0xa08662, 0x796755, 0x5a4e44, 0x423934,
        ]),
    },
    {
        // The Game Boy (DMG) has four shades and no fixed RGB values. This is the variant
        // Lospec lists as "Nintendo Gameboy (BGB)", darkest first.
        id: "game-boy",
        name: "Game Boy (BGB)",
        author: "Nintendo Game Boy (DMG) shades; default palette of the bgb emulator",
        source: "https://lospec.com/palette-list/nintendo-gameboy-bgb",
        colors: opaque([0x081820, 0x346856, 0x88c070, 0xe0f8d0]),
    },
    {
        id: "1-bit",
        name: "1-bit",
        author: "Traditional: black and white",
        source: "https://lospec.com/palette-list/1bit-black-and-white",
        colors: opaque([0x000000, 0xffffff]),
    },
];

/** The preset with the given ID, or `undefined` when there is none. */
export function presetPalette(id: string): PresetPalette | undefined {
    return PRESET_PALETTES.find((preset) => preset.id === id);
}

/** A document palette holding a preset's name and its own copy of the colours. */
export function paletteFromPreset(preset: PresetPalette): Palette {
    return { name: preset.name, colors: [...preset.colors] };
}
