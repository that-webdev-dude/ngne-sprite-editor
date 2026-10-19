import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DAWNBRINGER_32 } from "../../src/core/model";
import {
    MAX_PALETTE_FILE_BYTES,
    PaletteFileError,
    paletteFormatOf,
    paletteNameOfFile,
    readGpl,
    readHex,
    readPal,
    readPaletteFile,
    readPng,
    writeGpl,
    writeHex,
    writePal,
    writePaletteFile,
} from "../../src/core/palettes";
import type { PaletteTextFormat } from "../../src/core/palettes";
import { encodePng } from "../../src/core/png";

// SE-066: the palette file codecs of `core/palettes` — GIMP `.gpl`, `.hex` and JASC `.pal` read
// and written, a PNG read for its distinct colours — round trips on a 32-colour fixture and on
// any palette, and a `PaletteFileError` for every malformed file.

const fixture = (name: string) =>
    new Uint8Array(readFileSync(new URL(`./se-066-fixtures/${name}`, import.meta.url)));
const text = (value: string) => new TextEncoder().encode(value);
const decoded = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** 32 colours, six of them not opaque (one fully transparent). */
const RGBA_32 = [
    ...DAWNBRINGER_32.slice(0, 26),
    0x11223300,
    0x44556680,
    0x778899fe,
    0xaabbcc01,
    0xddeeff7f,
    0x0000007f,
];

const READERS = { gpl: readGpl, hex: readHex, pal: readPal };
const WRITERS = { gpl: writeGpl, hex: writeHex, pal: writePal };
const FORMATS: PaletteTextFormat[] = ["gpl", "hex", "pal"];

describe("the 32-colour fixture", () => {
    it("is DawnBringer 32 in each format, as GIMP, Lospec, Aseprite and Paint Shop Pro write it", () => {
        expect(DAWNBRINGER_32).toHaveLength(32);
        // GIMP: Name and Columns headers, a comment, colour names after a tab.
        expect(readGpl(fixture("db32-gimp.gpl"))).toEqual({
            name: "DawnBringer 32",
            colors: DAWNBRINGER_32,
        });
        // Lospec: the name in a `#Palette Name:` comment, tab-separated values, a hex name.
        expect(readGpl(fixture("db32-lospec.gpl"))).toEqual({
            name: "DawnBringer 32",
            colors: DAWNBRINGER_32,
        });
        // Aseprite: no Name or Columns header.
        expect(readGpl(fixture("db32-aseprite.gpl"))).toEqual({
            name: null,
            colors: DAWNBRINGER_32,
        });
        expect(readHex(fixture("db32.hex"))).toEqual({ name: null, colors: DAWNBRINGER_32 });
        expect(readPal(fixture("db32.pal"))).toEqual({ name: null, colors: DAWNBRINGER_32 });
    });

    it.each(FORMATS)("round-trips through .%s, opaque and with alpha", (format) => {
        for (const colors of [[...DAWNBRINGER_32], RGBA_32]) {
            const palette = { name: "Fixture 32", colors };
            const bytes = WRITERS[format](palette);
            const read = READERS[format](bytes);
            expect(read.colors).toEqual(colors);
            expect(read.name).toBe(format === "gpl" ? "Fixture 32" : null);
            // The file read again writes the same bytes.
            expect(
                WRITERS[format]({ name: read.name ?? "Fixture 32", colors: read.colors }),
            ).toEqual(bytes);
        }
    });

    it("writes the plain forms for an opaque palette: the fixture's .hex and .pal exactly", () => {
        const palette = { name: "DawnBringer 32", colors: [...DAWNBRINGER_32] };
        expect(decoded(writeHex(palette))).toBe(decoded(fixture("db32.hex")));
        // JASC files end their lines with CR LF; the fixture is kept with LF.
        expect(decoded(writePal(palette))).toBe(
            decoded(fixture("db32.pal")).replace(/\n/g, "\r\n"),
        );
        const gpl = decoded(writeGpl(palette)).split("\n");
        expect(gpl.slice(0, 3)).toEqual(["GIMP Palette", "Name: DawnBringer 32", "Columns: 16"]);
        expect(gpl).not.toContain("Channels: RGBA");
        expect(gpl).toContain("223 113  38\t#DF7126");
    });

    it("writes the fourth value only when a colour is not opaque", () => {
        const palette = { name: "A", colors: [0xff000080, 0x00ff00ff] };
        expect(decoded(writeHex(palette))).toBe("ff000080\n00ff00ff\n");
        expect(decoded(writePal(palette))).toBe(
            "JASC-PAL\r\n0100\r\n2\r\n255 0 0 128\r\n0 255 0 255\r\n",
        );
        expect(decoded(writeGpl(palette))).toBe(
            "GIMP Palette\nName: A\nColumns: 16\nChannels: RGBA\n#\n" +
                "255   0   0 128\t#FF000080\n  0 255   0 255\t#00FF00FF\n",
        );
    });
});

