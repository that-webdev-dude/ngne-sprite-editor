import { compositeFrame } from "../../src/core/composite";
import { GIF_ALPHA_THRESHOLD } from "../../src/core/gif";
import type { SpriteDoc } from "../../src/core/model";

// SE-063: a GIF decoder written for the tests, independent of `gifenc`, so a unit test reads
// back what an export wrote: the loop block, each frame's control block, colour table and
// pixels, and the images a viewer shows (frames drawn in turn, disposal applied).

/** One image of a GIF, with the control block before it. */
export interface DecodedGifFrame {
    left: number;
    top: number;
    width: number;
    height: number;
    /** Hundredths of a second. */
    delay: number;
    disposal: number;
    /** The transparent index, or null when the frame has none. */
    transparentIndex: number | null;
    /** True when the frame has a colour table of its own. */
    local: boolean;
    /** The colour table the frame uses (its own, else the global one): [r, g, b] each. */
    table: [number, number, number][];
    /** Per pixel, row by row. */
    indices: Uint8Array;
}

export interface DecodedGif {
    width: number;
    height: number;
    /** The NETSCAPE2.0 loop count; null when the file has no such block (plays once). */
    loopCount: number | null;
    frames: DecodedGifFrame[];
}

/** Reads GIF89a bytes; throws on anything malformed or not written by a plain encoder. */
export function decodeGif(bytes: Uint8Array): DecodedGif {
    let at = 0;
    const byte = () => {
        if (at >= bytes.length) throw new Error("decodeGif: unexpected end of the file");
        return bytes[at++]!;
    };
    const u16 = () => byte() | (byte() << 8);
    const table = (size: number) =>
        Array.from({ length: size }, (): [number, number, number] => [byte(), byte(), byte()]);
    /** The data sub-blocks that follow, concatenated. */
    const subBlocks = () => {
        const parts: number[] = [];
        for (let size = byte(); size !== 0; size = byte()) {
            for (let index = 0; index < size; index++) parts.push(byte());
        }
        return Uint8Array.from(parts);
    };

    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature !== "GIF89a") throw new Error(`decodeGif: signature ${signature}`);
    at = 6;
    const width = u16();
    const height = u16();
    const packed = byte();
    byte(); // background colour index
    byte(); // pixel aspect ratio
    const global = packed & 0x80 ? table(2 << (packed & 7)) : null;

    let loopCount: number | null = null;
    let control = { delay: 0, disposal: 0, transparentIndex: null as number | null };
    const frames: DecodedGifFrame[] = [];
    for (;;) {
        const introducer = byte();
        if (introducer === 0x3b) break;
        if (introducer === 0x21) {
            const label = byte();
            if (label === 0xf9) {
                const block = subBlocks();
                control = {
                    disposal: (block[0]! >> 2) & 7,
                    delay: block[1]! | (block[2]! << 8),
                    transparentIndex: block[0]! & 1 ? block[3]! : null,
                };
            } else if (label === 0xff) {
                const block = subBlocks();
                const id = String.fromCharCode(...block.subarray(0, 11));
                if (id === "NETSCAPE2.0" && block[11] === 1) {
                    loopCount = block[12]! | (block[13]! << 8);
                }
            } else {
                subBlocks();
            }
            continue;
        }
        if (introducer !== 0x2c) throw new Error(`decodeGif: block 0x${introducer.toString(16)}`);
        const left = u16();
        const top = u16();
        const frameWidth = u16();
        const frameHeight = u16();
        const flags = byte();
        if (flags & 0x40) throw new Error("decodeGif: interlaced frames are not read");
        const local = flags & 0x80 ? table(2 << (flags & 7)) : null;
        const minCodeSize = byte();
        const indices = lzwDecode(minCodeSize, subBlocks(), frameWidth * frameHeight);
        const used = local ?? global;
        if (!used) throw new Error("decodeGif: a frame without a colour table");
        frames.push({
            left,
            top,
            width: frameWidth,
            height: frameHeight,
            ...control,
            local: local !== null,
            table: used,
            indices,
        });
        control = { delay: 0, disposal: 0, transparentIndex: null };
    }
    return { width, height, loopCount, frames };
}

