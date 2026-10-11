import { readdirSync, readFileSync } from "node:fs";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { pixelBuffersEqual } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";
import { decodePng, encodePng, PngError } from "../../src/core/png";
import type { PngErrorCode } from "../../src/core/png";

// --- fixtures -------------------------------------------------------------------------------
// Files and expected pixels come from se-005-fixtures/make_fixtures.py (Pillow and a writer of
// its own); the expected pixels are computed there from the source samples, never by decoding.

interface Fixture {
    file: string;
    writer: string;
    width: number;
    height: number;
    colorType: number;
    bitDepth: number;
    interlaced: boolean;
    transparency: boolean;
    /** Expected straight RGBA8 pixels, row-major, as hex. */
    rgba: string;
}

const fixtureDir = new URL("./se-005-fixtures/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fixtureDir), "utf8")) as {
    fixtures: Fixture[];
};

/** The kinds of file the acceptance list of SE-005 names. */
const kinds: [string, (fixture: Fixture) => boolean][] = [
    ["greyscale", (fixture) => fixture.colorType === 0],
    ["greyscale+alpha", (fixture) => fixture.colorType === 4],
    ["RGB", (fixture) => fixture.colorType === 2],
    ["RGBA", (fixture) => fixture.colorType === 6],
    ["indexed with tRNS", (fixture) => fixture.colorType === 3 && fixture.transparency],
    ["16-bit", (fixture) => fixture.bitDepth === 16],
    ["interlaced", (fixture) => fixture.interlaced],
];

/** Describes the first pixel that differs from `expected`, or null when none does. */
function firstDifference(
    actual: PixelBuffer,
    expected: Uint8Array | Uint8ClampedArray,
): string | null {
    if (actual.data.length !== expected.length) {
        return `${actual.data.length} bytes, expected ${expected.length}`;
    }
    for (let i = 0; i < expected.length; i += 4) {
        const got = actual.data.subarray(i, i + 4).join();
        const wanted = expected.subarray(i, i + 4).join();
        if (got !== wanted) {
            const x = (i / 4) % actual.width;
            const y = Math.floor(i / 4 / actual.width);
            return `pixel (${x}, ${y}) is ${got}, expected ${wanted}`;
        }
    }
    return null;
}

async function expectFixture(fixture: Fixture): Promise<void> {
    const bytes = readFileSync(new URL(fixture.file, fixtureDir));
    // The file is of the kind the manifest states, read from its header, not by the decoder.
    expect(
        {
            width: bytes.readUInt32BE(16),
            height: bytes.readUInt32BE(20),
            bitDepth: bytes[24],
            colorType: bytes[25],
            interlaced: bytes[28] === 1,
        },
        fixture.file,
    ).toEqual({
        width: fixture.width,
        height: fixture.height,
        bitDepth: fixture.bitDepth,
        colorType: fixture.colorType,
        interlaced: fixture.interlaced,
    });
    const decoded = await decodePng(bytes);
    expect([decoded.width, decoded.height], fixture.file).toEqual([fixture.width, fixture.height]);
    expect(decoded.data).toBeInstanceOf(Uint8ClampedArray);
    expect(firstDifference(decoded, Buffer.from(fixture.rgba, "hex")), fixture.file).toBeNull();
}