describe("any palette", () => {
    const colour = fc.integer({ min: 0, max: 0xffffffff });
    const name = fc
        .string({ minLength: 1, maxLength: 40 })
        .map((value) => value.replace(/[\r\n\u2028\u2029]/g, " ").trim())
        .filter((value) => value !== "" && !/\s/.test(value[0]) && !/\s/.test(value.at(-1)!));

    it.each(FORMATS)("round-trips through .%s (1 to 256 colours, any RGBA)", (format) => {
        fc.assert(
            fc.property(
                fc.array(colour, { minLength: 1, maxLength: 256 }),
                name,
                (colors, title) => {
                    const read = READERS[format](WRITERS[format]({ name: title, colors }));
                    expect(read.colors).toEqual(colors);
                    if (format === "gpl") expect(read.name).toBe(title);
                },
            ),
            { numRuns: 60 },
        );
    });

    it("refuses to write no colour or more than 256", () => {
        for (const format of FORMATS) {
            expect(() => writePaletteFile(format, { name: "x", colors: [] })).toThrow(RangeError);
            const many = Array.from({ length: 257 }, (_, index) => index);
            expect(() => writePaletteFile(format, { name: "x", colors: many })).toThrow(RangeError);
        }
    });
});

describe("reading what other programs write", () => {
    it(".gpl: comments, blank lines, colour names, tabs, CR LF and Aseprite's RGBA channels", () => {
        const gimp = text(
            "GIMP Palette\r\nName:   Sunset  \r\nColumns: 4\r\n#\r\n# a comment\r\n\r\n" +
                "255   0   0\tRed\r\n  0 128 255 Sky blue\r\n12 34 56\r\n",
        );
        expect(readGpl(gimp)).toEqual({
            name: "Sunset",
            colors: [0xff0000ff, 0x0080ffff, 0x0c2238ff],
        });
        const aseprite = text("GIMP Palette\nChannels: RGBA\n#\n1 2 3 4 Untitled\n5 6 7 255\n");
        expect(readGpl(aseprite)).toEqual({ name: null, colors: [0x01020304, 0x050607ff] });
        // A byte order mark is dropped.
        expect(readGpl(text("\uFEFFGIMP Palette\n1 1 1\n")).colors).toEqual([0x010101ff]);
    });

    it(".gpl: other `Key: value` headers before the colours are skipped; Name: wins over Lospec's comment", () => {
        const headers = text(
            "GIMP Palette\nDescription: warm tones\nX-Tool: 2.0\n#Palette Name: Comment\n" +
                "Name: Header\n1\t2\t3\tabcdef\n",
        );
        expect(readGpl(headers)).toEqual({ name: "Header", colors: [0x010203ff] });
        // Only before the first colour: afterwards such a line is not a colour.
        expect(() => readGpl(text("GIMP Palette\n1 2 3\nDescription: late\n"))).toThrow(/Line 3/);
    });

    it(".hex: with or without #, either case, eight digits for alpha, blank lines skipped", () => {
        expect(readHex(text("FF0000\n#00ff00\r\n\n0000ff80\n   abcdef   \n")).colors).toEqual([
            0xff0000ff, 0x00ff00ff, 0x0000ff80, 0xabcdefff,
        ]);
    });

    it(".pal: CR LF lines, a trailing blank line, a fourth value as alpha", () => {
        expect(
            readPal(text("JASC-PAL\r\n0100\r\n3\r\n255 0 0\r\n0 255 0 128\r\n0 0 255\r\n\r\n")),
        ).toEqual({ name: null, colors: [0xff0000ff, 0x00ff0080, 0x0000ffff] });
    });
});

