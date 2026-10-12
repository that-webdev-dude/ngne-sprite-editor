// What a project file needs to know of a PNG entry before it is decoded or kept.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** "IHDR". */
const HEADER_TYPE = [73, 72, 68, 82];
/** The signature, then the IHDR chunk: length, type and 13 bytes of content. */
const HEADER_END = SIGNATURE.length + 8 + 13;

/** The fields of IHDR a project file constrains. */
export interface PngHeader {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    /** 0 for none, 1 for Adam7. */
    interlace: number;
}

/** Whether the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
    return bytes.length >= SIGNATURE.length && SIGNATURE.every((value, i) => bytes[i] === value);
}

/**
 * The header of a PNG file, read from its first bytes without decoding anything; `null` when
 * the bytes do not start with the PNG signature and a 13-byte IHDR chunk. The values are as
 * the file states them: nothing is allocated for a size it only claims.
 */
export function pngHeader(bytes: Uint8Array): PngHeader | null {
    if (!isPng(bytes) || bytes.length < HEADER_END) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const typed = HEADER_TYPE.every((value, i) => bytes[SIGNATURE.length + 4 + i] === value);
    if (view.getUint32(SIGNATURE.length) !== 13 || !typed) return null;
    return {
        width: view.getUint32(16),
        height: view.getUint32(20),
        bitDepth: bytes[24],
        colorType: bytes[25],
        interlace: bytes[28],
    };
}
