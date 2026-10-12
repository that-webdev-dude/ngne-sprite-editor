import { describe, expect, it } from "vitest";
import { DAWNBRINGER_32, defaultPalette } from "../../src/core/model";
import { PRESET_PALETTES, paletteFromPreset, presetPalette } from "../../src/core/palettes";

// The documented size of every preset, with its first and last published colour.
const DOCUMENTED: [id: string, name: string, count: number, first: number, last: number][] = [
    ["dawnbringer-16", "DawnBringer 16", 16, 0x140c1cff, 0xdeeed6ff],
    ["dawnbringer-32", "DawnBringer 32", 32, 0x000000ff, 0x8a6f30ff],
    ["pico-8", "PICO-8", 16, 0x000000ff, 0xffccaaff],
    ["sweetie-16", "Sweetie 16", 16, 0x1a1c2cff, 0x333c57ff],
    ["endesga-32", "Endesga 32", 32, 0xbe4a2fff, 0xc28569ff],
    ["aap-64", "AAP-64", 64, 0x060608ff, 0x423934ff],
    ["game-boy", "Game Boy (BGB)", 4, 0x081820ff, 0xe0f8d0ff],
    ["1-bit", "1-bit", 2, 0x000000ff, 0xffffffff],
];

// Every colour as the Lospec palette list publishes it: the palette's .hex file
// (https://lospec.com/palette-list/<slug>.hex, one RRGGBB value per line), fetched on
// 2026-10-12 and written here eight to a row, in the letter case of the file. The rows come
// from those files, not from `src/core/palettes`.
const PUBLISHED: Record<string, string[]> = {
    "dawnbringer-16": [
        "140c1c 442434 30346d 4e4a4e 854c30 346524 d04648 757161",
        "597dce d27d2c 8595a1 6daa2c d2aa99 6dc2ca dad45e deeed6",
    ],
    "dawnbringer-32": [
        "000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a",
        "fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74",
        "306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87",
        "696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30",
    ],
    "pico-8": [
        "000000 1D2B53 7E2553 008751 AB5236 5F574F C2C3C7 FFF1E8",
        "FF004D FFA300 FFEC27 00E436 29ADFF 83769C FF77A8 FFCCAA",
    ],
    "sweetie-16": [
        "1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179",
        "29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57",
    ],
    "endesga-32": [
        "be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633",
        "e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e",
        "124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466",
        "262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569",
    ],
    "aap-64": [
        "060608 141013 3b1725 73172d b4202a df3e23 fa6a0a f9a31b",
        "ffd541 fffc40 d6f264 9cdb43 59c135 14a02e 1a7a3e 24523b",
        "122020 143464 285cc4 249fde 20d6c7 a6fcdb ffffff fef3c0",
        "fad6b8 f5a097 e86a73 bc4a9b 793a80 403353 242234 221c1a",
        "322b28 71413b bb7547 dba463 f4d29c dae0ea b3b9d1 8b93af",
        "6d758d 4a5462 333941 422433 5b3138 8e5252 ba756a e9b5a3",
        "e3e6ff b9bffb 849be4 588dbe 477d85 23674e 328464 5daf8d",
        "92dcba cdf7e2 e4d2aa c7b08b a08662 796755 5a4e44 423934",
    ],
    "game-boy": ["081820 346856 88c070 e0f8d0"],
    "1-bit": ["000000 ffffff"],
};

describe("preset palettes", () => {
    it("are the eight palettes of the ticket, in order", () => {
        expect(PRESET_PALETTES.map((preset) => [preset.id, preset.name])).toEqual(
            DOCUMENTED.map(([id, name]) => [id, name]),
        );
    });

    it("hold every published colour, in the published order", () => {
        expect(Object.keys(PUBLISHED)).toEqual(PRESET_PALETTES.map((preset) => preset.id));
        for (const preset of PRESET_PALETTES) {
            const published = PUBLISHED[preset.id].join(" ").toLowerCase().split(" ");
            const actual = preset.colors.map((color) =>
                (color >>> 8).toString(16).padStart(6, "0"),
            );
            expect(actual, preset.id).toEqual(published);
        }
    });

    it("have the documented number of colours", () => {
        for (const [id, , count, first, last] of DOCUMENTED) {
            const colors = presetPalette(id)?.colors ?? [];
            expect(colors, id).toHaveLength(count);
            expect([colors[0], colors[colors.length - 1]], id).toEqual([first, last]);
        }
    });

    it("have no duplicate colour", () => {
        for (const preset of PRESET_PALETTES) {
            expect(new Set(preset.colors).size, preset.id).toBe(preset.colors.length);
        }
    });

    it("hold opaque 0xRRGGBBAA colours", () => {
        for (const preset of PRESET_PALETTES) {
            for (const color of preset.colors) {
                expect(Number.isInteger(color) && color >= 0 && color <= 0xffffffff).toBe(true);
                expect(color & 0xff, `${preset.id} ${color.toString(16)}`).toBe(0xff);
            }
        }
    });

    it("carry a name, an author and the place they are published at", () => {
        for (const preset of PRESET_PALETTES) {
            expect(preset.name.trim(), preset.id).not.toBe("");
            expect(preset.author.trim(), preset.id).not.toBe("");
            expect(preset.source, preset.id).toMatch(
                /^https:\/\/lospec\.com\/palette-list\/[a-z0-9-]+$/,
            );
        }
        expect(new Set(PRESET_PALETTES.map((preset) => preset.id)).size).toBe(8);
        expect(new Set(PRESET_PALETTES.map((preset) => preset.source)).size).toBe(8);
    });

    it("name the Game Boy variant", () => {
        const gameBoy = presetPalette("game-boy");
        expect(gameBoy?.name).toContain("BGB");
        expect(gameBoy?.author).toContain("bgb");
        // Darkest first.
        expect(gameBoy?.colors).toEqual([0x081820ff, 0x346856ff, 0x88c070ff, 0xe0f8d0ff]);
    });

    it("share DawnBringer 32 with the document default", () => {
        const preset = presetPalette("dawnbringer-32");
        expect(preset?.colors).toEqual(DAWNBRINGER_32);
        expect(preset && paletteFromPreset(preset)).toEqual(defaultPalette());
    });
});

describe("presetPalette", () => {
    it("finds a preset by its ID and nothing for another string", () => {
        expect(presetPalette("pico-8")?.name).toBe("PICO-8");
        expect(presetPalette("PICO-8")).toBeUndefined();
        expect(presetPalette("")).toBeUndefined();
    });
});

describe("paletteFromPreset", () => {
    it("returns a document palette with a copy of the colours", () => {
        const preset = PRESET_PALETTES[3];
        const palette = paletteFromPreset(preset);
        expect(palette).toEqual({ name: "Sweetie 16", colors: [...preset.colors] });
        palette.colors.length = 0;
        expect(preset.colors).toHaveLength(16);
        expect(paletteFromPreset(preset).colors).toHaveLength(16);
    });
});