describe("malformed files", () => {
    const malformed: [string, (bytes: Uint8Array) => unknown, string, RegExp][] = [
        ["gpl: no header", readGpl, "255 0 0\n", /GIMP Palette/],
        ["gpl: a value above 255", readGpl, "GIMP Palette\n256 0 0\n", /Line 2: “256”/],
        ["gpl: a negative value", readGpl, "GIMP Palette\n-1 0 0\n", /Line 2/],
        ["gpl: two values", readGpl, "GIMP Palette\n#\n1 2\n", /Line 3: .*3 values/],
        ["gpl: a word for a value", readGpl, "GIMP Palette\nred 0 0\n", /Line 2/],
        ["gpl: a fraction", readGpl, "GIMP Palette\n1.5 0 0\n", /Line 2/],
        [
            "gpl: RGBA with three values",
            readGpl,
            "GIMP Palette\nChannels: RGBA\n1 2 3 x\n",
            /Line 3/,
        ],
        ["gpl: unknown channels", readGpl, "GIMP Palette\nChannels: CMYK\n", /Line 2/],
        ["gpl: a header after the colours", readGpl, "GIMP Palette\n1 2 3\nName: x\n", /Line 3/],
        ["gpl: no colour", readGpl, "GIMP Palette\nName: Empty\n#\n", /no colours/],
        ["hex: five digits", readHex, "ff000\n", /Line 1/],
        ["hex: three digits", readHex, "00ff00\nf00\n", /Line 2/],
        ["hex: not hex", readHex, "00ff00\nzzzzzz\n", /Line 2/],
        ["hex: a comment", readHex, "; colours\n00ff00\n", /Line 1/],
        ["hex: empty", readHex, "\n\n", /no colours/],
        ["pal: no header", readPal, "0100\n1\n1 2 3\n", /Line 1: .*JASC-PAL/],
        ["pal: another version", readPal, "JASC-PAL\n0200\n1\n1 2 3\n", /Line 2/],
        ["pal: no count", readPal, "JASC-PAL\n0100\nx\n1 2 3\n", /Line 3/],
        ["pal: fewer lines than its count", readPal, "JASC-PAL\n0100\n3\n1 2 3\n", /says 3/],
        ["pal: more lines than its count", readPal, "JASC-PAL\n0100\n1\n1 2 3\n4 5 6\n", /says 1/],
        ["pal: a value above 255", readPal, "JASC-PAL\n0100\n1\n1 2 300\n", /Line 4/],
        ["pal: five values", readPal, "JASC-PAL\n0100\n1\n1 2 3 4 5\n", /Line 4/],
        ["pal: no colour", readPal, "JASC-PAL\n0100\n0\n", /no colours/],
        ["pal: 257 colours", readPal, `JASC-PAL\n0100\n257\n${"1 2 3\n".repeat(257)}`, /257/],
    ];

    it.each(malformed)("%s", (_, read, content, message) => {
        expect(() => read(text(content))).toThrow(PaletteFileError);
        expect(() => read(text(content))).toThrow(message);
    });

    it("more than 256 colours in .gpl or .hex", () => {
        const lines = Array.from({ length: 257 }, (_, index) => index);
        const gpl = `GIMP Palette\n${lines.map((value) => `${value & 0xff} 0 0`).join("\n")}\n`;
        expect(() => readGpl(text(gpl))).toThrow(/at most 256/);
        const hex = lines.map((value) => value.toString(16).padStart(6, "0")).join("\n");
        expect(() => readHex(text(hex))).toThrow(/at most 256/);
        // 256 is a palette.
        expect(readHex(text(hex.split("\n").slice(0, 256).join("\n"))).colors).toHaveLength(256);
    });

    it("binary bytes are refused as text", () => {
        const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a, 0x01]);
        for (const read of [readGpl, readHex, readPal])
            expect(() => read(bytes)).toThrow(PaletteFileError);
    });

    it("random bytes never throw anything but a PaletteFileError", () => {
        fc.assert(
            fc.property(
                fc.uint8Array({ maxLength: 200 }),
                fc.constantFrom(...FORMATS),
                (bytes, format) => {
                    try {
                        READERS[format](bytes);
                    } catch (error) {
                        expect(error).toBeInstanceOf(PaletteFileError);
                    }
                },
            ),
            { numRuns: 300 },
        );
    });

    it("a file larger than the limit is refused before it is read", async () => {
        const large = new Uint8Array(MAX_PALETTE_FILE_BYTES + 1);
        await expect(readPaletteFile("hex", large)).rejects.toThrow(PaletteFileError);
        await expect(readPaletteFile("hex", large)).rejects.toThrow(
            "The file is larger than 64 MiB.",
        );
    });
});