// --- PNG files built in the test --------------------------------------------------------------
// node:zlib supplies CRC-32 and deflate, so these files do not depend on the code under test.

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, content: Uint8Array = new Uint8Array(0)): Buffer {
    const body = Buffer.concat([Buffer.from(type, "latin1"), content]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(content.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
}

function ihdr(
    width: number,
    height: number,
    bitDepth = 8,
    colorType = 6,
    interlace = 0,
    compression = 0,
    filter = 0,
): Buffer {
    const content = Buffer.alloc(13);
    content.writeUInt32BE(width, 0);
    content.writeUInt32BE(height, 4);
    content.set([bitDepth, colorType, compression, filter, interlace], 8);
    return chunk("IHDR", content);
}

function png(...chunks: Uint8Array[]): Buffer {
    return Buffer.concat([SIGNATURE, ...chunks]);
}

/** IDAT chunk holding `scanlines` (filter bytes included) as one zlib stream. */
function idat(scanlines: Uint8Array | number[]): Buffer {
    return chunk("IDAT", deflateSync(Uint8Array.from(scanlines)));
}

const IEND = chunk("IEND");

// 2 × 2 images; every scanline starts with filter type 0.
const RGBA_PIXELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const RGBA_LINES = [0, ...RGBA_PIXELS.slice(0, 8), 0, ...RGBA_PIXELS.slice(8)];
// Adam7 for 2 × 2: pass 1 holds pixel (0, 0), pass 6 pixel (1, 0), pass 7 the second row.
const INTERLACED_LINES = [
    ...[0, ...RGBA_PIXELS.slice(0, 4)],
    ...[0, ...RGBA_PIXELS.slice(4, 8)],
    ...[0, ...RGBA_PIXELS.slice(8)],
];
const RGB_LINES = [0, 1, 2, 3, 4, 5, 6, 0, 7, 8, 9, 10, 11, 12];
const GREY_LINES = [0, 10, 20, 0, 30, 40];
const INDEX_LINES = [0, 0, 1, 0, 1, 0];
const RGBA_STREAM = deflateSync(Uint8Array.from(RGBA_LINES));
const RGBA_IDAT = chunk("IDAT", RGBA_STREAM);
const RGB_IDAT = idat(RGB_LINES);
const GREY_IDAT = idat(GREY_LINES);
const INDEX_IDAT = idat(INDEX_LINES);
const TWO_COLOURS = chunk("PLTE", Uint8Array.of(10, 20, 30, 40, 50, 60));
const TWO_ALPHAS = chunk("tRNS", Uint8Array.of(0, 128));
const GREY_KEY = chunk("tRNS", Uint8Array.of(0, 10));
const RGB_KEY = chunk("tRNS", Uint8Array.of(0, 1, 0, 2, 0, 3));

/** The well-formed files the malformed cases are derived from, with their pixels. */
const VALID = png(ihdr(2, 2), RGBA_IDAT, IEND);
const IDAT_OFFSET = SIGNATURE.length + 25;
const wellFormed: { name: string; bytes: Buffer; rgba: number[] }[] = [
    { name: "RGBA", bytes: VALID, rgba: RGBA_PIXELS },
    {
        name: "interlaced RGBA",
        bytes: png(ihdr(2, 2, 8, 6, 1), idat(INTERLACED_LINES), IEND),
        rgba: RGBA_PIXELS,
    },
    {
        name: "RGB with a colour key",
        bytes: png(ihdr(2, 2, 8, 2), RGB_KEY, RGB_IDAT, IEND),
        rgba: [1, 2, 3, 0, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255],
    },
    {
        name: "greyscale with a colour key",
        bytes: png(ihdr(2, 2, 8, 0), GREY_KEY, GREY_IDAT, IEND),
        rgba: [10, 10, 10, 0, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255],
    },
    {
        name: "indexed with tRNS",
        bytes: png(ihdr(2, 2, 8, 3), TWO_COLOURS, TWO_ALPHAS, INDEX_IDAT, IEND),
        rgba: [10, 20, 30, 0, 40, 50, 60, 128, 40, 50, 60, 128, 10, 20, 30, 0],
    },
];

function patched(bytes: Uint8Array, change: (copy: Buffer) => void): Buffer {
    const copy = Buffer.from(bytes);
    change(copy);
    return copy;
}

function pseudoRandomBytes(length: number, seed: number): Buffer {
    const bytes = Buffer.alloc(length);
    let state = seed;
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        bytes[i] = state >>> 24;
    }
    return bytes;
}

interface Malformed {
    name: string;
    code: PngErrorCode;
    /** Part of the message, so that a case cannot pass by failing some other check. */
    reason: RegExp;
    bytes: Uint8Array;
}

function bad(name: string, code: PngErrorCode, reason: RegExp, bytes: Uint8Array): Malformed {
    return { name, code, reason, bytes };
}

const NOT_PNG = /Not a PNG/;
const NOT_ZLIB = /not a valid zlib stream/;
const TOO_SHORT = /shorter than the image size/;
const TOO_LONG = /longer than the image size/;
const BAD_TRNS = /tRNS does not fit/;
const JPEG_START = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1);

