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

describe("preset palettes", () => {
    it("are the eight palettes of the ticket, in order", () => {
        expect(PRESET_PALETTES.map((preset) => [preset.id, preset.name])).toEqual(
            DOCUMENTED.map(([id, name]) => [id, name]),
        );
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