describe("PNG", () => {
    function png(width: number, height: number, pixels: number[]): Uint8Array {
        const data = new Uint8ClampedArray(width * height * 4);
        pixels.forEach((colour, index) => {
            new DataView(data.buffer).setUint32(index * 4, colour);
        });
        return encodePng({ width, height, data });
    }

    it("reads the distinct colours in the order the pixels first show them, alpha 0 left out", async () => {
        const bytes = png(
            4,
            2,
            [
                0x00ff00ff, 0xff000080, 0x00ff00ff, 0x12345600, 0x00000000, 0xff000080, 0x0000ffff,
                0x00ff00ff,
            ],
        );
        expect(await readPng(bytes)).toEqual({
            name: null,
            colors: [0x00ff00ff, 0xff000080, 0x0000ffff],
        });
        expect(await readPaletteFile("png", bytes)).toEqual(await readPng(bytes));
    });

    it("reads 256 colours and refuses 257 or none", async () => {
        const colours = Array.from({ length: 257 }, (_, index) => ((index << 8) | 0xff) >>> 0);
        expect((await readPng(png(256, 1, colours.slice(0, 256)))).colors).toEqual(
            colours.slice(0, 256),
        );
        await expect(readPng(png(257, 1, colours))).rejects.toThrow(/more than 256/);
        await expect(readPng(png(2, 2, [0, 0, 0, 0]))).rejects.toThrow(/no colours/);
    });

    it("refuses bytes that are not a PNG", async () => {
        await expect(readPng(text("GIMP Palette\n1 2 3\n"))).rejects.toThrow(PaletteFileError);
        const cut = png(2, 2, [0xff0000ff, 0xff0000ff, 0xff0000ff, 0xff0000ff]).slice(0, 40);
        await expect(readPaletteFile("png", cut)).rejects.toThrow(PaletteFileError);
    });
});

describe("file names", () => {
    it("names the format by the ending, in either case", () => {
        expect(paletteFormatOf("db32.GPL")).toBe("gpl");
        expect(paletteFormatOf("a.b.hex")).toBe("hex");
        expect(paletteFormatOf("x.Pal")).toBe("pal");
        expect(paletteFormatOf("strip.png")).toBe("png");
        expect(paletteFormatOf("palette.txt")).toBeNull();
        expect(paletteFormatOf("gpl")).toBeNull();
    });

    it("names a palette by the file name without its ending", () => {
        expect(paletteNameOfFile("Sweetie 16.hex")).toBe("Sweetie 16");
        expect(paletteNameOfFile("C:\\palettes\\db32.pal")).toBe("db32");
        expect(paletteNameOfFile(".hex")).toBe(".hex");
        expect(paletteNameOfFile(`${"n".repeat(300)}.gpl`)).toHaveLength(255);
    });
});
