// Colours as hex text (DESIGN §5.3, the hex field of the colour panel), with the digit counts
// of CSS: 3 or 6 digits for an opaque colour, 4 or 8 with alpha.

const HEX = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The colour 0xRRGGBBAA of hex text: "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa", with or
 * without "#", in either case, white space around it ignored. 3 and 4 digits stand for
 * doubled digits ("#f80" is "#ff8800"); without alpha digits the colour is opaque. Null when
 * the text is not such a colour.
 */
export function parseHex(text: string): number | null {
    const digits = HEX.exec(text.trim())?.[1];
    if (digits === undefined) return null;
    const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
    return parseInt(full.length === 6 ? `${full}ff` : full, 16) >>> 0;
}

/**
 * A colour 0xRRGGBBAA as hex text in upper case: "#RRGGBB" when it is opaque and
 * "#RRGGBBAA" when it is not. With `withAlpha` the alpha digits are always written.
 */
export function formatHex(colour: number, withAlpha = false): string {
    const text = (colour >>> 0).toString(16).toUpperCase().padStart(8, "0");
    return `#${withAlpha || !text.endsWith("FF") ? text : text.slice(0, 6)}`;
}