/** Scanlines of a 2048-pixel-wide RGBA8 image that stop in the third line: valid filters. */
const PARTIAL_LINES = patched(pseudoRandomBytes(20000, 7), (copy) => {
    for (let offset = 0; offset < copy.length; offset += 1 + 2048 * 4) {
        copy[offset] = 0;
    }
});

const malformed: Malformed[] = [
    // Not a PNG
    bad("empty input", "signature", NOT_PNG, new Uint8Array(0)),
    bad("text", "signature", NOT_PNG, Buffer.from("this is not a PNG file")),
    bad("another image format (JPEG)", "signature", NOT_PNG, JPEG_START),
    bad(
        // What a text-mode transfer does to the signature's carriage return.
        "a line feed in place of the signature's carriage return",
        "signature",
        NOT_PNG,
        patched(VALID, (copy) => {
            copy[4] = 0x0a;
        }),
    ),
    bad("the signature alone", "chunk", /ends before its IEND/, SIGNATURE),

    // IHDR values
    bad("width 0", "header", /Image size/, png(ihdr(0, 2), RGBA_IDAT, IEND)),
    bad("height 0", "header", /Image size/, png(ihdr(2, 0), RGBA_IDAT, IEND)),
    bad("width above 2^31 - 1", "header", /Image size/, png(ihdr(0x80000000, 2), RGBA_IDAT, IEND)),
    bad("bit depth 3", "header", /bit depth 3/, png(ihdr(2, 2, 3, 0), GREY_IDAT, IEND)),
    bad("colour type 5", "header", /Colour type 5/, png(ihdr(2, 2, 8, 5), GREY_IDAT, IEND)),
    bad(
        "RGB with bit depth 4",
        "header",
        /Colour type 2 with bit depth 4/,
        png(ihdr(2, 2, 4, 2), RGB_IDAT, IEND),
    ),
    bad(
        "indexed colour with bit depth 16",
        "header",
        /Colour type 3 with bit depth 16/,
        png(ihdr(2, 2, 16, 3), TWO_COLOURS, INDEX_IDAT, IEND),
    ),
    bad(
        "an unknown compression method",
        "header",
        /method/,
        png(ihdr(2, 2, 8, 6, 0, 1), RGBA_IDAT, IEND),
    ),
    bad(
        "an unknown filter method",
        "header",
        /method/,
        png(ihdr(2, 2, 8, 6, 0, 0, 1), RGBA_IDAT, IEND),
    ),
    bad(
        "an unknown interlace method",
        "header",
        /method/,
        png(ihdr(2, 2, 8, 6, 2), RGBA_IDAT, IEND),
    ),
    bad(
        "an IHDR of 12 bytes",
        "header",
        /13 bytes/,
        png(chunk("IHDR", Buffer.alloc(12, 1)), RGBA_IDAT, IEND),
    ),

    // Chunk layout
    bad("IDAT before IHDR", "chunk", /not the first chunk/, png(RGBA_IDAT, ihdr(2, 2), IEND)),
    bad(
        "two IHDR chunks",
        "chunk",
        /IHDR appears twice/,
        png(ihdr(2, 2), ihdr(2, 2), RGBA_IDAT, IEND),
    ),
    bad("no IDAT chunk", "chunk", /no IDAT/, png(ihdr(2, 2), IEND)),
    bad("no IEND chunk", "chunk", /ends before its IEND/, png(ihdr(2, 2), RGBA_IDAT)),
    bad(
        "IDAT chunks with another chunk between them",
        "chunk",
        /not consecutive/,
        png(
            ihdr(2, 2),
            chunk("IDAT", RGBA_STREAM.subarray(0, 4)),
            chunk("tEXt", Buffer.from("Comment\0split")),
            chunk("IDAT", RGBA_STREAM.subarray(4)),
            IEND,
        ),
    ),
    bad(
        "an unknown critical chunk",
        "chunk",
        /critical chunk ABCD/,
        png(ihdr(2, 2), chunk("ABCD", Uint8Array.of(1, 2, 3)), RGBA_IDAT, IEND),
    ),
    bad(
        "a chunk type that is not four letters",
        "chunk",
        /four letters/,
        png(ihdr(2, 2), chunk("te1t"), RGBA_IDAT, IEND),
    ),
    bad(
        "a chunk that fails its checksum",
        "chunk",
        /IDAT chunk fails its checksum/,
        patched(VALID, (copy) => {
            copy[IDAT_OFFSET + 10] ^= 0x01;
        }),
    ),
    bad(
        "a chunk length that runs past the end of the file",
        "chunk",
        /longer than the rest of the file/,
        patched(VALID, (copy) => {
            copy.writeUInt32BE(0x7fffffff, IDAT_OFFSET);
        }),
    ),
    bad(
        "an indexed image without PLTE",
        "chunk",
        /no PLTE/,
        png(ihdr(2, 2, 8, 3), INDEX_IDAT, IEND),
    ),
    bad(
        "PLTE after the image data",
        "chunk",
        /PLTE appears/,
        png(ihdr(2, 2, 8, 3), INDEX_IDAT, TWO_COLOURS, IEND),
    ),
    bad(
        "two PLTE chunks",
        "chunk",
        /PLTE appears/,
        png(ihdr(2, 2, 8, 3), TWO_COLOURS, TWO_COLOURS, INDEX_IDAT, IEND),
    ),
    bad(
        "tRNS after the image data",
        "chunk",
        /tRNS appears/,
        png(ihdr(2, 2, 8, 0), GREY_IDAT, GREY_KEY, IEND),
    ),
    bad(
        "two tRNS chunks",
        "chunk",
        /tRNS appears/,
        png(ihdr(2, 2, 8, 0), GREY_KEY, GREY_KEY, GREY_IDAT, IEND),
    ),

    // Palette and transparency
    bad(
        "a PLTE length that is not a multiple of 3",
        "data",
        /1 to 256 colours/,
        png(ihdr(2, 2, 8, 3), chunk("PLTE", Buffer.alloc(4)), INDEX_IDAT, IEND),
    ),
    bad(
        "an empty PLTE",
        "data",
        /1 to 256 colours/,
        png(ihdr(2, 2, 8, 3), chunk("PLTE"), INDEX_IDAT, IEND),
    ),
    bad(
        "a PLTE of 257 colours",
        "data",
        /1 to 256 colours/,
        png(ihdr(2, 2, 8, 3), chunk("PLTE", Buffer.alloc(771)), INDEX_IDAT, IEND),
    ),
    bad(
        "a pixel index outside the palette",
        "data",
        /outside the palette/,
        png(ihdr(2, 2, 8, 3), TWO_COLOURS, idat([0, 0, 1, 0, 2, 0]), IEND),
    ),
    bad(
        "tRNS with more entries than the palette",
        "data",
        BAD_TRNS,
        png(
            ihdr(2, 2, 8, 3),
            TWO_COLOURS,
            chunk("tRNS", Uint8Array.of(0, 128, 255)),
            INDEX_IDAT,
            IEND,
        ),
    ),
    bad(
        "tRNS before PLTE in an indexed image",
        "data",
        BAD_TRNS,
        png(ihdr(2, 2, 8, 3), TWO_ALPHAS, TWO_COLOURS, INDEX_IDAT, IEND),
    ),
    bad(
        "a greyscale tRNS of 1 byte",
        "data",
        BAD_TRNS,
        png(ihdr(2, 2, 8, 0), chunk("tRNS", Uint8Array.of(10)), GREY_IDAT, IEND),
    ),
    bad(
        "an RGB tRNS of 2 bytes",
        "data",
        BAD_TRNS,
        png(ihdr(2, 2, 8, 2), chunk("tRNS", Uint8Array.of(0, 1)), RGB_IDAT, IEND),
    ),

    // Image data
    bad(
        "an IDAT that is not a zlib stream",
        "data",
        NOT_ZLIB,
        png(ihdr(2, 2), chunk("IDAT", Buffer.from(RGBA_PIXELS)), IEND),
    ),
    bad("an empty IDAT", "data", TOO_SHORT, png(ihdr(2, 2), chunk("IDAT"), IEND)),
    bad(
        "a zlib stream that is cut short",
        "data",
        NOT_ZLIB,
        png(ihdr(2, 2), chunk("IDAT", RGBA_STREAM.subarray(0, -5)), IEND),
    ),
    bad(
        "a zlib stream with a wrong Adler-32",
        "data",
        NOT_ZLIB,
        png(
            ihdr(2, 2),
            chunk(
                "IDAT",
                patched(RGBA_STREAM, (copy) => {
                    copy[copy.length - 1] ^= 0x01;
                }),
            ),
            IEND,
        ),
    ),
    bad(
        "bytes after the end of the zlib stream",
        "data",
        NOT_ZLIB,
        png(ihdr(2, 2), chunk("IDAT", Buffer.concat([RGBA_STREAM, Buffer.alloc(4)])), IEND),
    ),
    bad(
        // fast-png 8.0.0 returns a zero-padded buffer for this file.
        "image data that ends inside the last scanline",
        "data",
        TOO_SHORT,
        png(ihdr(2, 2), idat(RGBA_LINES.slice(0, -3)), IEND),
    ),
    bad(
        "image data that is one scanline short",
        "data",
        TOO_SHORT,
        png(ihdr(2, 2), idat(RGBA_LINES.slice(0, 9)), IEND),
    ),
    bad(
        "image data that is one byte too long",
        "data",
        TOO_LONG,
        png(ihdr(2, 2), idat([...RGBA_LINES, 0]), IEND),
    ),
    bad(
        "image data that is one scanline too long",
        "data",
        TOO_LONG,
        png(ihdr(2, 2), idat([...RGBA_LINES, ...RGBA_LINES.slice(0, 9)]), IEND),
    ),
    bad(
        "an unknown scanline filter",
        "data",
        /scanline filter 5/,
        png(ihdr(2, 2), idat([5, ...RGBA_LINES.slice(1)]), IEND),
    ),
    bad(
        "interlaced image data that is too short",
        "data",
        TOO_SHORT,
        png(ihdr(2, 2, 8, 6, 1), idat(INTERLACED_LINES.slice(0, -2)), IEND),
    ),
    bad(
        "the largest size a header can state over a few bytes of data",
        "data",
        TOO_SHORT,
        png(ihdr(0x7fffffff, 0x7fffffff, 16, 6), RGBA_IDAT, IEND),
    ),
    bad(
        "a 30000 x 30000 header over a few bytes of data",
        "data",
        TOO_SHORT,
        png(ihdr(30000, 30000), RGBA_IDAT, IEND),
    ),
    bad(
        // Enough compressed bytes that only inflating shows the shortfall.
        "a 2048 x 2048 image whose data stops in the third scanline",
        "data",
        TOO_SHORT,
        png(ihdr(2048, 2048), idat(PARTIAL_LINES), IEND),
    ),
    bad(
        "a 1 x 1 image whose data inflates to 20 MB",
        "data",
        TOO_LONG,
        png(ihdr(1, 1), idat(Buffer.alloc(20_000_000)), IEND),
    ),
];