/** The GIF variant of LZW: codes read least significant bit first, growing up to 12 bits. */
function lzwDecode(minCodeSize: number, data: Uint8Array, count: number): Uint8Array {
    const clear = 1 << minCodeSize;
    const end = clear + 1;
    const out = new Uint8Array(count);
    let written = 0;
    let codeSize = minCodeSize + 1;
    let entries: number[][] = [];
    const reset = () => {
        entries = Array.from({ length: end + 1 }, (_, code) => (code < clear ? [code] : []));
        codeSize = minCodeSize + 1;
    };
    reset();
    let previous: number[] | null = null;
    let bit = 0;
    const read = (size: number) => {
        let code = 0;
        for (let index = 0; index < size; index++, bit++) {
            const value = data[bit >> 3];
            if (value === undefined) throw new Error("decodeGif: the image data ends early");
            code |= ((value >> (bit & 7)) & 1) << index;
        }
        return code;
    };
    for (;;) {
        const code = read(codeSize);
        if (code === clear) {
            reset();
            previous = null;
            continue;
        }
        if (code === end) break;
        let entry: number[];
        if (code < entries.length) entry = entries[code]!;
        else if (code === entries.length && previous) entry = [...previous, previous[0]!];
        else throw new Error(`decodeGif: code ${code} out of the table`);
        for (const value of entry) {
            if (written >= count) throw new Error("decodeGif: more pixels than the frame has");
            out[written++] = value;
        }
        if (previous && entries.length < 4096) entries.push([...previous, entry[0]!]);
        previous = entry;
        if (entries.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    if (written !== count) throw new Error(`decodeGif: ${written} pixels for ${count}`);
    return out;
}

/** The RGBA images a viewer shows, one per frame: each drawn over the last, disposal applied. */
export function renderGif(gif: DecodedGif): Uint8ClampedArray[] {
    const canvas = new Uint8ClampedArray(gif.width * gif.height * 4);
    const shown: Uint8ClampedArray[] = [];
    for (const frame of gif.frames) {
        const before = canvas.slice();
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                const index = frame.indices[y * frame.width + x]!;
                if (index === frame.transparentIndex) continue;
                const [red, green, blue] = frame.table[index]!;
                canvas.set(
                    [red, green, blue, 255],
                    ((frame.top + y) * gif.width + frame.left + x) * 4,
                );
            }
        }
        shown.push(canvas.slice());
        if (frame.disposal === 2 || frame.disposal === 3) {
            for (let y = 0; y < frame.height; y++) {
                for (let x = 0; x < frame.width; x++) {
                    const at = ((frame.top + y) * gif.width + frame.left + x) * 4;
                    const restored =
                        frame.disposal === 2 ? [0, 0, 0, 0] : before.subarray(at, at + 4);
                    canvas.set(restored, at);
                }
            }
        }
    }
    return shown;
}

/**
 * What a GIF of the frame shows, at scale 1: its composite with every pixel of alpha at least
 * the threshold opaque, every other pixel 0, 0, 0, 0.
 */
export function expectedImage(doc: SpriteDoc, frameId: string): Uint8ClampedArray {
    const { data } = compositeFrame(doc, frameId);
    const out = new Uint8ClampedArray(data.length);
    for (let at = 0; at < data.length; at += 4) {
        if (data[at + 3]! < GIF_ALPHA_THRESHOLD) continue;
        out.set([data[at]!, data[at + 1]!, data[at + 2]!, 255], at);
    }
    return out;
}

/** An RGBA image scaled up by a whole number with nearest-neighbour sampling. */
export function blocks(data: Uint8ClampedArray, width: number, scale: number): Uint8ClampedArray {
    const height = data.length / 4 / width;
    const out = new Uint8ClampedArray(data.length * scale * scale);
    for (let y = 0; y < height * scale; y++) {
        for (let x = 0; x < width * scale; x++) {
            const from = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
            out.set(data.subarray(from, from + 4), (y * width * scale + x) * 4);
        }
    }
    return out;
}
