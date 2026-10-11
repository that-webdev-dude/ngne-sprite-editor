import { zeroTransparentRgb } from "../pixels";
import type { PixelBuffer } from "../pixels";
import { PngError } from "./errors";

// Decode direction of the PNG codec, written for SE-005 over DecompressionStream in place of
// fast-png, as the ticket allows when fast-png cannot meet an acceptance item. fast-png 8.0.0
// fails two of them:
// - It cannot read Adam7 images with fewer than 8 bits per sample (it sizes every pass at one
//   byte per pixel), so interlaced 1, 2 and 4-bit fixtures throw "Unsupported filter".
// - It returns a buffer, zero-filled at the end, when the image data stops inside the last
//   scanline, although the input is malformed.
// Encoding still uses fast-png (encode.ts). DecompressionStream is asynchronous, so
// `decodePng` returns a promise.

export interface PngDecodeOptions {
    /** Set R, G and B to 0 wherever alpha is 0. Off by default: pixels come back as stored. */
    zeroTransparentRgb?: boolean;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const GREY = 0;
const RGB = 2;
const INDEXED = 3;
const GREY_ALPHA = 4;
const RGBA = 6;

/** Samples per pixel and the bit depths PNG defines, by colour type. */
const FORMATS = new Map([
    [GREY, { channels: 1, depths: [1, 2, 4, 8, 16] }],
    [RGB, { channels: 3, depths: [8, 16] }],
    [INDEXED, { channels: 1, depths: [1, 2, 4, 8] }],
    [GREY_ALPHA, { channels: 2, depths: [8, 16] }],
    [RGBA, { channels: 4, depths: [8, 16] }],
]);

/** First column, first row, column step and row step of each Adam7 pass. */
const ADAM7 = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
];
const SINGLE_PASS = [[0, 0, 1, 1]];

/** Deflate cannot expand its input by more than this factor. */
const MAX_DEFLATE_RATIO = 1032;

const TOO_LITTLE_DATA = "The image data is shorter than the image size requires.";

interface Header {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    channels: number;
    interlaced: boolean;
}

interface Image {
    header: Header;
    /** PLTE content: three bytes per colour. */
    palette: Uint8Array | null;
    /** tRNS content, kept only for the colour types it applies to. */
    transparency: Uint8Array | null;
    /** IDAT contents in file order; together one zlib stream. */
    data: Uint8Array[];
}