/**
 * The error `decodePng` rejects with. Fails when it returns a buffer, when it has not settled
 * after one second, or when the error is not a `PngError`.
 */
async function decodeFailure(bytes: Uint8Array, label = ""): Promise<PngError> {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome: unknown = await Promise.race([
        decodePng(bytes).then(
            (buffer) => `returned a ${buffer.width} x ${buffer.height} buffer`,
            (error: unknown) => error,
        ),
        new Promise((resolve) => {
            timer = setTimeout(resolve, 1000, "did not settle within 1 s");
        }),
    ]);
    clearTimeout(timer);
    expect(outcome, label).toBeInstanceOf(PngError);
    expect(performance.now() - started, label).toBeLessThan(1000);
    return outcome as PngError;
}

/** 256 × 32 pixels: column x has alpha x; each row pairs it with other RGB values. */
function alphaSweep(): PixelBuffer {
    const fixed = [
        [0, 0, 0],
        [255, 255, 255],
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [1, 2, 3],
        [254, 253, 252],
        [127, 128, 129],
    ];
    const width = 256;
    const height = 32;
    const random = pseudoRandomBytes(width * height * 3, 2026);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = y * width + x;
            const rgb = fixed[y] ?? random.subarray(pixel * 3, pixel * 3 + 3);
            data.set([rgb[0], rgb[1], rgb[2], x], pixel * 4);
        }
    }
    return { width, height, data };
}

