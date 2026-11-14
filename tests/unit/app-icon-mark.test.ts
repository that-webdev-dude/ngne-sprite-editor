import { describe, expect, it } from "vitest";
import { ICONS, MARK, drawIcon, pwaColours } from "../../scripts/icons";

const hex = (data: Uint8Array, at: number) =>
    `#${[data[at], data[at + 1], data[at + 2]].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;

describe("app icon mark (scripts/icons.ts)", () => {
    it("is the sprite creature of 7 × 7 cells: two 2 × 2 eyes and two legs", () => {
        expect(MARK).toEqual([
            ".XXXXX.",
            "XXXXXXX",
            "X..X..X",
            "X..X..X",
            "XXXXXXX",
            "XXXXXXX",
            "XX...XX",
        ]);
    });

    it("draws each cell of the mark in the accent colour and leaves the others in the back colour", () => {
        const { accent, theme, background } = pwaColours();
        for (const spec of ICONS) {
            const data = drawIcon(spec);
            const { size, purpose } = spec;
            const cell = Math.floor((size * (purpose === "any" ? 0.6 : 0.5)) / 7);
            const origin = Math.floor((size - cell * 7) / 2);
            const back = purpose === "any" ? theme : background;
            for (const [row, line] of MARK.entries()) {
                for (const [column, char] of [...line].entries()) {
                    const x = origin + column * cell + Math.floor(cell / 2);
                    const y = origin + row * cell + Math.floor(cell / 2);
                    const at = (y * size + x) * 4;
                    expect(hex(data, at), `${spec.file} cell ${column},${row}`).toBe(
                        char === "X" ? accent : back,
                    );
                }
            }
        }
    });
});
