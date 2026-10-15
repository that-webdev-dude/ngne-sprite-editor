// Colours of the editor as one number, 0xRRGGBBAA (SPEC §5.1: palette, foreground and
// background), and their four channels.

/** The channels of a colour, each an integer 0..255. */
export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** The channels of a colour 0xRRGGBBAA. */
export function unpackRgba(colour: number): Rgba {
    return {
        r: (colour >>> 24) & 0xff,
        g: (colour >>> 16) & 0xff,
        b: (colour >>> 8) & 0xff,
        a: colour & 0xff,
    };
}

/** The colour 0xRRGGBBAA of four channels, each an integer 0..255. */
export function packRgba(r: number, g: number, b: number, a: number): number {
    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}