/** Chunks of a PNG file, read with node:zlib's CRC-32. */
function chunksOf(bytes: Uint8Array): { type: string; content: Buffer }[] {
    const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(file.subarray(0, 8)).toEqual(SIGNATURE);
    const chunks: { type: string; content: Buffer }[] = [];
    for (let offset = 8; offset < file.length;) {
        const end = offset + 8 + file.readUInt32BE(offset);
        const type = file.toString("latin1", offset + 4, offset + 8);
        expect(file.readUInt32BE(end), `${type} checksum`).toBe(
            crc32(file.subarray(offset + 4, end)),
        );
        chunks.push({ type, content: file.subarray(offset + 8, end) });
        offset = end + 4;
    }
    return chunks;
}

// --- tests ----------------------------------------------------------------------------------

describe("PNG round trip", () => {
    it("returns identical pixels for every alpha value 0-255 against varied RGB", async () => {
        const buffer = alphaSweep();
        const alphas = new Set<number>();
        for (let i = 3; i < buffer.data.length; i += 4) {
            alphas.add(buffer.data[i]);
        }
        expect(alphas.size).toBe(256);

        const decoded = await decodePng(encodePng(buffer));
        expect([decoded.width, decoded.height]).toEqual([256, 32]);
        expect(firstDifference(decoded, buffer.data)).toBeNull();
        expect(pixelBuffersEqual(decoded, buffer)).toBe(true);
        // Alpha 0 keeps its RGB: row 1 is white in every column, column 0 has alpha 0.
        expect(Array.from(decoded.data.subarray(256 * 4, 256 * 4 + 4))).toEqual([255, 255, 255, 0]);
    });

    it("returns identical pixels for arbitrary buffers", async () => {
        const buffers = fc
            .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }))
            .chain(([width, height]) =>
                fc
                    .uint8Array({ minLength: width * height * 4, maxLength: width * height * 4 })
                    .map((bytes): PixelBuffer => {
                        return { width, height, data: new Uint8ClampedArray(bytes) };
                    }),
            );
        await fc.assert(
            fc.asyncProperty(buffers, async (buffer) =>
                pixelBuffersEqual(await decodePng(encodePng(buffer)), buffer),
            ),
            { numRuns: 200 },
        );
    });
});

