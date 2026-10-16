import { writeOklab } from "../color";
import type { Command } from "../history";
import { buildPalette } from "../import";
import { assertNameLength } from "../model";
import type { DocSession, Palette, PixelBuffer, Touched } from "../model";
import { MAX_PROJECT_PALETTE_COLORS } from "../project/format";
import type { PresetPalette } from "./presets";

// The palette of a document changes through these commands (SPEC §7.1 Palette, §5.2; SE-060):
// add, remove, move and edit one colour, load a preset, and the palette from the sprite. Each
// is one undo step that keeps the palette before and after; a palette is at most 256 colours,
// so that costs little. A change that would leave the palette as it is makes no command
// (null), so it records no history entry. No command changes pixels, layers or frames.

/** Most colours of a palette (SPEC §5.1; FORMAT §1.8). */
export const MAX_PALETTE_COLORS = MAX_PROJECT_PALETTE_COLORS;

/** Colours of the palette from the sprite before `buildPalette` reduces them (SE-060). */
export const SPRITE_PALETTE_COLORS = MAX_PALETTE_COLORS;

function nothingTouched(): Touched {
    return { frameIds: [], layerIds: [], structure: false };
}

function copyPalette(palette: Palette): Palette {
    return { name: palette.name, colors: [...palette.colors] };
}

function samePalette(a: Palette, b: Palette): boolean {
    return (
        a.name === b.name &&
        a.colors.length === b.colors.length &&
        a.colors.every((colour, index) => colour === b.colors[index])
    );
}

function isColour(colour: number): boolean {
    return Number.isInteger(colour) && colour >= 0 && colour <= 0xffffffff;
}

function isIndex(palette: Palette, index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < palette.colors.length;
}

/**
 * The command that makes `next` the session's palette, labelled `label`; null when `next` is
 * the palette now (same name, same colours in the same order). Throws `RangeError` for more
 * than `MAX_PALETTE_COLORS` colours or a colour that is not an integer 0..0xFFFFFFFF, and
 * `DocumentLimitError` for a name longer than `MAX_NAME_LENGTH` (FORMAT.md §1.2).
 */
export function setPaletteCommand(
    session: DocSession,
    next: Palette,
    label: string,
): Command | null {
    assertNameLength(next.name);
    if (next.colors.length > MAX_PALETTE_COLORS) {
        throw new RangeError(
            `setPaletteCommand: ${next.colors.length} colours; a palette holds at most ` +
                `${MAX_PALETTE_COLORS}.`,
        );
    }
    const wrong = next.colors.find((colour) => !isColour(colour));
    if (wrong !== undefined) {
        throw new RangeError(`setPaletteCommand: ${wrong} is not a colour 0xRRGGBBAA.`);
    }
    const before = copyPalette(session.doc.palette);
    const after = copyPalette(next);
    if (samePalette(before, after)) return null;
    return {
        label,
        // Eight bytes per colour and two per character, before and after.
        bytes:
            8 * (before.colors.length + after.colors.length) +
            2 * (before.name.length + after.name.length),
        touched: nothingTouched(),
        // A copy each time, so nothing that holds the session's palette can change what the
        // command puts back.
        do(target) {
            target.doc.palette = copyPalette(after);
        },
        undo(target) {
            target.doc.palette = copyPalette(before);
        },
    };
}

/**
 * Appends `colour` (0xRRGGBBAA) to the palette; null when the palette holds it already or
 * holds `MAX_PALETTE_COLORS` colours. Throws `RangeError` for a value that is not a colour.
 */
export function addColourCommand(
    session: DocSession,
    colour: number,
    label = "Add Colour",
): Command | null {
    if (!isColour(colour)) throw new RangeError(`addColourCommand: ${colour} is not a colour.`);
    const { palette } = session.doc;
    if (palette.colors.length >= MAX_PALETTE_COLORS || palette.colors.includes(colour)) {
        return null;
    }
    return setPaletteCommand(
        session,
        { name: palette.name, colors: [...palette.colors, colour] },
        label,
    );
}

/** Removes the colour at `index`; null when there is no colour there. */
export function removeColourCommand(
    session: DocSession,
    index: number,
    label = "Remove Colour",
): Command | null {
    const { palette } = session.doc;
    if (!isIndex(palette, index)) return null;
    const colors = palette.colors.filter((_, at) => at !== index);
    return setPaletteCommand(session, { name: palette.name, colors }, label);
}

/** The colours with the one at `from` taken out and put in at `to`; the rest keep their order. */
export function movedColours(colors: readonly number[], from: number, to: number): number[] {
    const moved = [...colors];
    const [colour] = moved.splice(from, 1);
    if (colour !== undefined) moved.splice(to, 0, colour);
    return moved;
}

