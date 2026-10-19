import { MAX_NAME_LENGTH } from "../model";
import type { Palette } from "../model";
import { decodePng } from "../png";
import { MAX_PALETTE_COLORS } from "./commands";

// Palette files (SPEC §7.1, Palette files; SE-066): GIMP `.gpl`, `.hex` (one colour per line)
// and JASC `.pal`, read and written, and a PNG read for its distinct colours. Every reader
// takes the file's bytes and returns its colours as 0xRRGGBBAA, at most 256, or throws a
// `PaletteFileError` naming what is wrong, so a malformed file changes nothing. The writers
// return the bytes of a file that their reader takes back to the same colours.
//
// Alpha: the three text formats hold RGB. A palette with a colour that is not opaque is
// written with a fourth value per colour (`.gpl` with the `Channels: RGBA` header Aseprite
// writes, `.hex` with eight digits, `.pal` with four numbers on the line), and read back so;
// a palette of opaque colours is written in the plain form other programs read.

/** The palette file formats. */
export type PaletteFormat = "gpl" | "hex" | "pal" | "png";

/** The formats a palette is written to. */
export type PaletteTextFormat = Exclude<PaletteFormat, "png">;

/** What a format is called and the file ending that names it (with its dot). */
export interface PaletteFormatInfo {
    readonly format: PaletteFormat;
    readonly extension: string;
    readonly description: string;
    readonly mime: string;
}

export const PALETTE_FORMATS: Readonly<Record<PaletteFormat, PaletteFormatInfo>> = {
    gpl: { format: "gpl", extension: ".gpl", description: "GIMP palette", mime: "text/plain" },
    hex: { format: "hex", extension: ".hex", description: "Hex palette", mime: "text/plain" },
    pal: { format: "pal", extension: ".pal", description: "JASC palette", mime: "text/plain" },
    png: { format: "png", extension: ".png", description: "PNG image", mime: "image/png" },
};

/** The largest palette file read: far more than any palette needs, less than a large PNG. */
export const MAX_PALETTE_FILE_BYTES = 64 * 1024 * 1024;

/** What a file larger than `MAX_PALETTE_FILE_BYTES` is told. */
export const PALETTE_FILE_TOO_LARGE = `The file is larger than ${MAX_PALETTE_FILE_BYTES / (1024 * 1024)} MiB.`;

/** A palette file as read: its colours, and the name it gives, if any (`.gpl` only). */
export interface PaletteFile {
    name: string | null;
    colors: number[];
}

/** Why a palette file cannot be read. `line` is 1-based, for the text formats. */
export class PaletteFileError extends Error {
    override readonly name = "PaletteFileError";
    readonly line: number | null;

    constructor(message: string, line: number | null = null, options?: ErrorOptions) {
        super(line === null ? message : `Line ${line}: ${message}`, options);
        this.line = line;
    }
}

/** The format a file name names by its ending, in either case; null for any other. */
export function paletteFormatOf(fileName: string): PaletteFormat | null {
    const lower = fileName.toLowerCase();
    for (const info of Object.values(PALETTE_FORMATS)) {
        if (lower.endsWith(info.extension)) return info.format;
    }
    return null;
}

/** The file name without its ending: the name a palette from a file without one takes. */
export function paletteNameOfFile(fileName: string): string {
    const base = fileName.replace(/^.*[\\/]/, "");
    const dot = base.lastIndexOf(".");
    const name = (dot > 0 ? base.slice(0, dot) : base).trim();
    return name.slice(0, MAX_NAME_LENGTH);
}

// --- Text ------------------------------------------------------------------------------------

const BYTE = /^\d{1,3}$/;

/** The lines of a text file: UTF-8 (a byte order mark dropped), any line ending. */
function linesOf(bytes: Uint8Array): string[] {
    // Not fatal: a name in another encoding is no reason to refuse the colours. The decoder
    // drops a byte order mark.
    const text = new TextDecoder("utf-8").decode(bytes);
    return text.split(/\r\n|\n|\r/);
}

