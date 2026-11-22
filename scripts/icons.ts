import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encode } from "fast-png";

// SE-072: the app's icons and the colours of its web manifest, from the design tokens (the
// first `:root` rule of @ngne/editor-ui's styles.css, its dark set: the default theme). The
// icons are drawn here, pixel by pixel, so the same tokens always give the same files; the PNG
// files in public/icons are the output of this script, committed, and a unit test
// (tests/unit/se-072-pwa.test.ts) fails when they differ from it. After a change of the tokens
// or of the drawing, write them again with
//
//     node scripts/icons.ts
//
// (Node 24 runs the TypeScript directly; this file imports nothing relative for that reason.)

const ROOT = new URL("../", import.meta.url);
const TOKENS_FILE = new URL("node_modules/@ngne/editor-ui/dist/styles.css", ROOT);
export const ICONS_DIR = new URL("public/icons/", ROOT);

export type Rgb = readonly [number, number, number];

/** The value of a colour token in the default (dark) set of the tokens, as `#rrggbb`. */
export function tokenColour(name: string, css = readFileSync(TOKENS_FILE, "utf8")): string {
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const value = new RegExp(String.raw`${name}:\s*(#[0-9a-f]{6})\s*;`).exec(root)?.[1];
    if (!value) throw new Error(`icons: no colour token ${name} in tokens.css`);
    return value;
}

function rgb(hex: string): Rgb {
    const value = Number.parseInt(hex.slice(1), 16);
    return [value >> 16, (value >> 8) & 0xff, value & 0xff];
}

/** The colours of the manifest and the icons. */
export function pwaColours(css?: string) {
    return {
        /** The window's title bar: the menu bar's panel colour. */
        theme: tokenColour("--bg-panel", css),
        /** The splash behind the icon while the app starts: the workspace colour. */
        background: tokenColour("--bg-workspace", css),
        accent: tokenColour("--accent", css),
    };
}

/**
 * The mark: a pixel-art sprite of 7 × 7 cells, a creature with two 2 × 2 eyes and two legs. It
 * pairs with the tilemap editor's 2 × 2 tile grid: the same grid, colour and weight, and its eye
 * row is the tile grid's lower row.
 */
export const MARK = [".XXXXX.", "XXXXXXX", "X..X..X", "X..X..X", "XXXXXXX", "XXXXXXX", "XX...XX"];

export interface IconSpec {
    /** File name in public/icons. */
    file: string;
    size: number;
    purpose: "any" | "maskable";
}

export const ICONS: readonly IconSpec[] = [
    { file: "icon-192.png", size: 192, purpose: "any" },
    { file: "icon-512.png", size: 512, purpose: "any" },
    { file: "maskable-192.png", size: 192, purpose: "maskable" },
    { file: "maskable-512.png", size: 512, purpose: "maskable" },
];

/**
 * The RGBA pixels of one icon. "any": a square of the panel colour with rounded corners
 * (transparent outside them) and the mark in the accent colour over 60 % of its width.
 * "maskable": the workspace colour to every edge and the mark over 50 % of the width, inside
 * the safe zone (the centred circle of 40 % radius that every mask keeps).
 */
export function drawIcon(spec: IconSpec, css?: string): Uint8Array {
    const colours = pwaColours(css);
    const { size, purpose } = spec;
    const data = new Uint8Array(size * size * 4);
    const back = rgb(purpose === "any" ? colours.theme : colours.background);
    fillRoundedSquare(data, size, purpose === "any" ? Math.round(size * 0.18) : 0, back);
    const cell = Math.floor((size * (purpose === "any" ? 0.6 : 0.5)) / MARK.length);
    drawMark(data, size, cell, rgb(colours.accent));
    return data;
}

/** Fills the square of `size` with `colour`, leaving transparent the corners outside `radius`. */
function fillRoundedSquare(data: Uint8Array, size: number, radius: number, colour: Rgb): void {
    const inside = (x: number, y: number) => {
        // Distance of the pixel's centre from the nearest corner circle's centre.
        const cx = Math.min(Math.max(x + 0.5, radius), size - radius);
        const cy = Math.min(Math.max(y + 0.5, radius), size - radius);
        return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius ** 2;
    };
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (inside(x, y)) data.set([...colour, 255], (y * size + x) * 4);
        }
    }
}

/** Draws the mark centred in the square of `size`, each of its cells `cell` pixels wide. */
function drawMark(data: Uint8Array, size: number, cell: number, colour: Rgb): void {
    const origin = Math.floor((size - cell * MARK.length) / 2);
    for (const [row, line] of MARK.entries()) {
        for (const [column, char] of [...line].entries()) {
            if (char === "X") {
                fillBlock(data, size, origin + column * cell, origin + row * cell, cell, colour);
            }
        }
    }
}

/** Fills the `side` × `side` block whose top-left pixel is (`left`, `top`) with `colour`. */
function fillBlock(
    data: Uint8Array,
    size: number,
    left: number,
    top: number,
    side: number,
    colour: Rgb,
): void {
    for (let y = 0; y < side; y++) {
        const at = ((top + y) * size + left) * 4;
        for (let x = 0; x < side; x++) data.set([...colour, 255], at + x * 4);
    }
}

/** The PNG file of one icon. */
export function iconPng(spec: IconSpec, css?: string): Uint8Array {
    return encode({
        width: spec.size,
        height: spec.size,
        data: drawIcon(spec, css),
        channels: 4,
        depth: 8,
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    for (const spec of ICONS) {
        writeFileSync(new URL(spec.file, ICONS_DIR), iconPng(spec));
        console.log(`public/icons/${spec.file}`);
    }
}