/**
 * Moves the colour at `from` to `to`: after the step it is the colour at `to`, and the others
 * keep their order. Null when `from` equals `to`, when either is not an index of the palette,
 * or when the move leaves the colours as they are (two equal colours exchanged).
 */
export function moveColourCommand(
    session: DocSession,
    from: number,
    to: number,
    label = "Move Colour",
): Command | null {
    const { palette } = session.doc;
    if (from === to || !isIndex(palette, from) || !isIndex(palette, to)) return null;
    return setPaletteCommand(
        session,
        { name: palette.name, colors: movedColours(palette.colors, from, to) },
        label,
    );
}

/**
 * Makes the colour at `index` `colour` (0xRRGGBBAA); null when there is no colour there or it
 * is `colour` already. Throws `RangeError` for a value that is not a colour.
 */
export function editColourCommand(
    session: DocSession,
    index: number,
    colour: number,
    label = "Edit Colour",
): Command | null {
    if (!isColour(colour)) throw new RangeError(`editColourCommand: ${colour} is not a colour.`);
    const { palette } = session.doc;
    if (!isIndex(palette, index)) return null;
    const colors = palette.colors.map((existing, at) => (at === index ? colour : existing));
    return setPaletteCommand(session, { name: palette.name, colors }, label);
}

/**
 * Replaces the palette by a preset: its name and its colours in its order. Null when the
 * palette is that already.
 */
export function loadPresetCommand(
    session: DocSession,
    preset: Pick<PresetPalette, "name" | "colors">,
    label = `Load ${preset.name} Palette`,
): Command | null {
    return setPaletteCommand(session, { name: preset.name, colors: [...preset.colors] }, label);
}

/** The composites of a sprite's frames, as many times as asked: each call reads them anew. */
export type CompositeSource = () => Iterable<PixelBuffer>;

/** Colours dark to light by OKLab lightness; of equals, lower alpha first, then lower value. */
function darkToLight(colours: readonly number[]): number[] {
    const lab = new Float64Array(3);
    const entries = colours.map((colour) => {
        writeOklab(lab, 0, colour >>> 24, (colour >>> 16) & 0xff, (colour >>> 8) & 0xff);
        return { colour, lightness: lab[0] };
    });
    entries.sort(
        (a, b) =>
            a.lightness - b.lightness ||
            (a.colour & 0xff) - (b.colour & 0xff) ||
            a.colour - b.colour,
    );
    return entries.map((entry) => entry.colour);
}

/**
 * The distinct 0xRRGGBBAA colours of the pixels whose alpha is above 0, dark to light; null as
 * soon as there are more than `limit`. A pixel of alpha 0 holds no colour (the composite stores
 * it as 0,0,0,0, SPEC §5.3), so it does not count.
 */
function distinctColours(buffers: Iterable<PixelBuffer>, limit: number): number[] | null {
    const seen = new Set<number>();
    for (const { data } of buffers) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let previous = -1;
        for (let at = 0; at < data.length; at += 4) {
            if (data[at + 3] === 0) continue;
            const colour = view.getUint32(at);
            if (colour === previous) continue;
            previous = colour;
            seen.add(colour);
            if (seen.size > limit) return null;
        }
    }
    return darkToLight([...seen]);
}

/**
 * The palette of a sprite from the composites of its frames (SPEC §5.3: what the sprite shows,
 * hidden layers left out). When the pixels whose alpha is above 0 hold at most
 * `SPRITE_PALETTE_COLORS` distinct colours, the palette is exactly those colours, alpha kept,
 * dark to light (OKLab lightness; of equals, lower alpha first). Otherwise `buildPalette`
 * reduces them to that many opaque colours, dark to light, and the composites are read a
 * second time. Each reading takes one buffer at a time and stops counting as soon as there
 * are too many colours.
 */
export function paletteFromSprite(composites: CompositeSource): number[] {
    return (
        distinctColours(composites(), SPRITE_PALETTE_COLORS) ??
        buildPalette(composites(), SPRITE_PALETTE_COLORS)
    );
}

/**
 * Replaces the palette by `paletteFromSprite(composites)`, named `name` (the sprite's name
 * unless given). Null when the palette is that already. A sprite with no visible pixel gives
 * an empty palette.
 */
export function paletteFromSpriteCommand(
    session: DocSession,
    composites: CompositeSource,
    name = session.doc.name,
    label = "Palette from Sprite",
): Command | null {
    return setPaletteCommand(session, { name, colors: paletteFromSprite(composites) }, label);
}