function encodeText(lines: readonly string[], ending: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(lines.map((line) => line + ending).join(""));
}

/** An integer 0..255 written in decimal; throws for anything else. */
function channel(text: string, line: number): number {
    if (!BYTE.test(text) || Number(text) > 255) {
        throw new PaletteFileError(`“${text}” is not a colour value 0–255.`, line);
    }
    return Number(text);
}

function pack(r: number, g: number, b: number, a: number): number {
    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function channels(colour: number): [number, number, number, number] {
    return [colour >>> 24, (colour >>> 16) & 0xff, (colour >>> 8) & 0xff, colour & 0xff];
}

const isOpaque = (colour: number) => (colour & 0xff) === 0xff;

/** Throws unless the file holds 1 to 256 colours. */
function checkCount(count: number): void {
    if (count === 0) throw new PaletteFileError("The file holds no colours.");
    if (count > MAX_PALETTE_COLORS) {
        throw new PaletteFileError(
            `The file holds ${count} colours; a palette holds at most ${MAX_PALETTE_COLORS}.`,
        );
    }
}

/** Throws unless a palette to write holds 1 to 256 colours, each an integer 0..0xFFFFFFFF. */
function checkPalette(colors: readonly number[]): void {
    if (colors.length === 0 || colors.length > MAX_PALETTE_COLORS) {
        throw new RangeError(
            `A palette file holds 1 to ${MAX_PALETTE_COLORS} colours, not ${colors.length}.`,
        );
    }
    for (const colour of colors) {
        if (!Number.isInteger(colour) || colour < 0 || colour > 0xffffffff) {
            throw new RangeError(`${colour} is not a colour 0xRRGGBBAA.`);
        }
    }
}

// --- GIMP .gpl -------------------------------------------------------------------------------

const GPL_MAGIC = "GIMP Palette";

/**
 * A GIMP palette: the line "GIMP Palette", then headers (`Name:`, `Columns:`, Aseprite's
 * `Channels: RGB` or `RGBA`; any other `Key: value` line is skipped), comments (`#`) and blank
 * lines, then one colour per line: three decimal values 0–255 (four with `Channels: RGBA`),
 * separated by spaces or tabs, and an optional colour name (GIMP's name, Lospec's hex). Without
 * a `Name:` header, Lospec's comment `#Palette Name: …` names the palette.
 */
export function readGpl(bytes: Uint8Array): PaletteFile {
    const lines = linesOf(bytes);
    if ((lines[0] ?? "").trim() !== GPL_MAGIC) {
        throw new PaletteFileError(`A GIMP palette starts with “${GPL_MAGIC}”.`, 1);
    }
    let name: string | null = null;
    let commentName: string | null = null;
    let alpha = false;
    const colors: number[] = [];
    const nameOf = (value: string) => (value === "" ? null : value.slice(0, MAX_NAME_LENGTH));
    for (let index = 1; index < lines.length; index++) {
        const line = index + 1;
        const text = lines[index].trim();
        if (text === "") continue;
        if (text.startsWith("#")) {
            const lospec = /^#\s*Palette Name\s*:\s*(.*)$/i.exec(text);
            if (lospec && colors.length === 0) commentName = nameOf(lospec[1].trim());
            continue;
        }
        // Only before the first colour; a colour line starts with a digit.
        const header = /^([A-Za-z][\w -]*?)\s*:\s*(.*)$/.exec(text);
        if (header && colors.length === 0) {
            const key = header[1].toLowerCase();
            const value = header[2].trim();
            if (key === "name") name = nameOf(value);
            else if (key === "channels") {
                if (!/^rgba?$/i.test(value)) {
                    throw new PaletteFileError(`Channels “${value}” is not RGB or RGBA.`, line);
                }
                alpha = value.toUpperCase() === "RGBA";
            }
            // Columns only lays the palette out in GIMP; other keys are skipped, as Aseprite
            // skips the lines that are not colours.
            continue;
        }
        const parts = text.split(/\s+/);
        const count = alpha ? 4 : 3;
        if (parts.length < count) {
            throw new PaletteFileError(
                `A colour line holds ${count} values${alpha ? " (RGBA)" : ""}.`,
                line,
            );
        }
        const [r, g, b, a] = parts.slice(0, count).map((part) => channel(part, line));
        colors.push(pack(r, g, b, alpha ? a : 255));
        if (colors.length > MAX_PALETTE_COLORS) checkCount(colors.length);
    }
    checkCount(colors.length);
    return { name: name ?? commentName, colors };
}

/** A GIMP palette of `palette`, its name on the `Name:` line, each colour named by its hex. */
export function writeGpl(palette: Palette): Uint8Array<ArrayBuffer> {
    checkPalette(palette.colors);
    const alpha = !palette.colors.every(isOpaque);
    const name = palette.name.replace(/[\r\n]+/g, " ").trim();
    const lines = [GPL_MAGIC, `Name: ${name}`, "Columns: 16"];
    if (alpha) lines.push("Channels: RGBA");
    lines.push("#");
    for (const colour of palette.colors) {
        const [r, g, b, a] = channels(colour);
        const values = (alpha ? [r, g, b, a] : [r, g, b]).map((value) =>
            String(value).padStart(3, " "),
        );
        lines.push(`${values.join(" ")}\t#${hexText(colour, alpha).toUpperCase()}`);
    }
    return encodeText(lines, "\n");
}

// --- .hex ------------------------------------------------------------------------------------

const HEX_LINE = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i;

function hexText(colour: number, alpha: boolean): string {
    const digits = (colour >>> 0).toString(16).padStart(8, "0");
    return alpha ? digits : digits.slice(0, 6);
}

/**
 * A hex palette (as Lospec writes it): one colour per line, six hex digits RRGGBB, or eight
 * RRGGBBAA, with or without "#"; blank lines are skipped.
 */
export function readHex(bytes: Uint8Array): PaletteFile {
    const lines = linesOf(bytes);
    const colors: number[] = [];
    lines.forEach((raw, index) => {
        const text = raw.trim();
        if (text === "") return;
        const digits = HEX_LINE.exec(text)?.[1];
        if (digits === undefined) {
            throw new PaletteFileError(
                `“${text.slice(0, 40)}” is not a colour RRGGBB or RRGGBBAA.`,
                index + 1,
            );
        }
        colors.push(parseInt(digits.length === 6 ? `${digits}ff` : digits, 16) >>> 0);
        if (colors.length > MAX_PALETTE_COLORS) checkCount(colors.length);
    });
    checkCount(colors.length);
    return { name: null, colors };
}

/** A hex palette: lower-case RRGGBB per line, RRGGBBAA when a colour is not opaque. */
export function writeHex(palette: Palette): Uint8Array<ArrayBuffer> {
    checkPalette(palette.colors);
    const alpha = !palette.colors.every(isOpaque);
    return encodeText(
        palette.colors.map((colour) => hexText(colour, alpha)),
        "\n",
    );
}

// --- JASC .pal -------------------------------------------------------------------------------

const JASC_MAGIC = "JASC-PAL";
const JASC_VERSION = "0100";

/**
 * A JASC palette (Paint Shop Pro): "JASC-PAL", "0100", the number of colours, then that many
 * lines of three decimal values 0–255 (or four, the last alpha); blank lines at the end are
 * skipped.
 */
export function readPal(bytes: Uint8Array): PaletteFile {
    const lines = linesOf(bytes);
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    if ((lines[0] ?? "").trim() !== JASC_MAGIC) {
        throw new PaletteFileError(`A JASC palette starts with “${JASC_MAGIC}”.`, 1);
    }
    if ((lines[1] ?? "").trim() !== JASC_VERSION) {
        throw new PaletteFileError(`A JASC palette has the version “${JASC_VERSION}”.`, 2);
    }
    const countText = (lines[2] ?? "").trim();
    if (!/^\d{1,6}$/.test(countText)) {
        throw new PaletteFileError(`“${countText}” is not a number of colours.`, 3);
    }
    const count = Number(countText);
    checkCount(count);
    const body = lines.slice(3);
    if (body.length !== count) {
        throw new PaletteFileError(
            `The file says ${count} colours and holds ${body.length} colour lines.`,
        );
    }
    const colors = body.map((raw, index) => {
        const line = index + 4;
        const parts = raw.trim().split(/\s+/);
        if (parts.length !== 3 && parts.length !== 4) {
            throw new PaletteFileError("A colour line holds three values (or four, RGBA).", line);
        }
        const [r, g, b, a] = parts.map((part) => channel(part, line));
        return pack(r, g, b, a ?? 255);
    });
    return { name: null, colors };
}

/** A JASC palette, lines ended by CR LF; a fourth value (alpha) when a colour is not opaque. */
export function writePal(palette: Palette): Uint8Array<ArrayBuffer> {
    checkPalette(palette.colors);
    const alpha = !palette.colors.every(isOpaque);
    const lines = [JASC_MAGIC, JASC_VERSION, String(palette.colors.length)];
    for (const colour of palette.colors) {
        const [r, g, b, a] = channels(colour);
        lines.push((alpha ? [r, g, b, a] : [r, g, b]).join(" "));
    }
    return encodeText(lines, "\r\n");
}

// --- PNG -------------------------------------------------------------------------------------

/**
 * The distinct colours of a PNG image (decoded by `core/png`), in the order the pixels first
 * show them, row by row: a palette strip reads left to right. A pixel of alpha 0 holds no
 * colour and does not count. More than 256 colours, or none, is an error: the image is read
 * as a palette, not reduced to one (Palette from Sprite and PNG import reduce colours).
 */
export async function readPng(bytes: Uint8Array): Promise<PaletteFile> {
    let image;
    try {
        image = await decodePng(bytes);
    } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        throw new PaletteFileError(`The image cannot be read: ${why}`, null, { cause: error });
    }
    const { data } = image;
    const seen = new Set<number>();
    const colors: number[] = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let at = 0; at < data.length; at += 4) {
        if (data[at + 3] === 0) continue;
        const colour = view.getUint32(at);
        if (seen.has(colour)) continue;
        seen.add(colour);
        colors.push(colour);
        if (colors.length > MAX_PALETTE_COLORS) {
            throw new PaletteFileError(
                `The image holds more than ${MAX_PALETTE_COLORS} colours; a palette holds at ` +
                    `most ${MAX_PALETTE_COLORS}.`,
            );
        }
    }
    checkCount(colors.length);
    return { name: null, colors };
}

// --- By format -------------------------------------------------------------------------------

/**
 * Reads a palette file of `format`. Throws `PaletteFileError` for a malformed file, one with
 * no colour or more than 256, or one larger than `MAX_PALETTE_FILE_BYTES`.
 */
export async function readPaletteFile(
    format: PaletteFormat,
    bytes: Uint8Array,
): Promise<PaletteFile> {
    if (bytes.byteLength > MAX_PALETTE_FILE_BYTES) {
        throw new PaletteFileError(PALETTE_FILE_TOO_LARGE);
    }
    switch (format) {
        case "gpl":
            return readGpl(bytes);
        case "hex":
            return readHex(bytes);
        case "pal":
            return readPal(bytes);
        case "png":
            return readPng(bytes);
    }
}

/**
 * The bytes of a palette file of `format`. Throws `RangeError` for a palette of no colour or
 * more than 256.
 */
export function writePaletteFile(
    format: PaletteTextFormat,
    palette: Palette,
): Uint8Array<ArrayBuffer> {
    switch (format) {
        case "gpl":
            return writeGpl(palette);
        case "hex":
            return writeHex(palette);
        case "pal":
            return writePal(palette);
    }
}