/** One run of scanlines: the whole image, or one of the seven interlace passes. */
interface Pass {
    x: number;
    y: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
    /** Bytes of one scanline, without its filter byte. */
    rowBytes: number;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[n] = c;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
    let crc = 0xffffffff;
    for (let i = start; i < end; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function readChunkType(bytes: Uint8Array, offset: number): string {
    let type = "";
    for (let i = offset; i < offset + 4; i++) {
        const upperCase = bytes[i] & 0xdf;
        if (upperCase < 65 || upperCase > 90) {
            throw new PngError("chunk", "A chunk type is not four letters.");
        }
        type += String.fromCharCode(bytes[i]);
    }
    return type;
}

function readHeader(content: Uint8Array): Header {
    if (content.length !== 13) {
        throw new PngError("header", "IHDR does not hold 13 bytes.");
    }
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    const width = view.getUint32(0);
    const height = view.getUint32(4);
    const bitDepth = content[8];
    const colorType = content[9];
    const format = FORMATS.get(colorType);
    if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) {
        throw new PngError("header", `Image size ${width}x${height} is not valid.`);
    }
    if (!format || !format.depths.includes(bitDepth)) {
        throw new PngError("header", `Colour type ${colorType} with bit depth ${bitDepth}.`);
    }
    if (content[10] !== 0 || content[11] !== 0 || content[12] > 1) {
        throw new PngError("header", "Unknown compression, filter or interlace method.");
    }
    return {
        width,
        height,
        bitDepth,
        colorType,
        channels: format.channels,
        interlaced: content[12] === 1,
    };
}

/**
 * Checks a tRNS chunk against the image: a colour key of one 16-bit value per sample, or one
 * alpha byte per palette entry. Null when the colour type has its own alpha channel, where the
 * chunk does not apply.
 */
function readTransparency(
    content: Uint8Array,
    header: Header,
    palette: Uint8Array | null,
): Uint8Array | null {
    const { colorType, channels } = header;
    if (colorType === GREY_ALPHA || colorType === RGBA) {
        return null;
    }
    const fits =
        colorType === INDEXED
            ? palette !== null && content.length <= palette.length / 3
            : content.length === channels * 2;
    if (!fits) {
        throw new PngError("data", "tRNS does not fit the colour type or the palette.");
    }
    return content;
}

/**
 * Walks the chunks up to IEND: checks layout and checksums, reads IHDR, PLTE and tRNS and
 * collects IDAT. Other ancillary chunks (gamma, colour profile, text, …) are skipped, so
 * sample values are returned without colour conversion. Bytes after IEND are ignored.
 */
function readChunks(bytes: Uint8Array): Image {
    if (bytes.length < SIGNATURE.length || SIGNATURE.some((value, i) => bytes[i] !== value)) {
        throw new PngError("signature", "Not a PNG file.");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let header: Header | null = null;
    let palette: Uint8Array | null = null;
    let transparency: Uint8Array | null = null;
    const data: Uint8Array[] = [];
    let dataEnded = false;
    let offset = SIGNATURE.length;
    for (;;) {
        if (offset + 12 > bytes.length) {
            throw new PngError("chunk", "The file ends before its IEND chunk.");
        }
        const end = offset + 8 + view.getUint32(offset);
        if (end + 4 > bytes.length) {
            throw new PngError("chunk", "A chunk is longer than the rest of the file.");
        }
        const type = readChunkType(bytes, offset + 4);
        if (crc32(bytes, offset + 4, end) !== view.getUint32(end)) {
            throw new PngError("chunk", `The ${type} chunk fails its checksum.`);
        }
        const content = bytes.subarray(offset + 8, end);
        offset = end + 4;

        if (type === "IHDR") {
            if (header) {
                throw new PngError("chunk", "IHDR appears twice.");
            }
            header = readHeader(content);
            continue;
        }
        if (!header) {
            throw new PngError("chunk", "IHDR is not the first chunk.");
        }
        if (type === "IDAT") {
            if (dataEnded) {
                throw new PngError("chunk", "IDAT chunks are not consecutive.");
            }
            data.push(content);
            continue;
        }
        dataEnded = data.length > 0;
        if (type === "IEND") {
            if (data.length === 0) {
                throw new PngError("chunk", "There is no IDAT chunk.");
            }
            if (header.colorType === INDEXED && !palette) {
                throw new PngError("chunk", "An indexed image has no PLTE chunk.");
            }
            return { header, palette, transparency, data };
        }
        if (type === "PLTE") {
            if (palette || dataEnded) {
                throw new PngError("chunk", "PLTE appears twice or after the image data.");
            }
            if (content.length === 0 || content.length % 3 !== 0 || content.length > 768) {
                throw new PngError("data", "PLTE does not hold 1 to 256 colours.");
            }
            palette = content;
        } else if (type === "tRNS") {
            if (transparency || dataEnded) {
                throw new PngError("chunk", "tRNS appears twice or after the image data.");
            }
            transparency = readTransparency(content, header, palette);
        } else if ((type.charCodeAt(0) & 0x20) === 0) {
            throw new PngError("chunk", `Unknown critical chunk ${type}.`);
        }
    }
}

function passesOf(header: Header): Pass[] {
    const bitsPerPixel = header.channels * header.bitDepth;
    const passes: Pass[] = [];
    for (const [x, y, dx, dy] of header.interlaced ? ADAM7 : SINGLE_PASS) {
        const width = Math.ceil((header.width - x) / dx);
        const height = Math.ceil((header.height - y) / dy);
        if (width > 0 && height > 0) {
            const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
            passes.push({ x, y, dx, dy, width, height, rowBytes });
        }
    }
    return passes;
}

/** Inflates the zlib stream held by `parts`; it must yield exactly `size` bytes. */
async function inflate(parts: Uint8Array[], size: number): Promise<Uint8Array> {
    const raw = new Uint8Array(size);
    const stream = new DecompressionStream("deflate");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    let length = 0;
    let tooMuch = false;
    const read = async (): Promise<void> => {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                return;
            }
            if (length + value.length > size) {
                // Stop here rather than inflate a stream of unknown length to its end.
                tooMuch = true;
                await reader.cancel();
                return;
            }
            raw.set(value, length);
            length += value.length;
        }
    };
    const write = async (): Promise<void> => {
        for (const part of parts) {
            await writer.write(part as Uint8Array<ArrayBuffer>);
        }
        await writer.close();
    };
    // Writing runs alongside reading: the stream only accepts more input while its output is
    // read. A failed write also fails the read, which reports it, so here it is only marked
    // as handled. After a cancelled read the write is abandoned, not awaited.
    const written = write();
    written.catch(() => undefined);
    try {
        await read();
        if (!tooMuch) {
            await written;
        }
    } catch (cause) {
        throw new PngError("data", "The image data is not a valid zlib stream.", { cause });
    }
    if (tooMuch) {
        throw new PngError("data", "The image data is longer than the image size allows.");
    }
    if (length !== size) {
        throw new PngError("data", TOO_LITTLE_DATA);
    }
    return raw;
}