describe("decodePng with fixtures", () => {
    it("has a manifest entry for every PNG file in the fixture folder", () => {
        const files = readdirSync(fixtureDir).filter((name) => name.endsWith(".png"));
        expect(manifest.fixtures.map((fixture) => fixture.file).sort()).toEqual(files.sort());
    });

    it.each(kinds)("decodes %s fixtures to the expected pixels", async (_kind, matches) => {
        const matching = manifest.fixtures.filter(matches);
        expect(matching.length).toBeGreaterThan(0);
        for (const fixture of matching) {
            await expectFixture(fixture);
        }
    });

    it("decodes interlaced fixtures below 8 bits per sample", async () => {
        // The case fast-png 8.0.0 cannot read; see src/core/png/decode.ts.
        const matching = manifest.fixtures.filter((f) => f.interlaced && f.bitDepth < 8);
        expect(matching.map((fixture) => fixture.bitDepth).sort()).toEqual([1, 2, 4]);
        for (const fixture of matching) {
            await expectFixture(fixture);
        }
    });

    it.each(manifest.fixtures)("decodes $file", async (fixture) => {
        await expectFixture(fixture);
    });
});

describe("decodePng", () => {
    it.each(wellFormed)(
        "decodes the $name file the malformed cases are derived from",
        async ({ bytes, rgba }) => {
            const decoded = await decodePng(bytes);
            expect([decoded.width, decoded.height]).toEqual([2, 2]);
            expect(Array.from(decoded.data)).toEqual(rgba);
        },
    );

    it("reduces every 16-bit sample value to the nearest 8-bit value", async () => {
        // 256 × 256 greyscale: the pixel at (x, y) holds the sample y * 256 + x.
        const lines = Buffer.alloc(256 * (1 + 512));
        for (let value = 0; value < 65536; value++) {
            lines.writeUInt16BE(value, (value >> 8) * 513 + 1 + (value & 0xff) * 2);
        }
        const decoded = await decodePng(png(ihdr(256, 256, 16, 0), idat(lines), IEND));
        const wrong: string[] = [];
        for (let value = 0; value < 65536; value++) {
            const grey = Math.round((value * 255) / 65535);
            const got = Array.from(decoded.data.subarray(value * 4, value * 4 + 4));
            if (got.join() !== [grey, grey, grey, 255].join()) {
                wrong.push(`${value} -> ${got.join()}, expected ${grey}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it("reads a zlib stream split over many IDAT chunks, empty ones included", async () => {
        const parts = Array.from(RGBA_STREAM, (byte) => chunk("IDAT", Uint8Array.of(byte)));
        parts.splice(3, 0, chunk("IDAT"));
        const decoded = await decodePng(png(ihdr(2, 2), ...parts, chunk("IDAT"), IEND));
        expect(Array.from(decoded.data)).toEqual(RGBA_PIXELS);
    });

    it("ignores bytes after IEND", async () => {
        const decoded = await decodePng(Buffer.concat([VALID, Buffer.from("trailing bytes")]));
        expect(Array.from(decoded.data)).toEqual(RGBA_PIXELS);
    });

    it("ignores tRNS in an image that has an alpha channel", async () => {
        const key = chunk("tRNS", Uint8Array.of(0, 1, 0, 2, 0, 3));
        const decoded = await decodePng(png(ihdr(2, 2), key, idat(RGBA_LINES), IEND));
        expect(Array.from(decoded.data)).toEqual(RGBA_PIXELS);
    });

    it("decodes from a view that starts inside a larger buffer", async () => {
        const padded = Buffer.concat([Buffer.alloc(3, 0xee), VALID, Buffer.alloc(5, 0xee)]);
        const view = new Uint8Array(padded.buffer, padded.byteOffset + 3, VALID.length);
        const decoded = await decodePng(view);
        expect(Array.from(decoded.data)).toEqual(RGBA_PIXELS);
    });

    it("zeroes RGB under alpha 0 only when asked to", async () => {
        const lines = [0, 9, 8, 7, 0, 6, 5, 4, 1, 0, 3, 2, 1, 255, 0, 0, 0, 0];
        const file = png(ihdr(2, 2), idat(lines), IEND);
        const stored = [9, 8, 7, 0, 6, 5, 4, 1, 3, 2, 1, 255, 0, 0, 0, 0];
        expect(Array.from((await decodePng(file)).data)).toEqual(stored);
        expect(Array.from((await decodePng(file, { zeroTransparentRgb: false })).data)).toEqual(
            stored,
        );
        expect(Array.from((await decodePng(file, { zeroTransparentRgb: true })).data)).toEqual([
            0, 0, 0, 0, 6, 5, 4, 1, 3, 2, 1, 255, 0, 0, 0, 0,
        ]);
    });
});

describe("decodePng with malformed input", () => {
    it.each(malformed)("rejects $name", async ({ bytes, code, reason }) => {
        const error = await decodeFailure(bytes);
        expect(error.name).toBe("PngError");
        expect(error.message).toMatch(reason);
        expect(error.code).toBe(code);
    });

    it("keeps the underlying error as the cause", async () => {
        const error = await decodeFailure(
            png(ihdr(2, 2), chunk("IDAT", Buffer.from(RGBA_PIXELS)), IEND),
        );
        expect(error.cause).toBeInstanceOf(Error);
    });

    it("rejects every truncation of a valid file", async () => {
        const files = [VALID, readFileSync(new URL("indexed4-trns-interlaced.png", fixtureDir))];
        for (const file of files) {
            for (let length = 0; length < file.length; length++) {
                const error = await decodeFailure(file.subarray(0, length), `${length} bytes`);
                expect(["signature", "chunk"], `${length} bytes`).toContain(error.code);
            }
        }
    });

    it("rejects a valid file with any single bit flipped", async () => {
        const files = [VALID, readFileSync(new URL("indexed4-trns-interlaced.png", fixtureDir))];
        for (const file of files) {
            for (let bit = 0; bit < file.length * 8; bit++) {
                const damaged = patched(file, (copy) => {
                    copy[bit >> 3] ^= 1 << (bit & 7);
                });
                const error = await decodeFailure(damaged, `bit ${bit}`);
                expect(["signature", "chunk"], `bit ${bit}`).toContain(error.code);
            }
        }
    });

    it("reports an image that cannot be allocated as a memory error", async () => {
        vi.stubGlobal(
            "Uint8ClampedArray",
            class {
                constructor() {
                    throw new RangeError("Array buffer allocation failed");
                }
            },
        );
        // The allocation happens before the first await, so the stub can go at once.
        const pending = decodePng(VALID).catch((error: unknown) => error);
        vi.unstubAllGlobals();
        const error = await pending;
        expect(error).toBeInstanceOf(PngError);
        expect((error as PngError).code).toBe("memory");
        expect((error as PngError).cause).toBeInstanceOf(RangeError);
    });
});

describe("encodePng", () => {
    it("yields identical bytes when the same buffer is encoded twice", () => {
        const buffer = alphaSweep();
        const first = encodePng(buffer);
        const second = encodePng(buffer);
        expect(first).not.toBe(second);
        expect(Buffer.compare(first, second)).toBe(0);
        expect(Buffer.compare(encodePng({ ...buffer, data: buffer.data.slice() }), first)).toBe(0);
    });

    it("writes RGBA8 without interlacing and no chunk besides IHDR, IDAT and IEND", () => {
        const buffer = alphaSweep();
        const chunks = chunksOf(encodePng(buffer));
        const types = chunks.map((entry) => entry.type);
        expect(types[0]).toBe("IHDR");
        expect(types.at(-1)).toBe("IEND");
        expect(types.slice(1, -1).length).toBeGreaterThan(0);
        expect(new Set(types.slice(1, -1))).toEqual(new Set(["IDAT"]));

        const header = chunks[0].content;
        expect(header.length).toBe(13);
        expect([header.readUInt32BE(0), header.readUInt32BE(4)]).toEqual([256, 32]);
        // Bit depth 8, colour type 6, compression 0, filter method 0, no interlace.
        expect(Array.from(header.subarray(8))).toEqual([8, 6, 0, 0, 0]);

        const stream = Buffer.concat(chunks.slice(1, -1).map((entry) => entry.content));
        expect(inflateSync(stream).length).toBe(32 * (1 + 256 * 4));
    });

    it("returns an array of exactly the file's length", () => {
        const bytes = encodePng(alphaSweep());
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.byteOffset).toBe(0);
        expect(bytes.buffer.byteLength).toBe(bytes.length);
    });

    it("writes RGB under alpha 0 as 0 only when asked to, without changing the buffer", async () => {
        const data = Uint8ClampedArray.of(9, 8, 7, 0, 6, 5, 4, 1, 3, 2, 1, 255, 0, 0, 0, 0);
        const buffer = { width: 2, height: 2, data };
        const before = Array.from(data);

        const normalized = await decodePng(encodePng(buffer, { zeroTransparentRgb: true }));
        expect(Array.from(normalized.data)).toEqual([
            0, 0, 0, 0, 6, 5, 4, 1, 3, 2, 1, 255, 0, 0, 0, 0,
        ]);
        expect(Array.from(data)).toEqual(before);
        expect(Array.from((await decodePng(encodePng(buffer))).data)).toEqual(before);

        // Buffers that differ only where alpha is 0 then give the same file.
        const other = { width: 2, height: 2, data: data.slice() };
        other.data.set([200, 100, 50], 0);
        const options = { zeroTransparentRgb: true };
        expect(Buffer.compare(encodePng(other, options), encodePng(buffer, options))).toBe(0);
        expect(Buffer.compare(encodePng(other), encodePng(buffer))).not.toBe(0);
    });

    it("rejects a buffer whose size and data do not match", () => {
        const data = new Uint8ClampedArray(16);
        for (const buffer of [
            { width: 0, height: 2, data },
            { width: 2, height: -2, data },
            { width: 1.5, height: 2, data },
            { width: 2, height: 3, data },
            { width: 2, height: 2, data: new Uint8ClampedArray(15) },
        ]) {
            let thrown: unknown;
            try {
                encodePng(buffer);
            } catch (error) {
                thrown = error;
            }
            expect(thrown).toBeInstanceOf(PngError);
            expect((thrown as PngError).code).toBe("buffer");
        }
    });
});

describe("PNG codec environment", () => {
    it("runs under Vitest in Node without a DOM", async () => {
        expect(typeof process.versions.node).toBe("string");
        expect(typeof window).toBe("undefined");
        expect(typeof document).toBe("undefined");
        expect(typeof ImageData).toBe("undefined");
        expect(typeof HTMLCanvasElement).toBe("undefined");

        const buffer = alphaSweep();
        expect(pixelBuffersEqual(await decodePng(encodePng(buffer)), buffer)).toBe(true);
    });
});