function paeth(left: number, above: number, corner: number): number {
    const estimate = left + above - corner;
    const toLeft = Math.abs(estimate - left);
    const toAbove = Math.abs(estimate - above);
    const toCorner = Math.abs(estimate - corner);
    if (toLeft <= toAbove && toLeft <= toCorner) {
        return left;
    }
    return toAbove <= toCorner ? above : corner;
}

/**
 * Reverses the scanline filters of one pass in place. `start` is the pass's first filter
 * byte; `pixelBytes` is the distance to the byte "to the left" (whole bytes per pixel, at
 * least 1). Bytes outside the pass count as 0. Stores into `raw` wrap modulo 256.
 */
function unfilter(raw: Uint8Array, start: number, pass: Pass, pixelBytes: number): void {
    const stride = pass.rowBytes + 1;
    for (let row = 0; row < pass.height; row++) {
        const from = start + row * stride + 1;
        const to = from + pass.rowBytes;
        const first = from + pixelBytes;
        const filter = raw[from - 1];
        if (filter === 1 || (filter === 4 && row === 0)) {
            for (let i = first; i < to; i++) {
                raw[i] += raw[i - pixelBytes];
            }
        } else if (filter === 2) {
            for (let i = row === 0 ? to : from; i < to; i++) {
                raw[i] += raw[i - stride];
            }
        } else if (filter === 3) {
            for (let i = from; i < to; i++) {
                const left = i < first ? 0 : raw[i - pixelBytes];
                const above = row === 0 ? 0 : raw[i - stride];
                raw[i] += (left + above) >> 1;
            }
        } else if (filter === 4) {
            for (let i = from; i < to; i++) {
                const left = i < first ? 0 : raw[i - pixelBytes];
                const corner = i < first ? 0 : raw[i - stride - pixelBytes];
                raw[i] += paeth(left, raw[i - stride], corner);
            }
        } else if (filter !== 0) {
            throw new PngError("data", `Unknown scanline filter ${filter}.`);
        }
    }
}

/** Reads sample `index` of the scanline whose first byte is at `row`. */
type SampleReader = (row: number, index: number) => number;

function sampleReader(raw: Uint8Array, bitDepth: number): SampleReader {
    if (bitDepth === 8) {
        return (row, index) => raw[row + index];
    }
    if (bitDepth === 16) {
        return (row, index) => (raw[row + index * 2] << 8) | raw[row + index * 2 + 1];
    }
    // 8, 4 or 2 samples share a byte, the leftmost in the high bits.
    const perByte = 8 / bitDepth;
    const mask = (1 << bitDepth) - 1;
    return (row, index) =>
        (raw[row + Math.floor(index / perByte)] >> (8 - bitDepth * ((index % perByte) + 1))) & mask;
}

/**
 * Sample to 8 bits: the nearest value to sample · 255 / (2^bitDepth − 1). Exact below 16
 * bits; 16-bit samples are rounded (PNG specification, "Sample depth rescaling"), not cut to
 * their high byte.
 */
function scalerTo8(bitDepth: number): (sample: number) => number {
    if (bitDepth === 16) {
        return (sample) => (sample * 255 + 32895) >> 16;
    }
    const factor = 255 / ((1 << bitDepth) - 1);
    return (sample) => sample * factor;
}

/** Writes pixel `column` of the scanline at `row` as RGBA8 to `out[target..target + 3]`. */
type PixelWriter = (row: number, column: number, target: number) => void;

function pixelWriter(raw: Uint8Array, image: Image, out: Uint8ClampedArray): PixelWriter {
    const { bitDepth, colorType } = image.header;
    const sample = sampleReader(raw, bitDepth);
    const to8 = scalerTo8(bitDepth);
    const transparency = image.transparency;
    // Sample `index` of the tRNS colour key, compared at the file's own bit depth. A pixel that
    // equals the key is fully transparent; -1 equals no sample.
    const key = (index: number): number =>
        transparency
            ? ((transparency[index * 2] << 8) | transparency[index * 2 + 1]) & ((1 << bitDepth) - 1)
            : -1;
    switch (colorType) {
        case GREY: {
            const keyGrey = key(0);
            return (row, column, target) => {
                const value = sample(row, column);
                const grey = to8(value);
                out[target] = grey;
                out[target + 1] = grey;
                out[target + 2] = grey;
                out[target + 3] = value === keyGrey ? 0 : 255;
            };
        }
        case RGB: {
            const keyRed = key(0);
            const keyGreen = key(1);
            const keyBlue = key(2);
            return (row, column, target) => {
                const red = sample(row, column * 3);
                const green = sample(row, column * 3 + 1);
                const blue = sample(row, column * 3 + 2);
                out[target] = to8(red);
                out[target + 1] = to8(green);
                out[target + 2] = to8(blue);
                out[target + 3] =
                    red === keyRed && green === keyGreen && blue === keyBlue ? 0 : 255;
            };
        }
        case INDEXED: {
            const palette = image.palette ?? new Uint8Array(0);
            const alpha = transparency ?? new Uint8Array(0);
            return (row, column, target) => {
                const index = sample(row, column);
                if (index * 3 >= palette.length) {
                    throw new PngError("data", "A pixel uses a colour outside the palette.");
                }
                out[target] = palette[index * 3];
                out[target + 1] = palette[index * 3 + 1];
                out[target + 2] = palette[index * 3 + 2];
                out[target + 3] = index < alpha.length ? alpha[index] : 255;
            };
        }
        case GREY_ALPHA:
            return (row, column, target) => {
                const grey = to8(sample(row, column * 2));
                out[target] = grey;
                out[target + 1] = grey;
                out[target + 2] = grey;
                out[target + 3] = to8(sample(row, column * 2 + 1));
            };
        default:
            return (row, column, target) => {
                out[target] = to8(sample(row, column * 4));
                out[target + 1] = to8(sample(row, column * 4 + 1));
                out[target + 2] = to8(sample(row, column * 4 + 2));
                out[target + 3] = to8(sample(row, column * 4 + 3));
            };
    }
}

/**
 * Decodes a PNG file to straight-alpha RGBA8. Every colour type and bit depth is accepted,
 * interlaced or not: greyscale is copied to R, G and B; palette colours are looked up, with
 * alpha from tRNS; a tRNS colour key becomes alpha 0; samples below 8 bits are scaled up and
 * 16-bit samples are rounded to 8. Nothing is premultiplied and no gamma or colour profile is
 * applied.
 *
 * Rejects with `PngError` for anything that is not a well-formed PNG; no buffer is returned
 * then. `bytes` must not change before the promise settles.
 */
export async function decodePng(
    bytes: Uint8Array,
    options: PngDecodeOptions = {},
): Promise<PixelBuffer> {
    try {
        const image = readChunks(bytes);
        const { width, height, channels, bitDepth, colorType } = image.header;
        const passes = passesOf(image.header);
        const size = passes.reduce((sum, pass) => sum + pass.height * (pass.rowBytes + 1), 0);
        // A header may claim any size. Refuse before allocating when the data cannot fill it.
        const compressed = image.data.reduce((sum, part) => sum + part.length, 0);
        if (size > compressed * MAX_DEFLATE_RATIO) {
            throw new PngError("data", TOO_LITTLE_DATA);
        }
        const buffer = { width, height, data: new Uint8ClampedArray(width * height * 4) };
        const raw = await inflate(image.data, size);

        const pixelBytes = Math.max(1, (channels * bitDepth) >> 3);
        const write = pixelWriter(raw, image, buffer.data);
        const rgba8 = colorType === RGBA && bitDepth === 8;
        let start = 0;
        for (const pass of passes) {
            unfilter(raw, start, pass, pixelBytes);
            for (let line = 0; line < pass.height; line++) {
                const row = start + line * (pass.rowBytes + 1) + 1;
                let target = ((pass.y + line * pass.dy) * width + pass.x) * 4;
                if (rgba8 && pass.dx === 1) {
                    buffer.data.set(raw.subarray(row, row + pass.rowBytes), target);
                    continue;
                }
                for (let column = 0; column < pass.width; column++, target += pass.dx * 4) {
                    write(row, column, target);
                }
            }
            start += pass.height * (pass.rowBytes + 1);
        }
        if (options.zeroTransparentRgb) {
            zeroTransparentRgb(buffer);
        }
        return buffer;
    } catch (error) {
        if (error instanceof PngError) {
            throw error;
        }
        throw error instanceof RangeError
            ? new PngError("memory", "The image is too large to decode.", { cause: error })
            : new PngError("data", "The PNG could not be decoded.", { cause: error });
    }
}
